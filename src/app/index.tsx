import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrowseFilterBar, defaultFilters, type BrowseFilters } from '@/components/browse-filters';
import { ProfileSetupBanner } from '@/components/profile-setup-banner';
import { GradientButton, QuietButton, SolidButton } from '@/components/button';
import { LeagueCard } from '@/components/league-card';
import { MatchCard } from '@/components/match-card';
import { MatchSheet } from '@/components/match-sheet';
import { Ribbon } from '@/components/ribbon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addMatchToCalendar, loadCalendarSent, recordCalendarSent } from '@/lib/calendar';
import {
  coordinatesOf,
  DefaultDistance,
  milesBetween,
  timeOfDayOf,
  type Coordinates,
  type DayIndex,
} from '@/lib/geo';
import {
  fetchUpcomingMatches,
  isSeated,
  joinMatch,
  leaveMatch,
  SEATS_PER_MATCH,
  type Match,
} from '@/lib/matches';
import { fetchPublicLeagues, joinPublicLeague, type PublicLeague } from '@/lib/leagues';
import { offerHomeScreenPrompt } from '@/hooks/use-home-screen-prompt';
import { fetchMyHome } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

/**
 * How far something is from the member's town, or null when either end has no
 * coordinates.
 */
function distanceFrom(
  home: Coordinates | null,
  point: { latitude?: number | null; longitude?: number | null }
) {
  if (!home) return null;
  const where = coordinatesOf(point);
  return where ? milesBetween(home, where) : null;
}

/**
 * A league's distance is measured to its next meetup, which is the only venue it
 * has — different sessions can be in different places. A league with no meetup
 * scheduled, or one whose venue was typed rather than picked, has no distance and
 * so is never filtered out by one.
 */
function leagueDistance(league: PublicLeague, home: Coordinates | null) {
  return distanceFrom(home, { latitude: league.next_latitude, longitude: league.next_longitude });
}

/**
 * Browse lists two kinds of thing: matches to sit down at, and public leagues to
 * join. A tagged union rather than two lists, so one distance filter and one
 * empty state cover both.
 */
type Row =
  | { key: string; kind: 'league'; league: PublicLeague; distance: number | null }
  | { key: string; kind: 'match'; match: Match; distance: number | null };

/**
 * Whether a match survives the filters.
 *
 * The distance rule has a deliberate hole in it: a match with no coordinates is
 * always kept. Every match proposed before coordinates existed has none, and so
 * does any venue typed by hand rather than picked from the suggestions — treating
 * those as "too far" would hide real games from everyone, which is exactly the
 * failure this screen already had.
 */
