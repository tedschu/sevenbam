import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  CardShadow,
  LeagueColors,
  MaxContentWidth,
  Radius,
  Spacing,
} from '@/constants/theme';
import { useGlobalView } from '@/hooks/use-global-view';
import { useTheme } from '@/hooks/use-theme';
import { fetchLeaderboard, type LeaderboardRow } from '@/lib/leaderboard';
import { fetchLeagueStandings, fetchMyLeagues, type MyLeague } from '@/lib/leagues';
import { supabase } from '@/lib/supabase';

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
 * A row of the standings, set the way a hand and its value sit on the NMJL
 * card: the name on the left, the points right-aligned in the margin, and a
 * leader rule carrying the eye across the gap between them.
 */
function StandingRow({ row, isCurrentUser }: { row: RankedRow; isCurrentUser: boolean }) {
  const theme = useTheme();
  const unplayed = row.games_played === 0;

  return (
    <ThemedView
      type={isCurrentUser ? 'backgroundSelected' : 'background'}
      style={[styles.row, styles.raised, { borderColor: theme.rule }]}>
      <ThemedText
        type="figureSmall"
        style={styles.rank}
        themeColor={unplayed ? 'textSecondary' : 'textSecondary'}>
        {unplayed ? '—' : row.rank}
      </ThemedText>

      {/* Ringed in the card surface, not the hairline rule: on the highlighted
          row the rule is nearly the same value as the highlight and the ring
          disappeared. */}
      <Avatar
        person={{ name: row.name, avatar_url: row.avatar_url }}
        size={30}
        ring={isCurrentUser ? theme.background : theme.rule}
      />

      <View style={styles.identity}>
        {/* A closed account keeps its results but not its name, so it is marked
            rather than left looking like a member called "Player 3f2a" who never
            filled their profile in. Set in the secondary ink so the note reads as
            an annotation and not as part of the name. */}
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {row.name ?? 'Unnamed member'}
          {isCurrentUser ? ' (you)' : ''}
          {row.deleted ? (
            <ThemedText type="small" themeColor="textSecondary">
              {'  (deleted)'}
            </ThemedText>
          ) : null}
        </ThemedText>
        {/* Clipped rather than wrapped: the row is a single line by design, and a
            summary that wraps would make each card a different height. */}
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {summarise(row)}
        </ThemedText>
      </View>

      {/* Drawn from the secondary ink rather than the hairline rule colour, which is
          tuned for card edges and disappears against the highlighted row — then taken
          most of the way back down with opacity, because at full strength a hairline
          in a 4.7:1 ink reads as a black line rather than a leader rule. */}
      <View style={[styles.leader, { borderColor: theme.textSecondary }]} />

      <ThemedText
        type="figure"
        style={[
          styles.points,
          // Deep amber rather than the amber fill: this is a 22px numeral, and
          // `#ffa35a` on white is 2.0:1.
          { color: row.rank === 1 && !unplayed ? theme.accentWarmInk : theme.text },
          unplayed && styles.muted,
        ]}>
        {row.total_points}
      </ThemedText>
    </ThemedView>
  );
}

