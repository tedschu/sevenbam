import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text } from 'react-native';

import { initialsOf } from '@/components/match-card';
import { StandingRow, YourStandingCard } from '@/components/kit/cards';
import { ScopeChips } from '@/components/kit/filters';
import {
  Card,
  ScreenHeader,
  ScreenScaffold,
  SectionHeader,
  TitleBlock,
} from '@/components/kit/layout';
import { colors, text } from '@/constants/design';
import { LeagueColors } from '@/constants/theme';
import { useGlobalView } from '@/hooks/use-global-view';
import { useNeedsProfileSetup } from '@/hooks/use-profile-setup';
import { fetchMyBearings } from '@/lib/profile';

import { fetchLeaderboard, type LeaderboardRow } from '@/lib/leaderboard';
import { fetchLeagueStandings, fetchMyLeagues, type MyLeague } from '@/lib/leagues';
import { supabase } from '@/lib/supabase';

const AppMark = require('@/assets/images/app-mark.png');

type Scope = { id: string | null; label: string; tint: string | null };

/**
 * Both sources carry the same columns now, so the avatar is no longer an optional
 * extra bolted on for the league board — the all-matches view selects it too.
 */
type RankedRow = LeaderboardRow & { rank: number };

/** Equal totals share a rank, and the next rank skips accordingly (1, 2, 2, 4). */
function withRanks<T extends LeaderboardRow>(rows: T[]): (T & { rank: number })[] {
  let lastPoints: number | null = null;
  let lastRank = 0;

  return rows.map((row, index) => {
    if (row.total_points !== lastPoints) {
      lastRank = index + 1;
      lastPoints = row.total_points;
    }
    return { ...row, rank: lastRank };
  });
}

function summarise(row: RankedRow) {
  // Short on purpose. This line is what runs a row out of width, and "completed"
  // was carrying no weight the footnote does not already carry.
  if (row.games_played === 0) return 'No games yet';

  const games = `${row.games_played} ${row.games_played === 1 ? 'game' : 'games'}`;
  const wins = `${row.wins} ${row.wins === 1 ? 'win' : 'wins'}`;
  // Dropped after a single game, where the average is the total already set in the
  // column to the right — and since the average is the last thing on the line, it is
  // the piece that ellipsizes on a narrow phone. Better to spend that room on the
  // two facts that are not repeats.
  // toFixed keeps the column even: the view returns 40.0, which JS would
  // otherwise render as "40" next to "53.3".
  const average =
    row.games_played > 1 && row.average_points !== null
      ? `avg ${row.average_points.toFixed(1)}`
      : null;

  return [games, wins, average].filter(Boolean).join(' · ');
}

/**
 * "Updated 8/8 by April Lane" — who to ask about a number that looks wrong.
 *
 * A total is the end of a chain nobody can see: four people at a table, one of
 * them typing, an organizer correcting it a week later. When it is not what
 * somebody remembers, the screen used to offer them nothing to do about it, so
 * they either accepted a number they thought was wrong or asked the whole league.
 *
 * M/D rather than a full date, and no year: this is an annotation on a row, and
 * every score anybody is still arguing about was entered this season.
 *
 * Silent when there is nothing to say — no games yet, or a score recorded before
 * any of this was kept. A line reading "Updated by" with a blank after it would be
 * worse than the absence.
 */
function provenance(row: RankedRow) {
  if (!row.score_updated_at) return null;

  const when = new Date(row.score_updated_at);
  if (Number.isNaN(when.getTime())) return null;

  const date = `${when.getMonth() + 1}/${when.getDate()}`;
  return row.score_updated_by_name
    ? `Updated ${date} by ${row.score_updated_by_name}`
    : `Updated ${date}`;
}