function keep(match: Match, filters: BrowseFilters, home: Coordinates | null) {
  if (filters.openOnly && match.status !== 'open') return false;
  if (filters.suppliesOnly && !match.supplies_provided) return false;

  const at = new Date(match.date_time);
  if (filters.days.length > 0 && !filters.days.includes(at.getDay() as DayIndex)) return false;
  if (filters.times.length > 0 && !filters.times.includes(timeOfDayOf(at))) return false;

  if (filters.distance !== null) {
    const miles = distanceFrom(home, match);
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

/**
 * Only genuinely actionable states get a control. "Hosting" and "Full" used to
 * sit here styled like buttons while doing nothing; the card's edge bar and
 * standing label carry that now.
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
  const theme = useTheme();

  // The host holds a seat for the life of the match; leaving would orphan it.
  // Calling a match off is an edit, and lives on My Matches.
  if (!hasSeatControl(match, userId)) return null;
  if (busy) return <ActivityIndicator />;

  if (isSeated(match, userId)) {
    return (
      <Pressable onPress={onLeave} style={({ pressed }) => pressed && styles.pressed}>
        <View
          style={[styles.seatButton, styles.outlined, { borderColor: theme.rule }]}>
          <ThemedText type="label" themeColor="textSecondary">
            Leave
          </ThemedText>
        </View>
      </Pressable>
    );
  }

  // The same component the league cards use, so a seat and a league read as the
  // same kind of offer rather than two unrelated controls on one screen.
  return <SolidButton label="Join" onPress={onJoin} />;
}

export default function BrowseMatchesScreen() {
  const theme = useTheme();
  const [matches, setMatches] = useState<Match[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BrowseFilters>(() => defaultFilters(DefaultDistance));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  /**
   * Read once per load rather than passed in: Browse is the only screen that
   * needs it, and a member can change their town on Profile mid-session.
   */
  const [home, setHome] = useState<Coordinates | null>(null);
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  /**
   * The instant the cards' timing labels are measured against, captured when the
   * list loads rather than read while rendering — the same reasoning as `loadedAt`
   * on My Matches. Tying it to the fetch also puts the boundary in the right
   * place: this screen reloads on focus, which is exactly when "is this new, is
   * this imminent" should be asked again.
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
      setMatches(await fetchUpcomingMatches());
      // Never throws — a failed lookup just means no distance filtering.
      setHome(await fetchMyHome(user.id));
      // Swallowed on purpose: a directory that fails to load should not take the
      // list of matches down with it.
      setLeagues(await fetchPublicLeagues().catch(() => []));
      setCalendarSent(await loadCalendarSent(user.id));
      setLoadedAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load matches.');
    }
  }, []);

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

  const visible = matches.filter((match) => keep(match, filters, home));
  // Counted over what is on screen, not over everything loaded. Counting the
  // whole list put "4 tables open" above a filtered list of one.
  const openCount = visible.filter((match) => match.status === 'open').length;
  const visibleLeagues = leagues.filter((league) => keepLeague(league, filters, home));

  // Leagues first: there are few of them, and joining one is the bigger
  // commitment, so it should not be buried under a season's worth of tables.
  const rows: Row[] = [
    ...visibleLeagues.map((league) => ({
      key: `league-${league.id}`,
      kind: 'league' as const,
      league,
      distance: leagueDistance(league, home),
    })),
    ...visible.map((match) => ({
      key: `match-${match.id}`,
      kind: 'match' as const,
      match,
      distance: distanceFrom(home, match),
    })),
  ];

  // Distinguishes "nothing on at all" from "your filters hid everything", which
  // want different words and different fixes.
  const hiddenByFilters =
    matches.length - visible.length + (leagues.length - visibleLeagues.length);

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              {/* Carries a count rather than restating the title, so the
                  eyebrow tells you something the heading does not. */}
              {/* `accentInk`, not `accent`: the teal fill is 2.5:1 on white and
                  this is 11px type. */}
              <ThemedText type="label" themeColor="accentInk">
                {openCount === 0
                  ? 'No open tables'
                  : `${openCount} ${openCount === 1 ? 'table' : 'tables'} open`}
              </ThemedText>
              <ThemedText type="title">Browse</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
                Find a table to join
              </ThemedText>
            </View>
            {/* This screen's one gradient. */}
            <GradientButton label="Propose" onPress={() => setIsProposing(true)} />
          </View>
        </View>

        {/* Above the filters, below the heading: the first thing under the title
            for a member who has not finished setting up, and absent for everyone
            else. Browse is where every new member lands, which is why it is here
            rather than on the profile screen they have no reason to visit yet. */}
        <View style={styles.setupPrompt}>
          <ProfileSetupBanner />
        </View>

        <BrowseFilterBar
          filters={filters}
          onChange={setFilters}
          expanded={filtersExpanded}
          onToggleExpanded={() => setFiltersExpanded((open) => !open)}
          hasHome={home !== null}
        />

        {error ? (
          <ThemedText type="small" style={[styles.errorBanner, { color: theme.danger }]}>
            {error}
          </ThemedText>
        ) : null}

        {isLoading ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={({ item: row }) => {
              if (row.kind === 'league') {
                return (
                  <LeagueCard
                    league={row.league}
                    distance={row.distance}
                    now={loadedAt}
                    busy={joiningLeagueId === row.league.id}
                    onJoin={() => joinLeague(row.league.id)}
                  />
                );
              }

              // The same control on the card and inside its detail sheet, so
              // reading a match through to the end is not a dead end.
              const seat = (
                <SeatButton
                  match={row.match}
                  userId={userId ?? ''}
                  busy={busyMatchId === row.match.id}
                  onJoin={() => changeSeat(row.match.id, joinMatch, true)}
                  onLeave={() => changeSeat(row.match.id, leaveMatch)}
                />
              );

              // My Matches' "add to calendar" button, offered here too once this
              // member actually has a seat — hosting or freshly joined — rather
              // than on every joinable card, where there is nothing yet worth
              // putting in a calendar.
              const sentToCalendar = calendarSent.has(row.match.id);
              const canDiarise = isMember(row.match, userId ?? '');
              const calendar = canDiarise ? (
                <QuietButton
                  icon={sentToCalendar ? 'calendarCheck' : 'calendarPlus'}
                  label={
                    sentToCalendar ? 'Already sent to calendar — send again' : 'Add to calendar'
                  }
                  onPress={() => sendToCalendar(row.match)}
                  tone={sentToCalendar ? 'done' : 'accent'}
                />
              ) : null;
              const showSeat = hasSeatControl(row.match, userId ?? '');
              const footer =
                calendar || showSeat ? (
                  <>
                    {calendar}
                    {showSeat ? seat : null}
                  </>
                ) : undefined;

              /**
               * Inside the sheet the calendar hangs off this member's own roster
               * row instead of the footer, so it sits where joining just put their
               * name. A host who never took a seat has no such row — createMatch
               * seats them by trigger, but `fetchMyMatches` still allows for the
               * case — so for them it stays in the footer rather than vanishing.
               */
              const onRoster = isSeated(row.match, userId ?? '');
              const detailCalendar = canDiarise && !onRoster ? calendar : null;
              const detailFooter =
                detailCalendar || showSeat ? (
                  <>
                    {detailCalendar}
                    {showSeat ? seat : null}
                  </>
                ) : undefined;

              return (
                <MatchCard
                  match={row.match}
                  userId={userId ?? ''}
                  distance={row.distance}
                  now={loadedAt}
                  // Passed for every card; the sheet shows the control only to the
                  // host, and only while the match is still to be played.
                  onEdit={() => setEditingMatchId(row.match.id)}
                  action={footer}
                  // Undefined rather than an element that renders nothing, so the
                  // sheet knows whether it has a footer to draw at all.
                  detailAction={detailFooter}
                  calendarSent={sentToCalendar}
                  onAddToCalendar={
                    canDiarise && onRoster ? () => sendToCalendar(row.match) : undefined
                  }
                />
              );
            }}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                {/* Something to look at where there was previously one grey line
                    of text in the middle of a blank screen. */}
                <Ribbon width={120} height={160} opacity={0.5} />
                <ThemedText style={styles.centered} themeColor="textSecondary">
                  {hiddenByFilters > 0
                    ? `Nothing fits these filters. ${hiddenByFilters} ${
                        hiddenByFilters === 1 ? 'is' : 'are'
                      } hidden — try a wider distance.`
                    : 'No upcoming matches. Propose one to get a table going.'}
                </ThemedText>
              </View>
            }
          />
        )}

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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
  },
  /** Same gutters as the header above it and the filter bar below. */
  setupPrompt: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  subtitle: {
    marginTop: 2,
  },
  filterBar: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  filterChip: {
    paddingVertical: Spacing.two,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  errorBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  /** Same scale as the host controls on My Matches, so cards read consistently. */
  seatButton: {
    paddingVertical: Spacing.one,
    minHeight: 34,
    minWidth: 104,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
  },
  /** Leaving is not the encouraged action, so it gets an outline, not a fill. */
  outlined: {
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  empty: {
    marginTop: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  spinner: {
    marginTop: Spacing.six,
  },
});
