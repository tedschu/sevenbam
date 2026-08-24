import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, EmptySeat } from '@/components/avatar';
import { MatchDetailSheet } from '@/components/match-detail-sheet';
import { ThemedText } from '@/components/themed-text';
import { TimingChip } from '@/components/timing-chip';
import { CardShadow, LeagueColors, Radius, Spacing, type LeagueColor } from '@/constants/theme';
import { useTheme, type Theme } from '@/hooks/use-theme';
import { formatMiles } from '@/lib/geo';
import { formatWhen, matchTimingNote, SEATS_PER_MATCH, type Match } from '@/lib/matches';

/**
 * Where the signed-in member stands in relation to a match. This is the one
 * thing a card has to convey before anything is read, so it drives the colour of
 * the edge bar rather than only appearing as a word somewhere in the text.
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

/**
 * Teal — the interactive colour — for the one thing you can act on. Amber for a
 * match that is yours to run. Secondary ink once you are simply in, and the
 * hairline for matches that want to recede.
 *
 * `bar` is a fill and `note` is type, so they cannot be the same value: four of
 * the brand colours fail contrast as small text. Hence the paired ink.
 */
function appearance(standing: Standing, theme: Theme) {
  switch (standing) {
    case 'hosting':
      return { bar: theme.accentWarm, ink: theme.accentWarmInk, note: 'Hosting', muted: false };
    case 'seated':
      // Lavender — the guide's Accent role. It was the secondary ink, which at
      // 4px read as a heavy dark stripe: louder than the teal bar on the match
      // you can actually act on, which is backwards.
      return { bar: theme.accentAlt, ink: theme.accentAltInk, note: "You're in", muted: false };
    case 'joinable':
      return { bar: theme.accent, ink: theme.accentInk, note: null, muted: false };
    case 'full':
      return { bar: theme.rule, ink: theme.textSecondary, note: 'Full', muted: true };
    case 'canceled':
      return { bar: theme.rule, ink: theme.textSecondary, note: 'Canceled', muted: true };
    case 'completed':
      return { bar: theme.rule, ink: theme.textSecondary, note: 'Played', muted: true };
  }
}

const AvatarSize = 30;

/**
 * Who is at the table, as faces rather than a count. Overlapping keeps four of
 * them inside the space "2/4" used to take, and the empty rings mean the row
 * still says how many seats are left without spelling it out.
 *
 * Not a press target of its own any more. It used to open a roster sheet, but the
 * whole card now opens a sheet that has the roster in it, and two overlapping
 * targets doing almost the same thing was a coin toss over which one you hit.
 */
