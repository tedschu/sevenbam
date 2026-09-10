import { supabase } from './supabase';

/**
 * A row of the standings. Mirrors the public.leaderboard view, which is where
 * the ranking formula lives — change it there, not here.
 */
export type LeaderboardRow = {
  player_id: string;
  name: string | null;
  /**
   * Their Google photo, when they have signed in with Google. The view carried
   * every other column of a standings row but not this one, so the all-matches
   * board drew initials for members whose photo the league board was showing.
   */
  avatar_url: string | null;
  games_played: number;
  total_points: number;
  average_points: number | null;
  wins: number;
  average_placement: number | null;
  /**
   * Whether this row belongs to a closed account. Their games stay in the
   * standings — they are part of everyone else's record — but the name is a
   * generated label rather than anything they chose, so the screen marks it.
   */
  deleted: boolean;
  /**
   * When this member's most recent score last changed, and who changed it.
   *
   * The end of a chain the screen otherwise hides: four people at a table, one of
   * them typing, an organizer correcting it a week later. Without this, somebody
   * whose total is not what they remember has nobody to ask — the number simply
   * differs, and there is no way to tell a stale score from a wrong one.
   *
   * Null for a member with no games, and for scores recorded before any of this
   * was kept.
   */
  score_updated_at: string | null;
  score_updated_by_name: string | null;
};

/**
 * Standings ordered by total points, following NMJL practice where accumulated
 * hand values are what rankings are built on. Members who have not finished a
 * match yet come back with zeroes and sort to the bottom.
 */
export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
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
    score_updated_at: row.score_updated_at,
    score_updated_by_name: row.score_updated_by_name,
  }));
}
