import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { supabase } from './supabase';

import type { LeagueColor } from '@/constants/theme';

export type LeagueRole = 'organizer' | 'member';

/**
 * What the signed-in account is to a league, including being nothing to it.
 *
 * `viewer` never comes from the database — there is no such role and
 * `setLeagueRole` will not accept one. It is what an admin reading the app in
 * global view is to a league they do not belong to, and it exists so that every
 * screen drawn from `role` keeps working without learning about admins: a viewer
 * is not an organizer, so no control that asks "may I run this?" appears, and the
 * member-only actions test for it directly.
 */
export type LeagueRelation = LeagueRole | 'viewer';

export type League = {
  id: string;
  name: string;
  color: LeagueColor;
  created_by: string;
  invite_token: string;
  /** Discoverable from Browse. Off unless the organizer turns it on. */
  is_public: boolean;
  /** The organizer's cap, or null for none. */
  max_members: number | null;
  /**
   * When the organizer put this league away, or null while it is live. An
   * archived league keeps everything it has — members, seasons, tables, standings
   * — but is not discoverable, accepts nobody new, and takes no more meetups.
   */
  archived_at: string | null;
};

/**
 * A public league as it appears in Browse, from the `public_leagues()` function.
 *
 * Deliberately not a `League`: it carries no `invite_token`, because that is the
 * credential that joins a league and would bypass the capacity check. Joining
 * from here goes through `joinPublicLeague`.
 */
export type PublicLeague = {
  id: string;
  name: string;
  color: LeagueColor;
  member_count: number;
  max_members: number | null;
  /** Null when the organizer set no cap, which means room without saying how much. */
  seats_left: number | null;
  is_member: boolean;
  next_meetup: string | null;
  next_location: string | null;
  /** The meetup's street address, when its venue was picked from the suggestions. */
  next_location_detail: string | null;
  /** Null for a meetup whose venue was typed rather than picked. */
  next_latitude: number | null;
  next_longitude: number | null;
  /**
   * When the league was started, so Browse can mark a new one. It comes through
   * `public_leagues()` rather than off the table: a league you have not joined is
   * invisible to RLS, so the function is the only place this can be read from.
   */
  created_at: string;
};

/** A league plus where the signed-in member stands in it. */
export type MyLeague = League & {
  role: LeagueRelation;
  /** When the role last changed under them, and when they said they had seen it. */
  roleChangedAt: string | null;
  roleAckAt: string | null;
};

export type LeagueMember = {
  profile_id: string;
  role: LeagueRole;
  profile: { id: string; name: string | null; avatar_url: string | null } | null;
};

export type Season = {
  id: string;
  name: string;
  status: 'active' | 'complete';
};

export type LeagueSession = {
  id: string;
  sequence: number;
  date_time: string;
  location: string;
  location_detail: string | null;
  /** How many tables the draw produced. Zero until it has been drawn. */
  tables: number;
  /** True once any table has been played, at which point redrawing is refused. */
  played: boolean;
  /** Tables of this meetup currently offered to people outside the league. */
  subs_open: number;
};

export type LeagueStanding = {
  player_id: string;
  name: string | null;
  avatar_url: string | null;
  games_played: number;
  total_points: number;
  average_points: number | null;
  wins: number;
  average_placement: number | null;
  /** A closed account, kept in the standings for its results. See LeaderboardRow. */
  deleted: boolean;
};

/**
 * Leagues the signed-in member belongs to, or every league there is when an admin
 * is reading the app in global view.
 *
 * Read through league_members rather than leagues, because the row that says
 * which of them you organize is there.
 */
export async function fetchMyLeagues(userId: string, globalView = false): Promise<MyLeague[]> {
  if (globalView) return fetchEveryLeague(userId);

  const { data, error } = await supabase
    .from('league_members')
    .select(
      'role, role_changed_at, role_ack_at, league:leagues (id, name, color, created_by, invite_token, is_public, max_members, archived_at)'
    )
    .eq('profile_id', userId)
    .order('joined_at');

  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const league = row.league as League | null;
      return league
        ? {
            ...league,
            role: row.role as LeagueRelation,
            roleChangedAt: row.role_changed_at as string | null,
            roleAckAt: row.role_ack_at as string | null,
          }
        : null;
    })
    .filter((league): league is MyLeague => league !== null);
}

