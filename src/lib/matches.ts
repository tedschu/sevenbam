import { supabase } from './supabase';

/** Seats at a mahjong table. Mirrors public.match_seat_limit() in the database. */
export const SEATS_PER_MATCH = 4;

const MATCH_SELECT = `
  id, date_time, created_at, location, location_detail, notes, supplies_provided, status, host_id,
  needs_sub,
  latitude, longitude, league_id, session_id, table_number,
  league:leagues (id, name, color),
  host:profiles!matches_host_id_fkey (id, name),
  players:match_players (player_id, score, profile:profiles (id, name, avatar_url))
`;

export type Match = {
  id: string;
  date_time: string;
  /**
   * A league table whose organizer has opened its empty seats to people outside
   * the league. Always false for a pick-up match, which is open to everyone by
   * nature and needs no flag to say so.
   */
  needs_sub: boolean;
  /** When the match was proposed, which is what makes a card new rather than soon. */
  created_at: string;
  /** The venue's name, and the only part a card leads with. */
  location: string;
  /** Street address, when the venue came from the place lookup. */
  location_detail: string | null;
  /**
   * Where the venue is, when it came from the place lookup and Google had a
   * position for it. Null for anything typed by hand and for every match
   * proposed before the distance filter existed — so Browse treats null as
   * "always show", not as "too far".
   */
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  supplies_provided: boolean | null;
  status: string | null;
  host_id: string;
  /** The league this counts toward, or null for a pick-up game. At most one. */
  league_id: string | null;
  /** Set only for tables produced by a league draw. */
  session_id: string | null;
  /** Which table of the session this is, when it came from a draw. */
  table_number: number | null;
  league: { id: string; name: string; color: string } | null;
  host: { id: string; name: string | null } | null;
  players: {
    player_id: string;
    score: number | null;
    profile: { id: string; name: string | null; avatar_url: string | null } | null;
  }[];
};

/**
 * How long a sitting is assumed to run.
 *
 * Matches record when they start but not when they finish, so anything that needs
 * an end has to assume one. Three hours is a normal sitting.
 *
 * Lives here rather than in `calendar.ts`, where it started: it is a fact about
 * matches, and two callers now need it to agree — an event's end time and the line
 * between a game still to come and one already played.
 */
export const AssumedMatchHours = 3;

/**
 * Whether a match is over — either because it was closed out, or because its time
 * has simply come and gone.
 *
 * The second half is the part that was missing. My Matches sorted its two sections
 * on `status` alone, so a match nobody scored and nobody canceled stayed under
 * "Upcoming" indefinitely: last week's game still listed as though it were ahead
 * of you. Status says what was recorded about a match, not whether it has happened.
 *
 * The assumed length is added rather than comparing against the start time, so a
 * game does not move to "Past" at 7:01pm while its players are still arriving.
 *
 * `now` is a parameter so a list can classify every row against a single instant
 * instead of re-reading the clock per item, and so this is testable.
 */
export function hasFinished(match: Match, now = Date.now()) {
  if (match.status === 'completed' || match.status === 'canceled') return true;
  return new Date(match.date_time).getTime() + AssumedMatchHours * 60 * 60 * 1000 < now;
}

/**
 * How long a card's timing labels last, on either side of now.
 *
 * One window rather than two, because "posted in the last two days" and "starting
 * in the next two days" are the same span read backwards and forwards. Two days
 * is what makes both true of somebody who checks Browse every few days: long
 * enough that Friday's new table is still flagged on Sunday, short enough that a
 * table three weekends out is not called imminent.
 */
export const NoticeWindowHours = 48;

export type TimingNote = 'soon' | 'new';

/**
 * Which of the two timing labels something in Browse should carry, or null — most
 * cards are neither new nor imminent, and a label on every card is a label on
 * none of them.
 *
 * `soon` wins when both are true, because it is the one that changes what you do:
 * a table tomorrow night is a yes-or-no you owe an answer on this evening, while
 * "just added" only says you have not seen it before. At most one either way; the
 * rows these sit in already carry a date, a league and a standing.
 *
 * Takes timestamps rather than a match, so a league can put the same rule on its
 * next meetup. Both are nullable for that caller's sake — a league with nothing
 * scheduled has no start, and `public_leagues()` does not return a creation date.
 */
