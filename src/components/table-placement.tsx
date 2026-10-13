import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Avatar as OldAvatar, EmptySeat } from '@/components/avatar';
import { Button } from '@/components/kit/controls';
import { Icon } from '@/components/kit/icons';
import { InsetWell } from '@/components/kit/layout';
import { colors, radius, text } from '@/constants/design';
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
    <View style={{ gap: 10 }}>
      {/* The mode is stated, not implied by the chips looking slightly different.
          This screen has a read-only seating view that looks much like this one,
          and an organizer who is not sure which one they are in will not risk
          tapping. */}
      <InsetWell style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {/* A league's colour is a fill everywhere else in the app — a date-tile
            edge, a dot — never text or an icon stroke, since several of them
            (yellow, lime) fail contrast at that weight. `link` stands in for
            "active" here instead. */}
        <Icon
          name={pickedSeat ? 'users' : 'pencil'}
          color={pickedSeat ? colors.link : colors.inkMuted}
          size={16}
        />
        <Text style={[text.meta, { color: colors.inkMuted, flex: 1 }]}>
          {pickedSeat ? (
            <>
              Moving <Text style={[text.bodyStrong, { color: colors.ink }]}>{pickedSeat.name ?? 'this player'}</Text>.
              Tap a table to move them there, or another player to swap.
            </>
          ) : (
            'Editing tables. Tap a player to pick them up.'
          )}
        </Text>
      </InsetWell>

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
            // No accessibilityRole here: each seat inside is its own button, and
            // on web `role="button"` renders a literal <button> — nesting one
            // inside another like this is invalid HTML and React warns on it.
            // The label still gets read out via the accessible name below.
            accessibilityLabel={
              picked
                ? `Move to table ${index + 1}`
                : `Table ${index + 1}, ${seats.length} of ${SEATS_PER_MATCH} seats taken`
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <View
              style={{
                gap: 8,
                padding: 12,
                borderRadius: radius.card,
                borderWidth: open ? 2 : 1,
                borderColor: open ? tint : colors.track,
                borderStyle: open ? 'dashed' : 'solid',
                backgroundColor: colors.bg,
              }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[text.caption, { color: colors.inkMuted, letterSpacing: 0.6 }]}>
                  TABLE {index + 1}
                </Text>
                <Text style={[text.caption, { color: colors.inkMuted }]}>
                  {seats.length}/{SEATS_PER_MATCH}
                </Text>
                {open ? (
                  <Text style={[text.pill, { color: colors.link }]}>TAP TO MOVE HERE</Text>
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
                    style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                    <View
                      style={[
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: radius.pill,
                          backgroundColor: colors.white,
                          borderWidth: 1,
                          borderColor: lifted ? tint : colors.track,
                        },
                        lifted && {
                          transform: [{ translateY: -1 }],
                          shadowColor: colors.ink,
                          shadowOpacity: 0.18,
                          shadowRadius: 6,
                          shadowOffset: { width: 0, height: 3 },
                          elevation: 3,
                        },
                      ]}>
                      <OldAvatar
                        person={{ name: seat.name, avatar_url: seat.avatar_url }}
                        size={26}
                        ring={colors.white}
                      />
                      <Text style={[text.meta, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                        {seat.name ?? 'Unnamed member'}
                      </Text>
                      {/* Whoever is first at a table keeps its scores, which is
                          exactly the thing a rearrangement can move without
                          anybody noticing. Said here so it is visible while the
                          decision is being made. */}
                      {position === 0 ? (
                        <Text style={[text.pill, { color: colors.inkMuted }]}>SCORES</Text>
                      ) : null}
                      <Icon
                        name={lifted ? 'close' : 'chevronDown'}
                        color={lifted ? tint : colors.inkMuted}
                        size={14}
                      />
                    </View>
                  </Pressable>
                );
              })}

              {Array.from({ length: empty }, (_, seat) => (
                <View key={`empty-${seat}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <EmptySeat size={26} ring={colors.white} />
                  <Text style={[text.meta, { color: colors.inkMuted }]}>Empty seat</Text>
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
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingVertical: 12,
            borderRadius: radius.card,
            borderWidth: 2,
            borderColor: colors.track,
            borderStyle: 'dashed',
          }}>
          <Icon name="plus" color={colors.inkMuted} size={16} />
          <Text style={[text.meta, { color: colors.inkMuted }]}>Add a table</Text>
        </View>
      </Pressable>

      {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="soft" size="md" label="Cancel" onPress={onCancel} disabled={isSaving} />
        {isSaving ? (
          <ActivityIndicator />
        ) : (
          <Pressable
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="Save tables"
            style={({ pressed }) => ({
              height: 48,
              paddingHorizontal: 20,
              borderRadius: radius.pill,
              backgroundColor: tint,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}>
            {/* Dark ink on the league's own tint, not white — the league colours
                are pastels (§3.1) and fail contrast as a ground for white type. */}
            <Text style={[text.buttonSm, { color: colors.ink, fontSize: 15 }]}>Save tables</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