export default function LeaderboardScreen() {
  const globalView = useGlobalView();
  const theme = useTheme();
  const [rows, setRows] = useState<RankedRow[]>([]);
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

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="label" themeColor="accentInk">
            {playedCount === 0
              ? 'No cards recorded'
              : `${playedCount} ${playedCount === 1 ? 'member' : 'members'} playing`}
          </ThemedText>
          <ThemedText type="title">{activeLeague ? activeLeague.name : 'Leaderboard'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {activeLeague ? 'League standings, by total points' : 'Every match, by total points'}
          </ThemedText>
        </View>

        {/* One chip per league you are in, plus everything. Leagues you are not
            in are not offered, and RLS would not return them anyway. */}
        {scopes.length > 1 ? (
          <View style={styles.scopes}>
            {scopes.map((scope) => {
              const selected = scope.id === scopeId;
              return (
                <Pressable
                  key={scope.id ?? 'all'}
                  onPress={() => {
                    setScopeChosen(true);
                    setScopeId(scope.id);
                  }}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={selected ? 'backgroundSelected' : 'background'}
                    style={[
                      styles.scopeChip,
                      { borderColor: selected && scope.tint ? scope.tint : theme.rule },
                    ]}>
                    {scope.tint ? (
                      <View style={[styles.scopeDot, { backgroundColor: scope.tint }]} />
                    ) : null}
                    {/* The dot carries the league's colour; the label stays on
                        readable ink. Several league colours are pastels that
                        cannot be read as 11px type. */}
                    <ThemedText type="label" themeColor={selected ? 'text' : 'textSecondary'}>
                      {scope.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {error ? (
          <ThemedText type="small" style={[styles.errorBanner, { color: theme.danger }]}>
            {error}
          </ThemedText>
        ) : null}

        {isLoading ? (
          <ActivityIndicator style={styles.centered} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.player_id}
            renderItem={({ item }) => (
              <StandingRow row={item} isCurrentUser={item.player_id === userId} />
            )}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <ThemedText style={styles.centered} themeColor="textSecondary">
                No members yet.
              </ThemedText>
            }
            ListFooterComponent={
              rows.some((row) => row.games_played > 0) ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                  Totals count finished matches with scores entered.
                </ThemedText>
              ) : null
            }
          />
        )}
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
  subtitle: {
    marginTop: 2,
  },
  errorBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  scopes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 36,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scopeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    // Eight, not sixteen. Five columns means four gaps, so sixteen spent 64px of
    // the 345px a card gets on a 393pt phone — enough that a name the length of
    // "Anna Lettenberger" left the score with no padding at all.
    gap: Spacing.two,
  },
  /** Same faint lift as the match cards, so both read as the same material. */
  raised: Platform.select({
    android: { elevation: 2 },
    default: { boxShadow: CardShadow },
  }),
  rank: {
    minWidth: 20,
    textAlign: 'right',
  },
  muted: {
    opacity: 0.45,
  },
  /**
   * The block that gives way when a row runs out of room, and the fix for scores
   * sitting hard against the card edge.
   *
   * `flexShrink` is the whole bug: it defaults to 0 for a View in Yoga and in
   * react-native-web both, so this held its full intrinsic width and refused to give
   * any back. A long name or a long summary pushed the row wider than the card and
   * carried the score out past the padding with it — which is also why the
   * `numberOfLines` above never truncated anything. It had all the width it asked
   * for. `minWidth: 0` is already RNW's default for a View and is stated here only
   * so the shrink does not depend on that.
   */
  identity: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  /** Carries the eye from the name across to the value, as the card's rules do. */
  leader: {
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
    // Grey, not black. Applied as opacity rather than as a fourth grey in the
    // palette so it still follows the secondary ink into dark mode, where a fixed
    // light grey would be the wrong direction entirely. Lands on #bec0c6 over a
    // white card, #565c68 over a dark one, and stays visible on the yellow
    // highlight — which a paler token from the palette would not.
    opacity: 0.45,
    // Short enough to still read as a rule once the row is tight. The name gives
    // way before this does, because a clipped name is better than a lost score.
    minWidth: Spacing.three,
  },
  /**
   * No width of its own, deliberately. The leader rule above takes every pixel the
   * row has spare, so the score is always flush against the right padding whether it
   * reads 8 or 1200 — a fixed column would only take 40px off the name to buy an
   * alignment the layout already guarantees. `flexShrink: 0` is the part that
   * matters: the numeral must never be the thing that gives way.
   */
  points: {
    flexShrink: 0,
    textAlign: 'right',
  },
  footnote: {
    marginTop: Spacing.three,
    textAlign: 'center',
  },
  centered: {
    marginTop: Spacing.six,
    textAlign: 'center',
  },
});
