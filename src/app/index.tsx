import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View } from 'react-native';

import { defaultFilters, type BrowseFilters, activeExtraCount } from '@/components/browse-filters';
import { ProfileSetupBanner } from '@/components/profile-setup-banner';
import { LeagueCard } from '@/components/league-card';
import { MatchCard, initialsOf, matchDayKey, playersOf } from '@/components/match-card';
import { MatchSheet } from '@/components/match-sheet';
import { dayKey, MonthCalendar, type CalendarDot } from '@/components/kit/calendar';
import { NeedsSubCard, NoOpenSeatsCard } from '@/components/kit/cards';
import { Button, GradientButton, IconButton, SegmentedControl, TextLink } from '@/components/kit/controls';
import { ExtraFilters } from '@/components/kit/filters';
import { Icon } from '@/components/kit/icons';
import {
  Card,
  ScreenHeader,
  ScreenScaffold,
  SectionHeader,
  TitleBlock,
} from '@/components/kit/layout';
import { colors, leagueEdge, text } from '@/constants/design';
import { useGlobalView } from '@/hooks/use-global-view';
import { useNeedsProfileSetup } from '@/hooks/use-profile-setup';
import { addMatchToCalendar, loadCalendarSent, recordCalendarSent } from '@/lib/calendar';
import {
  coordinatesOf,
  DefaultDistance,
  DistanceOptions,
  fetchDeviceLocation,
  milesBetween,
  timeOfDayOf,
  type Coordinates,
  type DayIndex,
  type DistanceMiles,
} from '@/lib/geo';
import {
  fetchUpcomingMatches,
  formatTimeOfDay,
  isSeated,
  joinMatch,
  leaveMatch,
  SEATS_PER_MATCH,
  type Match,
} from '@/lib/matches';
import { fetchPublicLeagues, joinPublicLeague, type PublicLeague } from '@/lib/leagues';
import { offerHomeScreenPrompt } from '@/hooks/use-home-screen-prompt';
import { fetchMyBearings } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

const AppMark = require('@/assets/images/app-mark.png');

/**
 * How far something is from wherever the member is measuring from — their saved
 * town, or the device's own position when they have asked for that. Null when
 * either end has no coordinates.
 */
function distanceFrom(
  from: Coordinates | null,
  point: { latitude?: number | null; longitude?: number | null }
) {
  if (!from) return null;
  const where = coordinatesOf(point);
  return where ? milesBetween(from, where) : null;
}

/**
 * A league's distance is measured to its next meetup, which is the only venue it
 * has — different sessions can be in different places. A league with no meetup
 * scheduled, or one whose venue was typed rather than picked, has no distance and
 * so is never filtered out by one.
 */
function leagueDistance(league: PublicLeague, from: Coordinates | null) {
  return distanceFrom(from, { latitude: league.next_latitude, longitude: league.next_longitude });
}

/**
 * Whether a match survives the filters.
 *
 * The distance rule has a deliberate hole in it: a match with no coordinates is
 * always kept. Every match proposed before coordinates existed has none, and so
 * does any venue typed by hand rather than picked from the suggestions — treating
 * those as "too far" would hide real games from everyone, which is exactly the
 * failure this screen already had.
 */
function keep(match: Match, filters: BrowseFilters, from: Coordinates | null) {
  if (filters.openOnly && match.status !== 'open') return false;
  if (filters.suppliesOnly && !match.supplies_provided) return false;

  const at = new Date(match.date_time);
  if (filters.days.length > 0 && !filters.days.includes(at.getDay() as DayIndex)) return false;
  if (filters.times.length > 0 && !filters.times.includes(timeOfDayOf(at))) return false;

  if (filters.distance !== null) {
    const miles = distanceFrom(from, match);
    if (miles !== null && miles > filters.distance) return false;
  }

  return true;
}

/**
 * Whether a public league belongs in the list.
 *
 * A full league stays and reads as full, the same as a full match: the card
 * already draws itself muted, labels itself "Full" and drops its Join button. A
 * group that meets near you is worth knowing about in the week you cannot join
 * it — seats come free, and the card is how somebody finds out the league exists
 * at all. Dropping them meant a league you had been watching vanished the moment
 * a stranger took the last seat, with nothing on screen to say why.
 *
 * Day and time-of-day filters are not applied: they describe when a single match
 * is, and a league is a season of meetups rather than one date.
 */