function SeatAvatars({ match }: { match: Match }) {
  const theme = useTheme();
  const empty = Math.max(0, SEATS_PER_MATCH - match.players.length);

  return (
    <View style={styles.avatars}>
      {match.players.map((player, index) => (
        <View key={player.player_id} style={index > 0 ? styles.overlap : undefined}>
          <Avatar
            person={player.profile ?? { name: null }}
            size={AvatarSize}
            ring={theme.background}
          />
        </View>
      ))}
      {Array.from({ length: empty }, (_, seat) => (
        <View
          key={`empty-${seat}`}
          style={match.players.length + seat > 0 ? styles.overlap : undefined}>
          <EmptySeat size={AvatarSize} ring={theme.background} />
        </View>
      ))}
    </View>
  );
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
   * Optional, and the timing label is the whole reason it exists: "Just added"
   * and "Happening soon" are aimed at somebody scanning tables they have not seen
   * before. On My Matches, where every row is a match you are already in, one is
   * old news and the other is something you put in your own calendar — so that
   * screen passes nothing and gets no label.
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
  const theme = useTheme();
  const [showDetail, setShowDetail] = useState(false);
  const standing = standingFor(match, userId);
  const { bar, ink, note, muted } = appearance(standing, theme);
  const timing = now === undefined ? null : matchTimingNote(match, now);

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
    <View
      style={[
        styles.card,
        styles.raised,
        {
          // White against the tinted page. The reverse — pale blue cards on
          // white — left barely any contrast between card and page, which is
          // what made them read as flat regardless of the shadow.
          backgroundColor: theme.background,
          borderLeftColor: bar,
        },
        muted && styles.muted,
      ]}>
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
        accessibilityLabel={`${match.location}, ${formatWhen(match.date_time)}. ${
          match.players.length
        } of ${SEATS_PER_MATCH} seats taken. Open match details.`}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        {/* Above the venue, where it is the first thing in the card rather than
            the last thing in a row of small print. */}
        {/* One chip, and needing a sub outranks both timing labels: it is the only
            one that says the table wants something from the reader rather than
            merely describing it. */}
        {match.needs_sub ? (
          <TimingChip label="Needs a sub" />
        ) : timing ? (
          <TimingChip label={timing === 'soon' ? 'Happening soon' : 'Just added'} />
        ) : null}

        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            {/* Two lines: a real venue name plus a town does not fit one at phone
                width, and "Geneva Public Library Dist…" is not a venue. */}
            <ThemedText type="subtitle" numberOfLines={2}>
              {match.location}
            </ThemedText>
            {match.location_detail ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {match.location_detail}
              </ThemedText>
            ) : null}
            {/* Under the address, because it is a fact about the same thing. Absent
                rather than "unknown" when there is nothing to say. */}
            {typeof distance === 'number' ? (
              <ThemedText type="small" style={{ color: theme.accentInk }}>
                {formatMiles(distance)}
              </ThemedText>
            ) : null}
          </View>
          <SeatAvatars match={match} />
        </View>

        {/* When, kind, and standing share one line: three short facts that used to
            take three full-width rows between them. */}
        <View style={styles.metaRow}>
          <ThemedText type="defaultSemiBold" themeColor="textSecondary">
            {formatWhen(match.date_time)}
          </ThemedText>
          {/* Named and coloured, so you can tell at a glance which league a table
              belongs to rather than just that it belongs to one.

              The dot carries the league's colour and the label stays on secondary
              ink. Four of the six league colours are pastels that fail contrast as
              11px type, and letting only the dot be coloured also keeps a row of
              tags from reading as six different kinds of text. */}
          {match.league ? (
            <View style={styles.leagueTag}>
              <View
                style={[
                  styles.leagueDot,
                  {
                    backgroundColor:
                      LeagueColors[match.league.color as LeagueColor] ?? theme.accent,
                  },
                ]}
              />
              <ThemedText type="label" themeColor="textSecondary">
                {match.league.name}
                {match.table_number ? ` · Table ${match.table_number}` : ''}
              </ThemedText>
            </View>
          ) : null}
          {match.supplies_provided ? (
            <ThemedText type="label" themeColor="textSecondary">
              Tiles provided
            </ThemedText>
          ) : null}
          {note ? (
            <ThemedText type="label" style={{ color: ink }}>
              {note}
            </ThemedText>
          ) : null}
        </View>

        {match.notes ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {match.notes}
          </ThemedText>
        ) : null}
      </Pressable>

      {/* Controls get the bottom row to themselves at every width. Sharing a line
          with the player names meant one or the other was always being squeezed,
          and it needed a different layout on a phone; this needs neither. */}
      {action ? <View style={styles.actionRow}>{action}</View> : null}

      <MatchDetailSheet
        match={match}
        userId={userId}
        distance={distance}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={onEdit ? requestEdit : undefined}
        action={detailAction}
        calendarSent={calendarSent}
        onAddToCalendar={onAddToCalendar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: Spacing.three,
    paddingRight: Spacing.three,
    // The bar is part of the card's edge rather than a floating stripe, so it
    // survives any width without a second absolutely positioned view.
    paddingLeft: Spacing.three,
    borderLeftWidth: 4,
    borderRadius: Radius.card,
    gap: Spacing.one,
  },
  /**
   * A hairline border read as flat, so the cards lift off the page instead.
   * Android needs `elevation`; the web and iOS shadow props map to a box shadow.
   */
  /**
   * Wide and faint: a low opacity spread over a large radius reads as a lift you
   * notice without ever seeing an edge. See CardShadow for why this is not
   * written with the shadow* props.
   */
  raised: Platform.select({
    android: { elevation: 2 },
    default: { boxShadow: CardShadow },
  }),
  /** Full, canceled and played matches step back rather than competing. */
  muted: {
    opacity: 0.62,
  },
  /**
   * The part of the card that opens the sheet. Carries the gap the card itself
   * used to, so the rows inside it space as they did.
   */
  body: {
    gap: Spacing.one,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  titleBlock: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Each face sits partly under the one before it; the ring keeps them separable. */
  overlap: {
    marginLeft: -10,
  },
  pressed: {
    opacity: 0.7,
  },
  leagueTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  leagueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});