export function timingNote(
  startsAt: string | null,
  createdAt: string | null,
  now: number
): TimingNote | null {
  const window = NoticeWindowHours * 60 * 60 * 1000;

  // Ahead, not merely close. A game that started an hour ago is under way, and
  // "happening soon" is the one thing it is not.
  if (startsAt !== null) {
    const startsIn = new Date(startsAt).getTime() - now;
    if (startsIn > 0 && startsIn <= window) return 'soon';
  }

  if (createdAt !== null && now - new Date(createdAt).getTime() <= window) return 'new';

  return null;
}

/**
 * The same rule for a match, with the one thing a match can be that a date cannot:
 * over. Nothing about a game that has been played, called off, or simply gone by
 * is news, and none of it is about to happen — so a card in that state stays bare
 * even if it was proposed this morning.
 */
export function matchTimingNote(match: Match, now: number) {
  if (hasFinished(match, now)) return null;
  return timingNote(match.date_time, match.created_at, now);
}

export function isSeated(match: Match, userId: string) {
  return match.players.some((player) => player.player_id === userId);
}

/**
 * "Sat, Aug 8 · 6:30 pm CDT".
 *
 * The zone label comes from the viewer's own clock rather than a fixed string,
 * so it reads CDT through the summer and CST after the change, and stays true
 * for someone reading it from another timezone.
 */
export function formatWhen(dateTime: string) {
  const date = new Date(dateTime);

  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return `${day} · ${formatTimeWithZone(date)}`;
}

/**
 * "Saturday, August 8 · 6:30 pm CDT".
 *
 * The long form, for the detail sheet. A card has to fit a venue and a date on
 * one line and so abbreviates both; a sheet has the room to spell the day out,
 * which is worth it when the question being answered is "can I make this?".
 *
 * The year appears only when it is not the current one, because "2026" on every
 * row this year is noise that earns its place exactly once — in December, when
 * January is a month away.
 */
export function formatFullWhen(dateTime: string) {
  const date = new Date(dateTime);

  const day = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });

  return `${day} · ${formatTimeWithZone(date)}`;
}

/**
 * `hour12` is forced rather than left to the locale: a 24-hour clock is what we
 * are deliberately moving away from, and an en-GB browser would otherwise put it
 * straight back.
 *
 * formatToParts rather than a string replace, because it is specifically the
 * meridiem that wants lowercasing — locales without one simply have no such part.
 */
function formatTimeWithZone(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
    .formatToParts(date)
    .map((part) => (part.type === 'dayPeriod' ? part.value.toLowerCase() : part.value))
    .join('');
}

/** "6:30 pm", for prefilling the time field when editing a match. */
export function formatTimeOfDay(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .formatToParts(date)
    .map((part) => (part.type === 'dayPeriod' ? part.value.toLowerCase() : part.value))
    .join('');
}

/**
 * Accepts "6:30 pm", "6:30pm", "6 pm", and a bare "18:30" for anyone who still
 * types it that way, so nobody has to learn a format. Returns hour and minute on
 * a 24-hour clock, or null when it cannot be read.
 */
export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const match = input.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
}

/** Matches the signed-in member is seated at, plus any they host but have not taken a seat in. */
export async function fetchMyMatches(userId: string, globalView = false): Promise<Match[]> {
  // Every match there is, for an admin in global view. No seat lookup, because
  // the question is not which of these they are in — it is what the app holds.
  if (globalView) {
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .order('date_time');

    if (error) throw error;
    return (data ?? []) as Match[];
  }

  const { data: seats, error: seatsError } = await supabase
    .from('match_players')
    .select('match_id')
    .eq('player_id', userId);

  if (seatsError) throw seatsError;

  const seatedIds = seats.map((seat) => seat.match_id);
  const query = supabase.from('matches').select(MATCH_SELECT).order('date_time');

  // `id.in.()` is not valid PostgREST, so only widen the filter when there are seats.
  const { data, error } = await (seatedIds.length
    ? query.or(`host_id.eq.${userId},id.in.(${seatedIds.join(',')})`)
    : query.eq('host_id', userId));

  if (error) throw error;
  return (data ?? []) as Match[];
}