function keepLeague(league: PublicLeague, filters: BrowseFilters, from: Coordinates | null) {
  if (filters.distance !== null) {
    const miles = leagueDistance(league, from);
    if (miles !== null && miles > filters.distance) return false;
  }

  return true;
}

/**
 * Whether `SeatButton` would draw anything.
 *
 * Asked before the detail sheet is handed one, because the sheet puts a rule above
 * its footer and a rule over an empty row is just a line across the bottom of the
 * screen. There is no way to ask a rendered element whether it came out null, so
 * the condition lives here and both callers read it.
 */
function hasSeatControl(match: Match, userId: string) {
  if (match.host_id === userId) return false;
  return isSeated(match, userId) || match.players.length < SEATS_PER_MATCH;
}

/**
 * Whether this member already has a stake in the match — hosting it or holding
 * a seat — which is what makes "add to calendar" a sensible offer here. My
 * Matches can show the button unconditionally because every row there already
 * qualifies; Browse mixes those in with matches nobody has joined yet.
 */
function isMember(match: Match, userId: string) {
  return match.host_id === userId || isSeated(match, userId);
}

/** A table this member could sit down at — what "Needs you" is about. */
function needsAPlayer(match: Match, userId: string) {
  return (
    match.status === 'open' &&
    match.host_id !== userId &&
    !isSeated(match, userId) &&
    match.players.length < SEATS_PER_MATCH
  );
}

const DistanceLabels: Record<string, string> = {
  '5': '5 mi',
  '15': '15 mi',
  '25': '25 mi',
  '50': '50 mi',
  any: 'Any',
};

const keyOf = (miles: DistanceMiles) => (miles === null ? 'any' : String(miles));

/** Morning before noon, afternoon before five, evening after. */
function greeting(name: string | null) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/**
 * Only genuinely actionable states get a control. "Hosting" and "Full" used to
 * sit here styled like buttons while doing nothing; the card's pills carry that
 * now.
 */
function SeatButton({
  match,
  userId,
  busy,
  onJoin,
  onLeave,
}: {
  match: Match;
  userId: string;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
}) {
  // The host holds a seat for the life of the match; leaving would orphan it.
  // Calling a match off is an edit, and lives on My Matches.
  if (!hasSeatControl(match, userId)) return null;

  if (isSeated(match, userId)) {
    return <Button variant="plain" label="Leave" onPress={onLeave} busy={busy} />;
  }

  return <Button variant="outline" label="Join" onPress={onJoin} busy={busy} />;
}