/** "1st", "2nd", "3rd", "4th" — for the standing card's headline. */
function ordinal(rank: number) {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * The sentence under the viewer's own rank.
 *
 * Says the gap rather than the position, because the position is already the
 * headline — what a member cannot read off the list at a glance is how far away
 * the next number is.
 */
function standingDetail(mine: RankedRow, rows: RankedRow[]) {
  const games = `${mine.games_played} ${mine.games_played === 1 ? 'game' : 'games'}`;
  const wins = `${mine.wins} ${mine.wins === 1 ? 'win' : 'wins'}`;
  const tail = `${games}, ${wins} so far.`;

  if (mine.rank === 1) {
    const next = rows.find((row) => row.rank > 1);
    const lead = next ? mine.total_points - next.total_points : 0;
    if (!next || lead <= 0) return `You are top of the board. ${tail}`;
    return `You're in the lead by ${lead} ${lead === 1 ? 'point' : 'points'}. ${tail}`;
  }

  const leader = rows[0];
  const behind = leader ? leader.total_points - mine.total_points : 0;
  const who = leader?.name?.split(/\s+/)[0] ?? 'the leader';
  return `${behind} ${behind === 1 ? 'point' : 'points'} behind ${who}. ${tail}`;
}

export default function LeaderboardScreen() {
  const globalView = useGlobalView();
  const needsSetup = useNeedsProfileSetup();
  const [rows, setRows] = useState<RankedRow[]>([]);
  const [me, setMe] = useState<{ name: string | null; avatarUrl: string | null }>({
    name: null,
    avatarUrl: null,
  });
  const [userId, setUserId] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  // null means every match, league or not. Leagues are picked by id.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [scopeChosen, setScopeChosen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUserId(user?.id ?? null);
      if (user) setMe(await fetchMyBearings(user.id));

      const mine = user ? await fetchMyLeagues(user.id, globalView) : [];
      setLeagues(mine);

      // Default to the first league, because league standings are the ones with
      // stakes. Falls back to everything for someone not in a league yet.
      const scope = scopeChosen ? scopeId : (mine[0]?.id ?? null);
      if (!scopeChosen) setScopeId(scope);

      setRows(scope === null ? withRanks(await fetchLeaderboard()) : withRanks(await fetchLeagueStandings(scope)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the standings.');
    }
  }, [scopeChosen, scopeId, globalView]);

  // Standings move whenever a host enters scores, so refetch on focus.
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

  const playedCount = rows.filter((row) => row.games_played > 0).length;
  const activeLeague = leagues.find((league) => league.id === scopeId) ?? null;

  // Only worth showing when there is more than one thing to pick between.
  const scopes: Scope[] = [
    { id: null, label: 'All matches', tint: null },
    ...leagues.map((league) => ({
      id: league.id,
      label: league.name,
      tint: LeagueColors[league.color] ?? null,
    })),
  ];

  const mine = rows.find((row) => row.player_id === userId) ?? null;
  const leaderPoints = rows[0]?.total_points ?? 0;

  return (
    <ScreenScaffold refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
      <ScreenHeader
        logo={AppMark}
        initials={initialsOf(me.name)}
        photoUrl={me.avatarUrl}
        badge={needsSetup}
        onProfilePress={() => router.push('/profile')}
      />

      <TitleBlock
        eyebrow={
          playedCount === 0
            ? 'No cards recorded'
            : `${playedCount} ${playedCount === 1 ? 'member' : 'members'} playing`
        }
        title="Leaderboard"
        subtitle={
          activeLeague ? `${activeLeague.name}, by total points` : 'Every match, by total points'
        }
      />

      {/* One chip per league you are in, plus everything. Leagues you are not in
          are not offered, and RLS would not return them anyway. */}
      {scopes.length > 1 ? (
        <ScopeChips
          value={scopeId ?? 'all'}
          onChange={(next) => {
            setScopeChosen(true);
            setScopeId(next === 'all' ? null : next);
          }}
          options={scopes.map((scope) => ({
            value: scope.id ?? 'all',
            label: scope.label,
            dotColor: scope.tint ?? undefined,
          }))}
        />
      ) : null}

      {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Hidden for somebody who is not in this scope at all — a standing card
              with nothing in it is worse than none. */}
          {mine ? (
            <YourStandingCard
              me={{
                id: mine.player_id,
                initials: initialsOf(mine.name),
                photoUrl: mine.avatar_url,
              }}
              rank={mine.games_played === 0 ? 'Unranked' : ordinal(mine.rank)}
              points={mine.total_points}
              detail={
                mine.games_played === 0
                  ? 'No games yet. Your first card puts you on the board.'
                  : standingDetail(mine, rows)
              }
            />
          ) : null}

          <SectionHeader title="Standings" />
          {rows.length > 0 ? (
            <Card padding={8} gap={0}>
              {rows.map((row) => (
                <StandingRow
                  key={row.player_id}
                  rank={row.games_played === 0 ? '—' : row.rank}
                  player={{
                    id: row.player_id,
                    initials: initialsOf(row.name),
                    photoUrl: row.avatar_url,
                  }}
                  /* A closed account keeps its results but not its name, so it is
                     marked rather than left looking like a member who never filled
                     their profile in. */
                  name={`${row.name ?? 'Unnamed member'}${row.deleted ? ' (deleted)' : ''}`}
                  isMe={row.player_id === userId}
                  points={row.total_points}
                  leaderPoints={leaderPoints}
                  /* Who to ask about a number that looks wrong, kept per row
                     rather than folded into the footnote: a total is the end of a
                     chain nobody can see. */
                  detail={[summarise(row), provenance(row)].filter(Boolean).join(' · ')}
                />
              ))}
            </Card>
          ) : (
            <Text style={[text.meta, { color: colors.inkMuted, textAlign: 'center' }]}>
              No members yet.
            </Text>
          )}

          {rows.some((row) => row.games_played > 0) ? (
            <Text style={[text.caption, { color: colors.inkMuted, textAlign: 'center' }]}>
              Totals count finished matches with scores entered.
            </Text>
          ) : null}
        </>
      )}
    </ScreenScaffold>
  );
}
