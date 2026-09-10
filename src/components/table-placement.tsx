import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, EmptySeat } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { OnAccent, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SEATS_PER_MATCH } from '@/lib/matches';
import { type SessionTable } from '@/lib/leagues';

type Seat = { player_id: string; name: string | null; avatar_url: string | null };

/**
 * Moving people between tables by hand.
 *
 * Tap to pick somebody up, tap to put them down — not drag and drop, and that is a
 * choice rather than a shortcut. Dragging has to survive a scrolling list on a
 * phone, a mouse on the web, and a drop target that may be off screen when the
 * gesture starts; it is a large amount of gesture and measurement code whose
 * failure mode is a player who silently lands nowhere. Tapping has none of that,
 * works identically on both platforms, is reachable with a screen reader and
 * a keyboard, and is fewer gestures for the actual job: the common edit is two
 * people swapping, which here is two taps.
 *
 * Tapping a second player swaps the two. That is what makes a full table
 * reachable — there is no empty chair to drop into, so the way in is to trade
 * with somebody who is already there, which is also how it works in the room.
 */
/**
 * One move, as a new arrangement.
 *
 * Pure and exported so it can be reasoned about on its own, which it earned: the
 * first version of this treated a swap as two independent rewrites, one of the
 * table somebody left and one of the table they arrived at. That is correct right
 * up until both are the same table, at which point they are the same array — the
 * first rewrite puts the other player in twice, and the second replaces every copy
 * of them with the person who moved. Two of you, none of them, and a save the
 * database refuses.
 *
 * It is also the commonest move there is. A league of four is one table, and every
 * swap anybody in it can make goes down this path.
 *
 * Positions are written by index for that reason. A swap is one exchange of two
 * slots whether or not they are in the same array, and indices cannot alias the
 * way a predicate over player ids can.
 */
export function moveSeat(
  tables: Seat[][],
  picked: string,
  toTable: number,
  onto: string | null
): Seat[][] {
  const from = tables.findIndex((seats) => seats.some((seat) => seat.player_id === picked));
  if (from === -1 || !tables[toTable]) return tables;

  const next = tables.map((seats) => [...seats]);
  const fromIndex = next[from].findIndex((seat) => seat.player_id === picked);
  if (fromIndex === -1) return tables;

  if (onto && onto !== picked) {
    const ontoIndex = next[toTable].findIndex((seat) => seat.player_id === onto);
    if (ontoIndex === -1) return tables;

    // Each keeps the other's position, so a swap does not quietly reorder a table
    // and hand the scorecard to somebody who did not ask for it.
    const moving = next[from][fromIndex];
    next[from][fromIndex] = next[toTable][ontoIndex];
    next[toTable][ontoIndex] = moving;
    return next;
  }

  if (from === toTable) return tables;
  if (next[toTable].length >= SEATS_PER_MATCH) return tables;

  const [moving] = next[from].splice(fromIndex, 1);
  next[toTable].push(moving);
  return next;
}