export default function BrowseMatchesScreen() {
  const globalView = useGlobalView();
  const needsSetup = useNeedsProfileSetup();
  const [matches, setMatches] = useState<Match[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BrowseFilters>(() => defaultFilters(DefaultDistance));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  /**
   * Read once per load rather than passed in: Browse is the only screen that
   * needs it, and a member can change their town on Profile mid-session.
   */
  const [bearings, setBearings] = useState<{
    name: string | null;
    town: string | null;
    home: Coordinates | null;
    avatarUrl: string | null;
  }>({ name: null, town: null, home: null, avatarUrl: null });
  /**
   * Where the device says the member is, once they have asked for it, and whether
   * the list is currently measured from there.
   *
   * Deliberately not persisted and not asked for on load. A permission prompt on
   * open is the kind of thing people refuse on principle, and the answer would be
   * stale by the next session anyway — this is for the trip you are on now, so it
   * lasts as long as the screen does.
   */
  const [here, setHere] = useState<Coordinates | null>(null);
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  /**
   * The instant the cards' timing pills are measured against, captured when the
   * list loads rather than read while rendering — the same reasoning as `loadedAt`
   * on My Matches. Tying it to the fetch also puts the boundary in the right
   * place: this screen reloads on focus, which is exactly when "is this tonight"
   * should be asked again.
   */
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [joiningLeagueId, setJoiningLeagueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [isProposing, setIsProposing] = useState(false);
  /**
   * The match being edited, opened from its detail sheet.
   *
   * Editing used to live only on My Matches, on the reasoning that Browse is for
   * finding a table rather than running one. That held while a card was a summary
   * with a Join button: a host looking at their own match in Browse had nothing to
   * press, which was fine because there was nothing to read either. Now the card
   * opens the whole match, and being shown every detail of something you host with
   * no way to change it is just a dead end.
   */
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  /**
   * List or calendar. The toggle sits above both "Needs you" and the calendar
   * grid, since it governs the same underlying `visible` matches either way —
   * only how they're laid out changes.
   */
  const [browseView, setBrowseView] = useState<'list' | 'calendar'>('list');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(() => new Date());
  const [calendarSent, setCalendarSent] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('You are signed out.');
        return;
      }

      setUserId(user.id);
      setMatches(await fetchUpcomingMatches(globalView));
      // Never throws — a failed lookup just means no distance filtering and a
      // header that greets nobody in particular.
      setBearings(await fetchMyBearings(user.id));
      // Swallowed on purpose: a directory that fails to load should not take the
      // list of matches down with it.
      setLeagues(await fetchPublicLeagues().catch(() => []));
      setCalendarSent(await loadCalendarSent(user.id));
      setLoadedAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load matches.');
    }
    // Reloads when the toggle moves: `load` changes identity, the focus effect
    // depends on it, and the focused screen is the one being looked at.
  }, [globalView]);

  const sendToCalendar = useCallback(
    async (match: Match) => {
      await addMatchToCalendar(match);
      if (!userId) return;
      setCalendarSent(await recordCalendarSent(userId, match.id, calendarSent));
    },
    [calendarSent, userId]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        await load();
        if (active) setIsLoading(false);
      })();

      return () => {
        active = false;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }, [load]);

  /**
   * Offers the home screen shortcut after a successful join. The sheet itself is
   * rendered by the root layout, because the invite-link path raises it too — see
   * useHomeScreenPrompt.
   */
  const maybePromptHomeScreen = useCallback(async () => {
    if (!userId) return;
    await offerHomeScreenPrompt(userId);
  }, [userId]);

  // Refetch rather than patching local state: the seat triggers may also have
  // flipped the match between open and full.
  const changeSeat = useCallback(
    async (
      matchId: string,
      action: (matchId: string, userId: string) => Promise<void>,
      /** Joining, as opposed to leaving — the two share this function. */
      isJoin = false
    ) => {
      if (!userId) return;

      setBusyMatchId(matchId);
      try {
        await action(matchId, userId);
        await load();
        if (isJoin) await maybePromptHomeScreen();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not work. Try again.');
      } finally {
        setBusyMatchId(null);
      }
    },
    [load, maybePromptHomeScreen, userId]
  );

  const joinLeague = useCallback(
    async (leagueId: string) => {
      setJoiningLeagueId(leagueId);
      try {
        await joinPublicLeague(leagueId);
        await load();
        await maybePromptHomeScreen();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not join that league.');
      } finally {
        setJoiningLeagueId(null);
      }
    },
    [load, maybePromptHomeScreen]
  );

  /**
   * Asks the device where it is, and measures from there once it answers.
   *
   * A refusal is left silent on purpose: the prompt said what was being asked and
   * the member said no, so repeating it back as an error would be scolding them
   * for an answer they meant. The link stays where it is, which is the whole of
   * what they need to change their mind.
   */
  const useDeviceLocation = async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const found = await fetchDeviceLocation();
      if (found) {
        setHere(found);
        setUsingDeviceLocation(true);
      }
    } catch (cause) {
      setLocationError(cause instanceof Error ? cause.message : 'Could not tell where you are.');
    } finally {
      setLocating(false);
    }
  };

  /**
   * What distances are measured from. The device fix wins only while it is both
   * asked for and actually in hand, so a failed lookup silently leaves the saved
   * town doing the job it was already doing.
   */
  const origin = usingDeviceLocation && here ? here : bearings.home;
  /**
   * Whether anything can be measured. A device fix counts as much as a saved
   * town, which is the point of offering it: somebody who has never set a town
   * gets the distance control the moment they say where they are.
   */
  const hasOrigin = bearings.home !== null || (usingDeviceLocation && here !== null);

  const visible = matches.filter((match) => keep(match, filters, origin));
  const visibleLeagues = leagues.filter((league) => keepLeague(league, filters, origin));

  // Soonest first: the whole point of the section is the table you could still
  // get to.
  const needsYou = visible
    .filter((match) => needsAPlayer(match, userId ?? ''))
    .sort((a, b) => a.date_time.localeCompare(b.date_time));
  /**
   * Everything else that is on — full tables, and the ones this member is already
   * in or is running.
   *
   * Not in the mockups, which lead with "Needs you" and then go straight to
   * leagues. Kept because Browse today lists every upcoming match: without this
   * section a full table you had been watching, or your own hosted game, would
   * simply vanish from the screen.
   */
  const alsoOn = visible
    .filter((match) => !needsAPlayer(match, userId ?? ''))
    .sort((a, b) => a.date_time.localeCompare(b.date_time));

  // Distinguishes "nothing on at all" from "your filters hid everything", which
  // want different words and different fixes.
  const hiddenByFilters =
    matches.length - visible.length + (leagues.length - visibleLeagues.length);
  const extras = activeExtraCount(filters);

  /** The next distance out, for the empty state's "Widen to" button. */
  const nextDistance =
    DistanceOptions[Math.min(DistanceOptions.indexOf(filters.distance) + 1, DistanceOptions.length - 1)];
  const widenLabel =
    filters.distance === null || nextDistance === filters.distance
      ? undefined
      : DistanceLabels[keyOf(nextDistance)];

  const matchAction = (match: Match) => {
    const sentToCalendar = calendarSent.has(match.id);
    const canDiarise = isMember(match, userId ?? '');

    return (
      <>
        {canDiarise ? (
          <IconButton
            icon="calendar"
            accessibilityLabel={
              sentToCalendar ? 'Already sent to calendar — send again' : 'Add to calendar'
            }
            onPress={() => sendToCalendar(match)}
          />
        ) : null}
        <SeatButton
          match={match}
          userId={userId ?? ''}
          busy={busyMatchId === match.id}
          onJoin={() => changeSeat(match.id, joinMatch, true)}
          onLeave={() => changeSeat(match.id, leaveMatch)}
        />
      </>
    );
  };

  /**
   * The same card, and the same reasoning for opening its own detail sheet on
   * tap, whether it's a row in "Also on" or a row in the calendar's agenda —
   * one place decides what a match card does with itself.
   */
  const matchRow = (match: Match) => {
    const sentToCalendar = calendarSent.has(match.id);
    const canDiarise = isMember(match, userId ?? '');
    const onRoster = isSeated(match, userId ?? '');

    return (
      <MatchCard
        key={match.id}
        match={match}
        userId={userId ?? ''}
        distance={distanceFrom(origin, match)}
        now={loadedAt}
        onEdit={() => setEditingMatchId(match.id)}
        action={matchAction(match)}
        detailAction={
          hasSeatControl(match, userId ?? '') ? (
            <SeatButton
              match={match}
              userId={userId ?? ''}
              busy={busyMatchId === match.id}
              onJoin={() => changeSeat(match.id, joinMatch, true)}
              onLeave={() => changeSeat(match.id, leaveMatch)}
            />
          ) : undefined
        }
        calendarSent={sentToCalendar}
        onAddToCalendar={canDiarise && onRoster ? () => sendToCalendar(match) : undefined}
      />
    );
  };

  /**
   * One dot per match on Browse, bucketed onto the grid by the match's own
   * day — see `matchDayKey`. Built from `visible`, so the calendar respects
   * the same distance/day/time/open/supplies filters the list does; toggling
   * views never shows a different set of games, only a different layout of
   * the same set.
   */
  // Not memoized: `visible` is itself a fresh array every render (it's a plain
  // `.filter()` above, not its own memo), so a dependency on it would never
  // actually skip work — this is exactly as cheap either way.
  const dotsByDay: Record<string, CalendarDot[]> = {};
  for (const match of visible) {
    const key = matchDayKey(match);
    (dotsByDay[key] ??= []).push({ color: leagueEdge(match.league?.color) });
  }

  const selectedDayMatches = selectedDay
    ? visible
        .filter((match) => matchDayKey(match) === dayKey(selectedDay))
        .sort((a, b) => a.date_time.localeCompare(b.date_time))
    : [];

  return (
    <>
      <ScreenScaffold
        ribbon="hero"
        animateRibbon
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
        <ScreenHeader
          logo={AppMark}
          initials={initialsOf(bearings.name)}
          photoUrl={bearings.avatarUrl}
          badge={needsSetup}
          onProfilePress={() => router.push('/profile')}
          trailing={
            <GradientButton
              size="sm"
              icon="plus"
              label="Propose"
              glow
              onPress={() => setIsProposing(true)}
            />
          }
        />

        <TitleBlock
          eyebrow={greeting(bearings.name)}
          title="Find a table"
          subtitle={
            needsYou.length + alsoOn.length > 0
              ? `${needsYou.length + alsoOn.length} ${
                  needsYou.length + alsoOn.length === 1 ? 'game' : 'games'
                } coming up${bearings.town ? ` near ${bearings.town}` : ''}`
              : undefined
          }
        />

        {/* Above the filters, below the heading: the first thing under the title
            for a member who has not finished setting up, and absent for everyone
            else. Browse is where every new member lands, which is why it is here
            rather than on the profile screen they have no reason to visit yet. */}
        <ProfileSetupBanner />

        <View style={{ gap: 10 }}>
          {hasOrigin ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <SegmentedControl
                accessibilityLabel="Distance"
                style={{ flex: 1 }}
                value={keyOf(filters.distance)}
                onChange={(key) =>
                  setFilters({
                    ...filters,
                    distance: (key === 'any' ? null : Number(key)) as DistanceMiles,
                  })
                }
                options={DistanceOptions.map((miles) => ({
                  value: keyOf(miles),
                  label: DistanceLabels[keyOf(miles)],
                }))}
              />
              <IconButton
                icon="sliders"
                accessibilityLabel={
                  filtersExpanded
                    ? 'Hide more filters'
                    : extras > 0
                      ? `More filters, ${extras} on`
                      : 'More filters'
                }
                onPress={() => setFiltersExpanded((open) => !open)}
              />
            </View>
          ) : (
            // Rather than showing a distance filter that silently does nothing.
            // Both ways out are named, because the link below is the one that
            // works without leaving the screen.
            <Card>
              <Text style={[text.meta, { color: colors.inkMuted }]}>
                Set your town on Profile, or use your location, to filter by distance.
              </Text>
            </Card>
          )}

          {/* What the distances are measured from, under the control they govern. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {locating ? (
              <>
                <ActivityIndicator size="small" />
                <Text style={[text.meta, { color: colors.inkMuted }]}>Finding you…</Text>
              </>
            ) : (
              <>
                <Icon name="pin" size={16} color={colors.link} strokeWidth={2} />
                <Text style={[text.meta, { color: colors.inkMuted }]}>
                  {usingDeviceLocation && here
                    ? 'Where you are now ·'
                    : bearings.town
                      ? `Near ${bearings.town} ·`
                      : 'No town set ·'}
                </Text>
                {usingDeviceLocation && here ? (
                  // Only when there is a town to go back to. Otherwise this would
                  // offer to switch to nothing.
                  bearings.home ? (
                    <TextLink label="Use my town" onPress={() => setUsingDeviceLocation(false)} />
                  ) : null
                ) : (
                  <TextLink label="Use my location" onPress={useDeviceLocation} />
                )}
              </>
            )}
          </View>

          {locationError ? (
            <Text style={[text.meta, { color: colors.danger }]}>{locationError}</Text>
          ) : null}
        </View>

        {filtersExpanded ? <ExtraFilters filters={filters} onChange={setFilters} /> : null}

        {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}

        <SegmentedControl
          accessibilityLabel="Browse view"
          value={browseView}
          onChange={setBrowseView}
          options={[
            { value: 'list', label: 'List' },
            { value: 'calendar', label: 'Calendar' },
          ]}
        />

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : browseView === 'calendar' ? (
          <>
            <MonthCalendar
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              selected={selectedDay}
              onSelectDate={setSelectedDay}
              dotsByDay={dotsByDay}
            />

            <SectionHeader
              title={
                selectedDay
                  ? selectedDay.toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })
                  : 'Pick a day'
              }
              count={selectedDayMatches.length || undefined}
            />
            {selectedDayMatches.length > 0 ? (
              selectedDayMatches.map((match) => matchRow(match))
            ) : (
              <Text style={[text.meta, { color: colors.inkMuted, textAlign: 'center' }]}>
                {selectedDay ? 'No games that day.' : 'Tap a day to see what’s on.'}
              </Text>
            )}

            {visibleLeagues.length > 0 ? (
              <>
                <SectionHeader title="Leagues near you" />
                {visibleLeagues.map((league) => (
                  <LeagueCard
                    key={league.id}
                    league={league}
                    distance={leagueDistance(league, origin)}
                    now={loadedAt}
                    busy={joiningLeagueId === league.id}
                    onJoin={() => joinLeague(league.id)}
                  />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <>
            {needsYou.length > 0 ? (
              <>
                <SectionHeader title="Needs you" count={needsYou.length} />
                {needsYou.map((match) => (
                  <NeedsSubCard
                    key={match.id}
                    date={new Date(match.date_time)}
                    timeZone={match.time_zone}
                    leagueColor={leagueEdge(match.league?.color)}
                    whenPill={
                      new Date(match.date_time).toDateString() === new Date(loadedAt).toDateString()
                        ? 'Tonight'
                        : new Date(match.date_time).toDateString() ===
                            new Date(loadedAt + 86400000).toDateString()
                          ? 'Tomorrow'
                          : undefined
                    }
                    venue={match.location}
                    meta={[match.location_detail, formatTimeOfDay(new Date(match.date_time))]
                      .filter(Boolean)
                      .join(' · ')}
                    players={playersOf(match)}
                    seats={SEATS_PER_MATCH}
                    tableLabel={
                      match.league
                        ? `${match.league.name}${match.table_number ? ` · Table ${match.table_number}` : ''}`
                        : 'Single match'
                    }
                    onTakeSeat={() => changeSeat(match.id, joinMatch, true)}
                  />
                ))}
              </>
            ) : (
              <>
                <NoOpenSeatsCard
                  radiusLabel={
                    filters.distance === null ? 'any distance' : DistanceLabels[keyOf(filters.distance)]
                  }
                  nextRadiusLabel={widenLabel}
                  onPropose={() => setIsProposing(true)}
                  onWiden={
                    widenLabel ? () => setFilters({ ...filters, distance: nextDistance }) : undefined
                  }
                />
                {/* Says which of the two empty states this is: nothing on at all,
                    or a filter hiding what there is. */}
                {hiddenByFilters > 0 ? (
                  <Text style={[text.meta, { color: colors.inkMuted, textAlign: 'center' }]}>
                    {hiddenByFilters} {hiddenByFilters === 1 ? 'is' : 'are'} hidden by your filters.
                  </Text>
                ) : null}
              </>
            )}

            {alsoOn.length > 0 ? (
              <>
                <SectionHeader
                  title={needsYou.length > 0 ? 'Also on' : 'Meanwhile'}
                  count={alsoOn.length}
                />
                {alsoOn.map((match) => matchRow(match))}
              </>
            ) : null}

            {visibleLeagues.length > 0 ? (
              <>
                <SectionHeader title="Leagues near you" />
                {visibleLeagues.map((league) => (
                  <LeagueCard
                    key={league.id}
                    league={league}
                    distance={leagueDistance(league, origin)}
                    now={loadedAt}
                    busy={joiningLeagueId === league.id}
                    onJoin={() => joinLeague(league.id)}
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScreenScaffold>

      {/* Keyed on open so each visit starts from a blank form: the sheet reads
          its initial state once, when it mounts. */}
      <MatchSheet
        key={isProposing ? 'proposing' : 'closed'}
        hostId={userId}
        match={null}
        visible={isProposing}
        onClose={() => setIsProposing(false)}
        onSaved={async () => {
          setIsProposing(false);
          await load();
        }}
      />

      {/* Editing, for a host who opened their own match from this screen. Read
          from the freshly loaded list rather than captured when the button was
          pressed, so the form shows current seats; keyed on the match so it is
          rebuilt from that match's details rather than the last one's. */}
      <MatchSheet
        key={`edit-${editingMatchId ?? 'none'}`}
        hostId={userId}
        match={matches.find((match) => match.id === editingMatchId) ?? null}
        visible={editingMatchId !== null}
        onClose={() => setEditingMatchId(null)}
        onSaved={async () => {
          setEditingMatchId(null);
          await load();
        }}
      />
    </>
  );
}