/**
 * Every league in the app, for an admin in global view.
 *
 * Two reads rather than one: the leagues, and separately whatever the admin's own
 * memberships are. Merged so that a league they really are in keeps its real role
 * and behaves exactly as it always does — global view is meant to add leagues to
 * the list, not to change the ones already on it.
 *
 * Everything else comes back as `viewer`, which is not a role and is never
 * written anywhere. Looking at a league does not join it: there is no membership
 * row, no seat, and no way to get one from here, because the admin policies are
 * `for select` and nothing else. A viewer is simply someone the league does not
 * know about who can nonetheless read it.
 *
 * Ordered by name rather than by joined_at, which is meaningless for a list that
 * is mostly leagues this account never joined.
 */
async function fetchEveryLeague(userId: string): Promise<MyLeague[]> {
  const [all, mine] = await Promise.all([
    supabase
      .from('leagues')
      .select('id, name, color, created_by, invite_token, is_public, max_members, archived_at')
      .order('name'),
    fetchMyLeagues(userId),
  ]);

  if (all.error) throw all.error;

  const byId = new Map(mine.map((league) => [league.id, league]));

  return (all.data ?? []).map(
    (league) =>
      byId.get(league.id) ?? {
        ...(league as League),
        role: 'viewer' as const,
        roleChangedAt: null,
        roleAckAt: null,
      }
  );
}

/**
 * Whether this member has been handed the league, or had it taken back, since
 * they last said they had seen it.
 *
 * A comparison rather than a flag so a second change re-announces itself, and
 * false for a membership that has never changed — joining as a member is not news
 * to the person who just joined.
 */
export function hasUnseenRoleChange(league: MyLeague) {
  if (!league.roleChangedAt) return false;
  if (!league.roleAckAt) return true;

  return new Date(league.roleChangedAt) > new Date(league.roleAckAt);
}

/**
 * Marks the notice as read.
 *
 * An RPC rather than an update, because the update policy on `league_members` is
 * organizer-only and widening it for this would let any member write their own
 * `role`. The function writes the one column instead. See 20260826190000.
 */
export async function acknowledgeRoleChange(leagueId: string) {
  const { error } = await supabase.rpc('acknowledge_league_role_change', {
    p_league: leagueId,
  });

  if (error) throw error;
}

/**
 * Create a league. The creator is made its organizer by a trigger, so there is
 * no second write here that could fail and leave a league nobody administers.
 */
