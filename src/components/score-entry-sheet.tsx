import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button, GradientButton } from '@/components/kit/controls';
import { Sheet } from '@/components/kit/sheet';
import { colors, fonts, pillTones, radius, text } from '@/constants/design';

/** Accepts a whole number, optionally negative. Rejects blanks and stray text. */
function parseScore(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * One table's card.
 *
 * The sheet used to be built around a single `Match`, which was true of the only
 * place that opened it — a host scoring their own game from My Matches. A league
 * organizer closing out a meetup has four of these in their hand at once, and
 * making them find four separate matches in four separate places to type twelve
 * numbers is how a season's standings end up half empty.
 *
 * So the sheet takes tables rather than a match, and one table is just the short
 * case. Both callers get the same modal, which is what stops the two flows drifting
 * into two slightly different ideas of what a card is.
 */
export type ScoreTable = {
  match_id: string;
  /** "Table 2" — omitted when there is only one, where it says nothing. */
  label: string | null;
  seats: { player_id: string; name: string | null; score: number | null }[];
};

export type ScoreEntry = { match_id: string; player_id: string; score: number };

export function ScoreEntrySheet({
  tables,
  subtitle,
  visible,
  onClose,
  onSaved,
  save,
}: {
  tables: ScoreTable[];
  /** Where and when, so somebody with two meetups open knows which card this is. */
  subtitle: string;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  save: (entries: ScoreEntry[]) => Promise<void>;
}) {
  // Prefilled with whatever is already recorded, so correcting one number does
  // not mean retyping the whole card. The caller keys this component by what it
  // is scoring, so the initialiser re-runs for each one.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      tables.flatMap((table) =>
        table.seats.map((seat) => [
          `${table.match_id}:${seat.player_id}`,
          seat.score === null ? '' : String(seat.score),
        ])
      )
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const keyOf = (table: ScoreTable, playerId: string) => `${table.match_id}:${playerId}`;

  /**
   * A table is sent only when every seat at it has a number.
   *
   * Which is the same rule the database enforces per table, deliberately: a
   * half-entered card cannot close a match and leave somebody sitting on zero in
   * the standings. What it buys at a meetup is the case where three tables played
   * and the fourth gave up and went to the pub — the three go in, the fourth is
   * left exactly as it was rather than blocking the save.
   *
   * For a single table this reduces to what the sheet has always done: fill it in
   * or the button stays down.
   */
  const complete = tables.filter((table) =>
    table.seats.every((seat) => parseScore(drafts[keyOf(table, seat.player_id)] ?? '') !== null)
  );

  const started = tables.filter((table) =>
    table.seats.some((seat) => (drafts[keyOf(table, seat.player_id)] ?? '').trim().length > 0)
  );

  const isCorrection = tables.some((table) => table.seats.some((seat) => seat.score !== null));
  const canSave = complete.length > 0;

  const close = () => {
    setError(null);
    onClose();
  };

  const commit = async () => {
    const entries: ScoreEntry[] = complete.flatMap((table) =>
      table.seats.map((seat) => ({
        match_id: table.match_id,
        player_id: seat.player_id,
        score: parseScore(drafts[keyOf(table, seat.player_id)] ?? '') ?? 0,
      }))
    );

    setIsSaving(true);
    try {
      await save(entries);
      setError(null);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the scores.');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * What the button is about to do, in the plural the organizer is actually in.
   *
   * A meetup where two of four tables are filled in has to say so before the tap,
   * not after: "Save scores" on a screen showing sixteen names reads as a promise
   * about all sixteen.
   */
  const footnote = () => {
    if (tables.length === 1) {
      return isCorrection
        ? 'Saving replaces the recorded card. The standings update automatically.'
        : 'Saving records the card and marks the match completed. The standings update automatically.';
    }

    if (complete.length === 0) {
      return 'Fill in every seat at a table to record it. Tables you leave blank are not touched.';
    }

    const left = tables.length - complete.length;
    return (
      `Saving records ${complete.length} of ${tables.length} ${
        tables.length === 1 ? 'table' : 'tables'
      }.` +
      (left > 0
        ? ` The ${left === 1 ? 'other is' : `other ${left} are`} left as ${
            left === 1 ? 'it is' : 'they are'
          } — a table needs every seat filled in before it can be recorded.`
        : ' The standings update automatically.')
    );
  };

  return (
    <Sheet visible={visible} onClose={close} keyboardAvoiding>
      <View style={{ gap: 4 }}>
        <Text style={[text.sectionTitle, { color: colors.ink }]}>
          {isCorrection ? 'Edit scores' : 'Enter scores'}
        </Text>
        <Text style={[text.meta, { color: colors.inkMuted }]}>{subtitle}</Text>
      </View>

      {tables.map((table) => {
        const isComplete = complete.includes(table);
        const isStarted = started.includes(table);

        return (
          <View key={table.match_id} style={{ gap: 10 }}>
            {/* Only when there is more than one. On a single card the heading
                would be a label for the only thing on screen. */}
            {table.label ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={[text.caption, { color: colors.inkMuted, letterSpacing: 0.6 }]}>
                  {table.label.toUpperCase()}
                </Text>
                {/* Said per table rather than only at the bottom: with four cards
                    open, "one of these is short" is useless without saying which. */}
                {isStarted && !isComplete ? (
                  <Text style={[text.pill, { color: pillTones.sub.fg }]}>NEEDS EVERY SEAT</Text>
                ) : null}
              </View>
            ) : null}

            {table.seats.map((seat) => {
              const key = keyOf(table, seat.player_id);
              const raw = drafts[key] ?? '';
              const invalid = raw.trim().length > 0 && parseScore(raw) === null;

              return (
                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Text style={[text.body, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                    {seat.name ?? 'Member'}
                  </Text>
                  <TextInput
                    value={raw}
                    onChangeText={(next) => setDrafts((current) => ({ ...current, [key]: next }))}
                    keyboardType="numbers-and-punctuation"
                    inputMode="numeric"
                    placeholder={seat.score === null ? '0' : String(seat.score)}
                    placeholderTextColor={colors.placeholder}
                    style={{
                      fontFamily: fonts.semibold,
                      fontVariant: ['tabular-nums'],
                      width: 96,
                      height: 44,
                      paddingHorizontal: 14,
                      borderRadius: radius.inset,
                      backgroundColor: colors.bg,
                      borderWidth: 1,
                      borderColor: invalid ? colors.danger : colors.track,
                      textAlign: 'right',
                      fontSize: 16,
                      color: colors.ink,
                    }}
                  />
                </View>
              );
            })}
          </View>
        );
      })}

      {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}

      <Text style={[text.caption, { color: colors.inkMuted }]}>{footnote()}</Text>

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="soft" size="md" label="Cancel" onPress={close} />
        <GradientButton size="md" label="Save scores" disabled={!canSave} busy={isSaving} onPress={commit} />
      </View>
    </Sheet>
  );
}
