import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { MatchDetailSheet } from '@/components/match-detail-sheet';
import { CardHeading, type PillSpec } from '@/components/kit/cards';
import { AvatarStack, Card, type Player } from '@/components/kit/layout';
import { colors, leagueEdge, text } from '@/constants/design';
import { formatMiles } from '@/lib/geo';
import {
  formatTimeOfDay,
  formatWhen,
  matchTimingNote,
  SEATS_PER_MATCH,
  type Match,
} from '@/lib/matches';

/**
 * Where the signed-in member stands in relation to a match. This is the one
 * thing a card has to convey before anything is read.
 *
 * It used to drive the colour of a bar down the card's left edge. The redesign
 * has no such bar — cards are plain white with no borders — so standing is said
 * in a pill instead, which has the advantage of being readable as words rather
 * than decoded from a colour.
 */
export type Standing = 'hosting' | 'seated' | 'joinable' | 'full' | 'canceled' | 'completed';

export function standingFor(match: Match, userId: string): Standing {
  if (match.status === 'canceled') return 'canceled';
  if (match.status === 'completed') return 'completed';
  if (match.host_id === userId) return 'hosting';
  if (match.players.some((player) => player.player_id === userId)) return 'seated';
  if (match.players.length >= SEATS_PER_MATCH) return 'full';
  return 'joinable';
}

/** Initials for the avatar fallback: first letters of the first two words. */
export function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/** The kit's avatar shape, from a match's roster row. */
export function playersOf(match: Match): Player[] {
  return match.players.map((player) => ({
    id: player.player_id,
    initials: initialsOf(player.profile?.name),
    photoUrl: player.profile?.avatar_url ?? null,
  }));
}

/**
 * Whether a date is today or tomorrow, in the match's own time zone.
 *
 * The design names these two outright — TONIGHT and TOMORROW — where the app
 * had one "Happening soon" chip covering both. Worth the distinction: which of
 * the two it is decides whether you are getting your coat.
 */
function whenPillFor(match: Match, now: number): PillSpec | null {
  const zone = match.time_zone ?? undefined;
  const dayOf = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: zone });

  const at = new Date(match.date_time);
  const today = new Date(now);
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000);

  if (dayOf(at) === dayOf(today)) return { label: 'Tonight', tone: 'soon' };
  if (dayOf(at) === dayOf(tomorrow)) return { label: 'Tomorrow', tone: 'soon' };

  // Falls back to what the card said before, for anything further out that is
  // still worth flagging.
  const note = matchTimingNote(match, now);
  if (note === 'soon') return { label: 'Happening soon', tone: 'soon' };
  if (note === 'new') return { label: 'Just added', tone: 'info' };
  return null;
}

/**
 * The pills above a card's title, in the order the design reads them: what the
 * table wants from you first, then when, then what you are to it, then the
 * amenity.
 */
export function pillsFor(match: Match, standing: Standing, now: number | undefined): PillSpec[] {
  const pills: PillSpec[] = [];

  if (match.needs_sub && standing === 'joinable') pills.push({ label: 'Needs a sub', tone: 'sub' });

  const when = now === undefined ? null : whenPillFor(match, now);
  const over = standing === 'completed' || standing === 'canceled';
  if (when && !over) pills.push(when);

  switch (standing) {
    case 'hosting':
      pills.push({ label: 'Hosting', tone: 'hosting' });
      break;
    case 'seated':
      pills.push({ label: "You're in", tone: 'you' });
      break;
    case 'full':
      pills.push({ label: 'Full', tone: 'neutral' });
      break;
    case 'completed':
      pills.push({ label: 'Played', tone: 'neutral' });
      break;
    case 'canceled':
      pills.push({ label: 'Canceled', tone: 'neutral' });
      break;
    case 'joinable':
      break;
  }

  if (match.supplies_provided) pills.push({ label: 'Tiles provided', tone: 'info' });

  return pills;
}

/**
 * The line under a venue.
 *
 * The date tile beside it already carries the weekday and the day of the month,
 * so a league table only needs its league, its table and the time. A single
 * match has no league to name, so it says so and keeps the date.
 */
/**
 * Which calendar day a match belongs on, in the match's own time zone rather
 * than the device's — the same rule §4.2 sets for a date tile's weekday. Used
 * to bucket matches under the days of Browse's calendar view.
 *
 * `en-CA` is a locale trick, not a nod to Canada: it is the one built-in
 * locale whose short date format is already `YYYY-MM-DD`, which is exactly
 * the key a calendar grid wants and saves a hand-rolled formatter.
 */
export function matchDayKey(match: Match) {
  return new Date(match.date_time).toLocaleDateString('en-CA', {
    timeZone: match.time_zone ?? undefined,
  });
}