export type NewMatch = {
  date_time: string;
  location: string;
  location_detail: string | null;
  /**
   * Written together or not at all — the database enforces the pair. Null when
   * the venue was typed rather than picked, or when the lookup came back empty.
   */
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  supplies_provided: boolean;
  league_id: string | null;
};

/**
 * Post a match with the signed-in member as host. The host's seat is taken by
 * the seat_host_after_match_insert trigger, so this does not insert one.
 */
export async function createMatch(hostId: string, match: NewMatch): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .insert({ ...match, host_id: hostId })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Upcoming pick-up matches, soonest first.
 *
 * League matches are deliberately excluded. Their seats are dealt by the draw
 * rather than claimed, so offering a Join button on one would be a lie — and a
 * non-member could take a seat in a league they are not in. They appear on the
 * league's own screen and in My Matches.
 */
export async function fetchUpcomingMatches(globalView = false): Promise<Match[]> {
  const query = supabase
    .from('matches')
    .select(MATCH_SELECT)
    .in('status', ['open', 'full'])
    .gte('date_time', new Date().toISOString())
    .order('date_time');

  // League tables are dealt rather than claimed, so they stay out of Browse —
  // except the ones an organizer has opened to subs, which is exactly a league
  // table asking to be claimed. The insert policy on `match_players` makes the
  // matching exception, so the Join button here is not offering something the
  // database will refuse.
  //
  // Global view lifts that, since a dealt table is precisely what an admin came
  // to look at. Their Join buttons are a different question and are answered the
  // same way they always were — by the insert policy, which has not changed and
  // will still refuse a seat at a league they are not in.
  const { data, error } = await (globalView
    ? query
    : query.or('league_id.is.null,needs_sub.eq.true'));

  if (error) throw error;
  return (data ?? []) as Match[];
}

/**
 * Take a seat. Capacity and the open/full status are enforced by database
 * triggers, so a full or closed match rejects the insert rather than silently
 * overfilling.
 */
export async function joinMatch(matchId: string, userId: string) {
  const { error } = await supabase
    .from('match_players')
    .insert({ match_id: matchId, player_id: userId });

  if (error) throw error;
}

/**
 * Record the card and close the match, in one server-side step. The database
 * checks that the caller hosts the match and that every seat has a score, so a
 * half-entered card can never close a match or leave someone on zero in the
 * standings. Safe to call again to correct a mistake.
 */
export async function enterMatchScores(
  matchId: string,
  scores: { player_id: string; score: number }[]
) {
  const { error } = await supabase.rpc('enter_match_scores', {
    p_match_id: matchId,
    p_scores: scores,
  });

  if (error) throw error;
}

/**
 * Change the details of a match. `status` is deliberately not touched, so
 * editing a full match does not reopen it. RLS restricts this to the host.
 */
export async function updateMatch(matchId: string, changes: NewMatch) {
  const { error } = await supabase.from('matches').update(changes).eq('id', matchId);
  if (error) throw error;
}

/**
 * Call off a match without erasing it. The seats stay and the match shows as
 * canceled, so a table does not silently disappear from three other people's
 * lists with no explanation.
 *
 * The status sticks: sync_match_status only rewrites rows that are open or full,
 * so someone leaving afterwards cannot flip this back to open.
 */
export async function cancelMatch(matchId: string) {
  const { error } = await supabase.from('matches').update({ status: 'canceled' }).eq('id', matchId);
  if (error) throw error;
}

/**
 * Erase a match outright. Seats go with it via ON DELETE CASCADE. Only offered
 * while the host is the only player, because past that point cancelling is the
 * honest action — see cancelMatch.
 */
export async function deleteMatch(matchId: string) {
  const { error } = await supabase.from('matches').delete().eq('id', matchId);
  if (error) throw error;
}

export async function leaveMatch(matchId: string, userId: string) {
  const { error } = await supabase
    .from('match_players')
    .delete()
    .eq('match_id', matchId)
    .eq('player_id', userId);

  if (error) throw error;
}