export function TablePlacement({
  tables,
  tint,
  onCancel,
  onSave,
}: {
  tables: SessionTable[];
  /** The league's colour, so the editor reads as part of this league. */
  tint: string;
  onCancel: () => void;
  onSave: (tables: string[][]) => Promise<void>;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<Seat[][]>(() => tables.map((table) => [...table.seats]));
  /** Who is in the air. Null when nothing has been picked up. */
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const seatOf = (playerId: string) =>
    draft.flat().find((seat) => seat.player_id === playerId) ?? null;

  const tableOf = (playerId: string) =>
    draft.findIndex((seats) => seats.some((seat) => seat.player_id === playerId));

  const pickedSeat = picked ? seatOf(picked) : null;

  /**
   * Put somebody down, either onto a table or onto another player.
   *
   * Both cases are one operation on the same array, which is why they live in one
   * function: a swap is a move where the destination happens to be occupied, and
   * writing them separately is how the two drift into disagreeing about what
   * happens to the table a player leaves.
   */
  const place = (toTable: number, onto: string | null) => {
    if (!picked) return;

    const from = tableOf(picked);
    if (from === -1) return;

    // Put down where they already are: nothing moved, and the tap reads as
    // "never mind" rather than as a no-op that leaves them stuck in the air.
    if (from === toTable && (onto === null || onto === picked)) {
      setPicked(null);
      return;
    }

    setDraft((current) => moveSeat(current, picked, toTable, onto));
    setPicked(null);
    setError(null);
  };

  const tap = (tableIndex: number, seat: Seat) => {
    setError(null);
    if (!picked) {
      setPicked(seat.player_id);
      return;
    }
    place(tableIndex, seat.player_id);
  };

  const tapTable = (tableIndex: number) => {
    setError(null);
    if (!picked) return;

    // Said rather than ignored. A tap that does nothing on a full table looks
    // like a broken button, and the way through is not obvious until somebody
    // says it.
    if (
      draft[tableIndex].length >= SEATS_PER_MATCH &&
      tableOf(picked) !== tableIndex
    ) {
      setError(
        `Table ${tableIndex + 1} is full. Tap a player at it to swap places instead.`
      );
      return;
    }

    place(tableIndex, null);
  };

  const save = async () => {
    // Tables nobody is at are dropped rather than sent. The database refuses an
    // empty one, and rightly — but an organizer who added a table and changed
    // their mind should not have to find it and think about it again.
    const arrangement = draft
      .filter((seats) => seats.length > 0)
      .map((seats) => seats.map((seat) => seat.player_id));

    if (arrangement.length === 0) {
      setError('A meetup needs at least one table with somebody at it.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(arrangement);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the seating.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.editor}>
      {/* The mode is stated, not implied by the chips looking slightly different.
          This screen has a read-only seating view that looks much like this one,
          and an organizer who is not sure which one they are in will not risk
          tapping. */}
      <ThemedView
        type="backgroundSelected"
        style={[styles.banner, { borderColor: pickedSeat ? tint : theme.rule }]}>
        <Icon
          name={pickedSeat ? 'people' : 'pencil'}
          color={pickedSeat ? tint : theme.textSecondary}
          size={16}
        />
        <ThemedText type="small" style={styles.bannerText}>
          {pickedSeat ? (
            <>
              Moving <ThemedText type="smallBold">{pickedSeat.name ?? 'this player'}</ThemedText>.
              Tap a table to move them there, or another player to swap.
            </>
          ) : (
            'Editing tables. Tap a player to pick them up.'
          )}
        </ThemedText>
      </ThemedView>

      {draft.map((seats, index) => {
        const empty = Math.max(0, SEATS_PER_MATCH - seats.length);
        const full = seats.length >= SEATS_PER_MATCH;
        const holdingFrom = picked ? tableOf(picked) === index : false;
        // Lit only while somebody is in the air and this is somewhere they could
        // actually land, so the highlight means "here" rather than "table".
        const open = Boolean(picked) && !holdingFrom && !full;

        return (
          <Pressable
            key={index}
            onPress={() => tapTable(index)}
            accessibilityRole="button"
            accessibilityLabel={
              picked
                ? `Move to table ${index + 1}`
                : `Table ${index + 1}, ${seats.length} of ${SEATS_PER_MATCH} seats taken`
            }
            style={({ pressed }) => pressed && styles.pressed}>
            <View
              style={[
                styles.table,
                {
                  borderColor: open ? tint : theme.rule,
                  borderStyle: open ? 'dashed' : 'solid',
                },
              ]}>
              <View style={styles.tableHeader}>
                <ThemedText type="label" themeColor="textSecondary">
                  Table {index + 1}
                </ThemedText>
                <ThemedText type="label" themeColor="textSecondary">
                  {seats.length}/{SEATS_PER_MATCH}
                </ThemedText>
                {open ? (
                  <ThemedText type="label" style={{ color: tint }}>
                    Tap to move here
                  </ThemedText>
                ) : null}
              </View>

              {seats.map((seat, position) => {
                const lifted = picked === seat.player_id;
                return (
                  <Pressable
                    key={seat.player_id}
                    onPress={() => tap(index, seat)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      lifted
                        ? `Put ${seat.name ?? 'this player'} back`
                        : picked
                          ? `Swap with ${seat.name ?? 'this player'}`
                          : `Pick up ${seat.name ?? 'this player'}`
                    }
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      type={lifted ? 'backgroundSelected' : 'background'}
                      style={[
                        styles.chip,
                        { borderColor: lifted ? tint : theme.rule },
                        lifted && styles.chipLifted,
                      ]}>
                      <Avatar
                        person={{ name: seat.name, avatar_url: seat.avatar_url }}
                        size={26}
                        ring={theme.rule}
                      />
                      <ThemedText type="small" numberOfLines={1} style={styles.chipName}>
                        {seat.name ?? 'Unnamed member'}
                      </ThemedText>
                      {/* Whoever is first at a table keeps its scores, which is
                          exactly the thing a rearrangement can move without
                          anybody noticing. Said here so it is visible while the
                          decision is being made. */}
                      {position === 0 ? (
                        <ThemedText type="label" themeColor="textSecondary">
                          Scores
                        </ThemedText>
                      ) : null}
                      <Icon
                        name={lifted ? 'close' : 'chevronDown'}
                        color={lifted ? tint : theme.textSecondary}
                        size={14}
                      />
                    </ThemedView>
                  </Pressable>
                );
              })}

              {Array.from({ length: empty }, (_, seat) => (
                <View key={`empty-${seat}`} style={styles.emptyRow}>
                  <EmptySeat size={26} ring={theme.rule} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Empty seat
                  </ThemedText>
                </View>
              ))}
            </View>
          </Pressable>
        );
      })}

      {/* Adding one is how you split a table that is too big, and it is left empty
          on purpose — the next tap fills it. Empty tables are dropped on save, so
          adding one and changing your mind costs nothing. */}
      <Pressable
        onPress={() => setDraft((current) => [...current, []])}
        accessibilityRole="button"
        accessibilityLabel="Add another table"
        style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView
          type="backgroundElement"
          style={[styles.addTable, { borderColor: theme.rule }]}>
          <Icon name="plus" color={theme.textSecondary} size={16} />
          <ThemedText type="label" themeColor="textSecondary">
            Add a table
          </ThemedText>
        </ThemedView>
      </Pressable>

      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          disabled={isSaving}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={styles.button}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Cancel
            </ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={save}
          disabled={isSaving}
          style={({ pressed }) => pressed && styles.pressed}>
          <View style={[styles.button, { backgroundColor: tint }, isSaving && styles.disabled]}>
            {isSaving ? (
              <ActivityIndicator color={OnAccent} />
            ) : (
              <ThemedText type="smallBold" style={{ color: OnAccent }}>
                Save tables
              </ThemedText>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: {
    flex: 1,
  },
  table: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  /**
   * Lifted off the page while it is in the air, which is the one thing a tap-based
   * move borrows from dragging: the chip has to look like it is somewhere else.
   */
  chipLifted: {
    transform: [{ translateY: -1 }],
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  chipName: {
    flex: 1,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  addTable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