export async function createLeague(
  userId: string,
  name: string,
  color: LeagueColor,
  visibility: { is_public: boolean; max_members: number | null } = {
    is_public: false,
    max_members: null,
  }
): Promise<string> {
  const { data, error } = await supabase
    .from('leagues')
    .insert({ name: name.trim(), color, created_by: userId, ...visibility })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/** Turn discoverability on or off, and set or clear the cap. Organizers only. */
export async function updateLeagueVisibility(
  leagueId: string,
  changes: { is_public: boolean; max_members: number | null }
) {
  const { error } = await supabase.from('leagues').update(changes).eq('id', leagueId);
  if (error) throw error;
}

/**
 * Public leagues anyone signed in can find, with their next meetup.
 *
 * Read through a function rather than the table: the select policy on `leagues`
 * is membership-based and widening it would expose every public league's invite
 * token. See the migration for the full reasoning.
 */
export async function fetchPublicLeagues(): Promise<PublicLeague[]> {
  const { data, error } = await supabase.rpc('public_leagues');
  if (error) throw error;
  return (data ?? []) as PublicLeague[];
}

/**
 * Join a public league. Capacity is checked inside the same statement that
 * inserts, so a stale seat count on the client cannot overfill a league.
 */
export async function joinPublicLeague(leagueId: string) {
  const { error } = await supabase.rpc('join_public_league', { p_league_id: leagueId });
  if (error) throw error;
}

/**
 * Put a league away, or bring it back. Organizers only — the update policy on
 * `leagues` enforces that, not this.
 *
 * Archiving is deliberately the reversible half of "I am done with this league":
 * it un-lists the league and closes both doors into it (see the migration) while
 * every season, table and score stays exactly where it was.
 */
export async function setLeagueArchived(leagueId: string, archived: boolean) {
  const { error } = await supabase
    .from('leagues')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', leagueId);

  if (error) throw error;
}

/**
 * What deleting a league would take with it.
 *
 * Read before offering the delete, because the honest confirmation is a count
 * rather than a warning. `matches` is world-readable and seasons are readable by
 * members, so this needs no privileged function of its own.
 */
export type LeagueFootprint = {
  seasons: number;
  /** Tables the draw produced, across every season. */
  tables: number;
  /** Of those, the ones with scores recorded — the part that cannot be rebuilt. */
  played: number;
};

export async function fetchLeagueFootprint(leagueId: string): Promise<LeagueFootprint> {
  const [seasons, matches] = await Promise.all([
    supabase.from('seasons').select('id').eq('league_id', leagueId),
    // Only drawn tables count here. A match merely tagged with the league has no
    // session and survives a delete as a pick-up game, so counting it would
    // overstate the damage.
    supabase
      .from('matches')
      .select('id, status')
      .eq('league_id', leagueId)
      .not('session_id', 'is', null),
  ]);

  if (seasons.error) throw seasons.error;
  if (matches.error) throw matches.error;

  const drawn = matches.data ?? [];

  return {
    seasons: (seasons.data ?? []).length,
    tables: drawn.length,
    played: drawn.filter((match) => match.status === 'completed').length,
  };
}

/**
 * Erase a league, its seasons, its meetups and the tables they were drawn into.
 *
 * Goes through a function rather than deleting the row, and not for permission
 * reasons: two referential actions on `matches` collide when a league row is
 * removed, so deleting one that had ever been drawn failed with a foreign key
 * error. The function fixes the order. See 20260815201500 for the full account.
 *
 * It also refuses once any table has been played — the same rule the UI applies,
 * enforced where it cannot be talked out of. Matches merely tagged with the league
 * survive as pick-up games.
 */
export async function deleteLeague(leagueId: string) {
  const { error } = await supabase.rpc('delete_league', { p_league_id: leagueId });
  if (error) throw error;
}

export async function updateLeague(leagueId: string, changes: { name: string; color: LeagueColor }) {
  const { error } = await supabase
    .from('leagues')
    .update({ name: changes.name.trim(), color: changes.color })
    .eq('id', leagueId);

  if (error) throw error;
}

export async function fetchLeagueMembers(leagueId: string): Promise<LeagueMember[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select('profile_id, role, profile:profiles (id, name, avatar_url)')
    .eq('league_id', leagueId)
    .order('joined_at');

  if (error) throw error;
  return (data ?? []) as LeagueMember[];
}

/**
 * Hands the league to another member, or takes it back.
 *
 * A plain update rather than an RPC: the "Organizers can change roles" policy
 * already says who may do this, so a function would only restate it somewhere
 * else. The one rule RLS cannot express — that the last organizer may not step
 * down — is a trigger on the table, so the error surfaces here as an ordinary
 * failed write with a message worth showing. See 20260826180000.
 *
 * Organizer is the whole of running a league, not a lesser deputy role: whoever
 * holds it can move meetups, draw tables, archive, delete, and promote further
 * organizers. There is deliberately no rank among them and none of it keys off
 * `created_by`, so handing it over is a real handover rather than a loan.
 */
export async function setLeagueRole(leagueId: string, profileId: string, role: LeagueRole) {
  const { error } = await supabase
    .from('league_members')
    .update({ role })
    .eq('league_id', leagueId)
    .eq('profile_id', profileId);

  if (error) throw error;
}

export async function leaveLeague(leagueId: string, userId: string) {
  const { error } = await supabase
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('profile_id', userId);

  if (error) throw error;
}

export async function fetchSeasons(leagueId: string): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, status')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Season[];
}

