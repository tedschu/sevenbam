import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DisplayFont, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  const theme = useTheme();
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedView style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <ThemedText type="subtitle">{isCorrection ? 'Edit scores' : 'Enter scores'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {subtitle}
            </ThemedText>

            {tables.map((table) => {
              const isComplete = complete.includes(table);
              const isStarted = started.includes(table);

              return (
                <View key={table.match_id} style={styles.rows}>
                  {/* Only when there is more than one. On a single card the
                      heading would be a label for the only thing on screen. */}
                  {table.label ? (
                    <View style={styles.tableHeader}>
                      <ThemedText type="label" themeColor="textSecondary">
                        {table.label}
                      </ThemedText>
                      {/* Said per table rather than only at the bottom: with four
                          cards open, "one of these is short" is useless without
                          saying which. */}
                      {isStarted && !isComplete ? (
                        <ThemedText type="label" style={{ color: theme.accentWarmInk }}>
                          Needs every seat
                        </ThemedText>
                      ) : null}
                    </View>
                  ) : null}

                  {table.seats.map((seat) => {
                    const key = keyOf(table, seat.player_id);
                    const raw = drafts[key] ?? '';
                    const invalid = raw.trim().length > 0 && parseScore(raw) === null;

                    return (
                      <View key={key} style={styles.row}>
                        <ThemedText style={styles.playerName} numberOfLines={1}>
                          {seat.name ?? 'Member'}
                        </ThemedText>
                        <TextInput
                          value={raw}
                          onChangeText={(next) =>
                            setDrafts((current) => ({ ...current, [key]: next }))
                          }
                          keyboardType="numbers-and-punctuation"
                          inputMode="numeric"
                          placeholder={seat.score === null ? '0' : String(seat.score)}
                          placeholderTextColor={theme.placeholder}
                          style={[
                            styles.input,
                            {
                              color: theme.text,
                              backgroundColor: theme.backgroundElement,
                              borderColor: invalid ? theme.danger : 'transparent',
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {error ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            ) : null}

            <ThemedText type="small" themeColor="textSecondary">
              {footnote()}
            </ThemedText>

            <View style={styles.actions}>
              <Pressable onPress={close} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundElement" style={styles.button}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Cancel
                  </ThemedText>
                </ThemedView>
              </Pressable>

              <Pressable
                onPress={commit}
                disabled={!canSave || isSaving}
                style={({ pressed }) => pressed && styles.pressed}>
                <View
                  style={[
                    styles.button,
                    { backgroundColor: theme.accentButton },
                    (!canSave || isSaving) && styles.disabled,
                  ]}>
                  {isSaving ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <ThemedText type="smallBold" style={styles.saveLabel}>
                      Save scores
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            </View>
          </ScrollView>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    maxHeight: '85%',
  },
  sheetContent: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  rows: {
    gap: Spacing.two,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  playerName: {
    flex: 1,
  },
  input: {
    fontFamily: DisplayFont,
    fontVariant: ['tabular-nums'],
    width: 110,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.small,
    borderWidth: 1,
    textAlign: 'right',
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.two,
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
  saveLabel: {
    // White on the deep teal fill: 5.4:1, where the near-black it replaced was
    // correct only while the fill was the pale `accent`.
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});