export function metaFor(match: Match, distance?: number | null) {
  const at = new Date(match.date_time);
  const parts = match.league
    ? [
        match.league.name,
        match.table_number ? `Table ${match.table_number}` : null,
        formatTimeOfDay(at),
      ]
    : ['Single match', formatWhen(match.date_time)];

  if (typeof distance === 'number') parts.push(formatMiles(distance));

  return parts.filter(Boolean).join(' · ');
}

/**
 * One card shape for Browse and My Matches. The screens differ only in what a
 * member can do from them, which arrives as `action`, so the two cannot drift
 * apart in how a match reads.
 */
export function MatchCard({
  match,
  userId,
  action,
  distance,
  now,
  onEdit,
  detailAction,
  calendarSent,
  onAddToCalendar,
}: {
  match: Match;
  userId: string;
  /** The screen's own button — Join, Leave, Edit, Enter scores. */
  action?: ReactNode;
  /**
   * Miles from the member's town, when both ends have coordinates. Null is
   * common and not an error — see the note on `Match.latitude` — so the card
   * simply says nothing rather than "unknown distance", which would be noise on
   * every card for a group that types its venues.
   */
  distance?: number | null;
  /**
   * The instant the list was classified against, captured by the screen when it
   * loaded — see `loadedAt` on My Matches for why the clock is not read here.
   *
   * Optional, and the timing pills are the whole reason it exists: they are
   * aimed at somebody scanning tables they have not seen before.
   */
  now?: number;
  /**
   * Opens the screen's edit sheet on this match. Given by screens that own one;
   * the detail sheet shows the control only to the host.
   */
  onEdit?: () => void;
  /**
   * A control to repeat inside the detail sheet — Browse's Join, so reading a
   * match through to the end does not mean closing it to act.
   *
   * Deliberately separate from `action` rather than reusing it: My Matches' row
   * contains an Edit button that opens a second modal, and running that from
   * inside this one would stack two sheets on top of each other.
   */
  detailAction?: ReactNode;
  /** Passed straight through to the detail sheet's roster — see its own props. */
  calendarSent?: boolean;
  onAddToCalendar?: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const standing = standingFor(match, userId);
  const players = playersOf(match);
  const taken = match.players.length;

  /**
   * Close, then hand over on the next frame. Presenting a modal in the same frame
   * another is being dismissed drops the new one on iOS, which would read as the
   * Edit button doing nothing at all.
   */
  const requestEdit = () => {
    setShowDetail(false);
    requestAnimationFrame(() => onEdit?.());
  };

  return (
    <Card>
      {/*
        Everything except the controls opens the sheet.

        The action row is a sibling rather than a child of this Pressable, which is
        what keeps "tap the card" from also meaning "tap Join". Nesting the two
        would work on native, where the deepest view claims the touch, but not on
        web: react-native-web presses are clicks, and a click bubbles up to every
        handler above it.
      */}
      <Pressable
        onPress={() => setShowDetail(true)}
        accessibilityRole="button"
        accessibilityLabel={`${match.location}, ${formatWhen(match.date_time)}. ${taken} of ${SEATS_PER_MATCH} seats taken. Open match details.`}
        style={({ pressed }) => [{ gap: 3 }, pressed && { opacity: 0.7 }]}>
        <CardHeading
          date={new Date(match.date_time)}
          timeZone={match.time_zone}
          edgeColor={leagueEdge(match.league?.color)}
          pills={pillsFor(match, standing, now)}
          title={match.location}
          meta={metaFor(match, distance)}
          leagueColor={match.league ? leagueEdge(match.league.color) : undefined}
        />
        {/* The street, when the venue came from the place lookup. Kept on the card
            rather than left to the sheet: it is how somebody recognises a venue
            they have been to, and the meta line above is already full. */}
        {match.location_detail ? (
          <Text style={[text.caption, { color: colors.inkMuted, marginLeft: 68 }]} numberOfLines={1}>
            {match.location_detail}
          </Text>
        ) : null}
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AvatarStack
          players={players}
          seats={SEATS_PER_MATCH}
          size={32}
          // Empty seats are drawn only on a table this member runs; on somebody
          // else's, the gaps are not theirs to fill from here.
          openSeatStyle={standing === 'hosting' ? 'empty' : 'none'}
        />
        <Text style={[text.meta, { color: colors.inkMuted, flex: 1 }]}>
          {standing === 'hosting'
            ? `${taken} of ${SEATS_PER_MATCH}`
            : `${taken} ${taken === 1 ? 'player' : 'players'}`}
        </Text>
        {action}
      </View>

      {showDetail ? (
        <MatchDetailSheet
          match={match}
          userId={userId}
          distance={distance}
          visible
          onClose={() => setShowDetail(false)}
          onEdit={onEdit ? requestEdit : undefined}
          action={detailAction}
          calendarSent={calendarSent}
          onAddToCalendar={onAddToCalendar}
        />
      ) : null}
    </Card>
  );
}