export async function createSeason(leagueId: string, name: string): Promise<string> {
  const { data, error } = await supabase
    .from('seasons')
    .insert({ league_id: leagueId, name: name.trim() })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * The meetups in a season, each carrying how many tables it has been drawn into.
 * The count comes from the matches pointing back at the session, so it cannot
 * disagree with what was actually drawn.
 */
export async function fetchSessions(seasonId: string): Promise<LeagueSession[]> {
  const { data, error } = await supabase
    .from('league_sessions')
    .select('id, sequence, date_time, location, location_detail, matches (id, status, needs_sub)')
    .eq('season_id', seasonId)
    .order('sequence');

  if (error) throw error;

  return (data ?? []).map((row) => {
    const matches = (row.matches ?? []) as {
      id: string;
      status: string | null;
      needs_sub: boolean | null;
    }[];
    return {
      id: row.id,
      sequence: row.sequence,
      date_time: row.date_time,
      location: row.location,
      location_detail: row.location_detail,
      tables: matches.length,
      played: matches.some((match) => match.status === 'completed'),
      subs_open: matches.filter((match) => match.needs_sub).length,
    };
  });
}

export type NewSession = {
  sequence: number;
  date_time: string;
  location: string;
  location_detail: string | null;
  /** Written together or not at all; Browse measures a league's distance here. */
  latitude: number | null;
  longitude: number | null;
};

export async function createSession(seasonId: string, session: NewSession): Promise<string> {
  const [id] = await createSessions(seasonId, [session]);
  return id;
}

/**
 * Adds a run of meetups in one statement — what a repeating schedule expands to.
 *
 * One insert rather than a loop of them, so a season is created whole or not at
 * all. `league_sessions` is unique on `(season_id, sequence)`, and a partial run
 * that failed halfway would leave the organizer to work out which half landed
 * before they could safely try again.
 */
export async function createSessions(
  seasonId: string,
  sessions: NewSession[]
): Promise<string[]> {
  const { data, error } = await supabase
    .from('league_sessions')
    .insert(sessions.map((session) => ({ season_id: seasonId, ...session })))
    .select('id');

  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/**
 * Moves a meetup, and every table already drawn from it.
 *
 * Runs in the database because the two writes have to agree: the draw copies the
 * meetup's date and venue onto each match, and those copies are what players see
 * in My Matches — so changing the session alone would move the meetup on the
 * league screen and leave the tables pointing at the old room. Tables already
 * played or called off keep what they had.
 *
 * Returns how many tables moved, which is what the screen tells the organizer.
 */
export async function updateSession(
  sessionId: string,
  fields: {
    date_time: string;
    location: string;
    location_detail: string | null;
    latitude: number | null;
    longitude: number | null;
  }
): Promise<number> {
  const { data, error } = await supabase.rpc('update_league_session', {
    p_session_id: sessionId,
    p_date_time: fields.date_time,
    p_location: fields.location,
    // Cast because the type generator marks every argument non-null: Postgres does
    // not record which parameters accept null, and all three of these do — a venue
    // typed by hand has no address and no coordinates.
    p_location_detail: fields.location_detail as string,
    p_latitude: fields.latitude as number,
    p_longitude: fields.longitude as number,
  });

  if (error) throw error;
  return (data as number) ?? 0;
}

/** One drawn table, with who is sitting at it. */
export type SessionTable = {
  id: string;
  table_number: number | null;
  status: string | null;
  /** Offered to people outside the league by the organizer. */
  needs_sub: boolean;
  host_id: string;
  seats: { player_id: string; name: string | null; avatar_url: string | null }[];
};

/**
 * The seating for one meetup.
 *
 * Fetched when a meetup is expanded rather than alongside the meetups themselves:
 * a season is a dozen of them, each with a roster, and a screen that opens by
 * loading every face of every table would pay for a view almost nobody has asked
 * for yet.
 *
 * Needs no privileged function. `matches`, `match_players` and `profiles` are all
 * readable — the first two by everyone, and the profiles behind them under the
 * same `using (true)` policy the rest of the app reads names through.
 */
export async function fetchSessionTables(sessionId: string): Promise<SessionTable[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, table_number, status, needs_sub, host_id, players:match_players (player_id, profile:profiles (id, name, avatar_url))'
    )
    .eq('session_id', sessionId)
    .order('table_number');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    table_number: row.table_number,
    status: row.status,
    needs_sub: row.needs_sub ?? false,
    host_id: row.host_id,
    seats: (
      (row.players ?? []) as {
        player_id: string;
        profile: { id: string; name: string | null; avatar_url: string | null } | null;
      }[]
    ).map((seat) => ({
      player_id: seat.player_id,
      name: seat.profile?.name ?? null,
      avatar_url: seat.profile?.avatar_url ?? null,
    })),
  }));
}

export async function deleteSession(sessionId: string) {
  const { error } = await supabase.from('league_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

/**
 * Shuffle the roster and deal it across as many tables as it takes. Runs in the
 * database because seating other people is something no client is permitted to
 * do. Returns the number of tables.
 */
export async function drawSession(sessionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('draw_league_session', {
    p_session_id: sessionId,
  });

  if (error) throw error;
  return (data as number) ?? 0;
}

export async function joinLeagueWithToken(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_league_with_token', {
    p_token: token.trim(),
  });

  if (error) throw error;
  return data as string;
}

export async function fetchLeagueStandings(leagueId: string): Promise<LeagueStanding[]> {
  const { data, error } = await supabase
    .from('league_standings')
    .select('*')
    .eq('league_id', leagueId)
    .order('total_points', { ascending: false })
    .order('wins', { ascending: false })
    .order('name');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    player_id: row.player_id ?? '',
    name: row.name,
    avatar_url: row.avatar_url,
    games_played: row.games_played ?? 0,
    total_points: row.total_points ?? 0,
    average_points: row.average_points,
    wins: row.wins ?? 0,
    average_placement: row.average_placement,
    deleted: row.deleted ?? false,
  }));
}

/**
 * The link that adds someone to a league.
 *
 * The token rides as a query parameter on /leagues rather than as its own
 * /join/<token> route. `expo-router/ui` Tabs only routes what has a TabTrigger,
 * so a standalone route silently fell through to the first tab — the link
 * appeared to work and quietly did nothing.
 *
 * Built from the running origin on web, so a link copied from localhost points at
 * localhost and one copied from the deployed site points there. Native has no
 * origin to read and falls back to the production host, because a link shared
 * from a phone has to work for whoever receives it.
 */
export function inviteUrlFor(league: League) {
  const origin =
    Platform.OS === 'web' ? window.location.origin : 'https://tschusters-team-mahjong.expo.app';

  return `${origin}/leagues?invite=${league.invite_token}`;
}

/**
 * An invite token held over a sign-in.
 *
 * Google sends people back to the app's origin, not to the URL they started on,
 * so a signed-out person opening an invite link would otherwise land on Browse
 * with the token gone and no idea they had missed anything. Stashing it lets the
 * join finish itself once there is a session.
 */
const PendingInviteKey = 'pending-league-invite';

/** Reads an invite token off the current URL, where an invite link puts it. */
export function inviteTokenFromUrl(): string | null {
  if (Platform.OS !== 'web') return null;

  try {
    return new URL(window.location.href).searchParams.get('invite');
  } catch {
    return null;
  }
}

export async function rememberPendingInvite(token: string) {
  try {
    await AsyncStorage.setItem(PendingInviteKey, token);
  } catch {
    // Worst case the member opens the link again once signed in.
  }
}

export async function takePendingInvite(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(PendingInviteKey);
    // Read once: a token that failed to redeem should not be retried forever.
    if (token) await AsyncStorage.removeItem(PendingInviteKey);
    return token;
  } catch {
    return null;
  }
}
