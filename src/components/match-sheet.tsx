import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { ChangeNoticePrompt } from '@/components/change-notice-prompt';
import { PlaceAutocompleteInput } from '@/components/place-autocomplete-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LeagueColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { changeNotice, changesBetween, type Change } from '@/lib/change-notice';
import {
  fetchMatchPlayerEmails,
  fetchMyContact,
  fetchMyEmail,
  openGroupEmail,
  type Recipient,
} from '@/lib/contact';
import { coordinatesOf, type Coordinates } from '@/lib/geo';
import { fetchMyLeagues, type MyLeague } from '@/lib/leagues';
import {
  cancelMatch,
  createMatch,
  deleteMatch,
  formatTimeOfDay,
  parseTimeOfDay,
  SEATS_PER_MATCH,
  updateMatch,
  type Match,
} from '@/lib/matches';
import { fetchPlaceLocation } from '@/lib/places';

const DefaultTime = '7:00 pm';

/** Local wall-clock date, so the default is today where the member is, not UTC. */
function localDateISO(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Combines the two fields into an instant. Returns null when either is
 * malformed or the pair is not a real calendar date, so 2026-02-31 is rejected
 * rather than silently rolling into March.
 */
function toTimestamp(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;

  const clock = parseTimeOfDay(time);
  if (!clock) return null;

  const [year, month, day] = date.trim().split('-').map(Number);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const at = new Date(year, month - 1, day, clock.hour, clock.minute);
  if (at.getMonth() !== month - 1 || at.getDate() !== day) return null;

  return at.toISOString();
}

/**
 * Posts a new match, or edits one the signed-in member hosts. The same fields
 * apply either way, so this is one sheet rather than two that drift apart.
 */
export function MatchSheet({
  hostId,
  match,
  visible,
  onClose,
  onSaved,
}: {
  hostId: string | null;
  /** null when proposing; the match being edited otherwise. */
  match: Match | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const isEditing = match !== null;
  const startedAt = match ? new Date(match.date_time) : null;

  const [date, setDate] = useState(localDateISO(startedAt ?? new Date()));
  const [time, setTime] = useState(startedAt ? formatTimeOfDay(startedAt) : DefaultTime);
  const [location, setLocation] = useState(match?.location ?? '');
  const [locationDetail, setLocationDetail] = useState(match?.location_detail ?? null);
  /**
   * Resolved in the background when a suggestion is picked, so saving never waits
   * on a Places lookup. Cleared the moment the venue is edited by hand, because
   * coordinates for the previous venue would put the match in the wrong town.
   */
  const [coordinates, setCoordinates] = useState<Coordinates | null>(
    match ? coordinatesOf(match) : null
  );
  const [notes, setNotes] = useState(match?.notes ?? '');
  const [supplies, setSupplies] = useState(match?.supplies_provided ?? false);
  const [leagueId, setLeagueId] = useState<string | null>(match?.league_id ?? null);
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  /**
   * Non-empty only between saving a change of plan and answering the offer to
   * announce it, which is the whole state this sheet needs for that step — the
   * edit itself is already written by then.
   */
  const [changes, setChanges] = useState<Change[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  // Loaded rather than passed in, because the sheet is opened from two screens
  // and neither has a reason to know about leagues.
  useEffect(() => {
    if (!hostId) return;
    let active = true;

    fetchMyLeagues(hostId)
      .then((found) => {
        // Archived leagues are not taking new play, so offering to count a match
        // toward one would be a table nobody can ever see in its standings.
        if (active) setLeagues(found.filter((league) => league.archived_at === null));
      })
      // A league picker that fails to load should not block posting a pick-up game.
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [hostId]);

  const at = toTimestamp(date, time);
  const canSave = at !== null && location.trim().length > 0 && !isSaving;

  // Erasing a match other people joined would take it off their lists with no
  // explanation, so past the host's own seat the honest action is to cancel.
  const isAlone = (match?.players.length ?? 0) <= 1;
  const removalLabel = isAlone ? 'Delete match' : 'Cancel match';

  const close = () => {
    setError(null);
    setIsConfirmingRemoval(false);
    onClose();
  };

  const save = async () => {
    if (!hostId || !at) return;

    const fields = {
      date_time: at,
      location: location.trim(),
      location_detail: locationDetail?.trim() || null,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      notes: notes.trim() || null,
      supplies_provided: supplies,
      league_id: leagueId,
    };

    setIsSaving(true);
    try {
      if (match) {
        await updateMatch(match.id, fields);

        /**
         * Held open on a change of plan rather than closed on save.
         *
         * Only when and where raise this. Fixing a typo in the notes or flipping
         * the supplies switch is not news, and a prompt after every edit is one
         * people learn to dismiss without reading — which is exactly when the one
         * that mattered goes past unread.
         */
        const moved = changesBetween(match, fields);
        if (moved.length > 0) {
          setChanges(moved);
          // The people to tell, minus the host doing the telling. Fetched now so
          // the prompt can say how many rather than "the players".
          const seated = await fetchMatchPlayerEmails(match.id);
          setRecipients(seated.filter((person) => person.email));
          setIsSaving(false);
          return;
        }
      } else {
        await createMatch(hostId, fields);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the match.');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Hands the note to their mail client, then finishes the save.
   *
   * `onSaved` runs either way — the edit landed before this prompt appeared, so
   * the list behind must refresh whether or not anybody gets an email.
   */
  const sendNotice = async () => {
    if (!match || !at) return;

    setIsSaving(true);
    const { subject, body } = changeNotice({
      title: location.trim(),
      changes,
      after: {
        date_time: at,
        location: location.trim(),
        location_detail: locationDetail?.trim() || null,
      },
      where: 'My Matches',
      from: await fetchMyContact(),
    });

    const { omitted } = await openGroupEmail({
      self: await fetchMyEmail(),
      recipients,
      subject,
      body,
    });

    setIsSaving(false);
    if (omitted > 0) {
      // Said rather than swallowed: a message that quietly reached some of the
      // table is worse than one that names who it missed.
      setError(`${omitted} ${omitted === 1 ? 'address' : 'addresses'} did not fit — tell them directly.`);
      return;
    }
    finishNotice();
  };

  const finishNotice = () => {
    setChanges([]);
    setRecipients([]);
    onSaved();
  };

  const remove = async () => {
    if (!match) return;

    setIsSaving(true);
    try {
      await (isAlone ? deleteMatch(match.id) : cancelMatch(match.id));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${removalLabel.toLowerCase()}.`);
    } finally {
      setIsSaving(false);
      setIsConfirmingRemoval(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedView style={styles.sheet}>
          {/* `handled` so a tap on a venue suggestion is delivered to the row
              instead of being swallowed as a dismiss-the-keyboard gesture. */}
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            {/* The announcement step takes the sheet over once the edit is saved.
                Everything below is hidden rather than scrolled past, so the only
                two things on screen are the two answers to the question. */}
            {changes.length > 0 ? (
              <>
                <ChangeNoticePrompt
                  changes={changes}
                  recipients={recipients.length}
                  busy={isSaving}
                  onSend={sendNotice}
                  onSkip={finishNotice}
                />
                {error ? (
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {error}
                  </ThemedText>
                ) : null}
              </>
            ) : (
              <>
            <ThemedText type="subtitle">{isEditing ? 'Edit match' : 'Propose a match'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isEditing
                ? `${match.players.length} of ${SEATS_PER_MATCH} seats taken.`
                : 'You take the first seat. Three others can join.'}
            </ThemedText>

            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <ThemedText type="label" themeColor="textSecondary">Date</ThemedText>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="2026-08-15"
                  placeholderTextColor={theme.placeholder}
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundElement },
                  ]}
                />
              </View>
              <View style={styles.pairItem}>
                <ThemedText type="label" themeColor="textSecondary">Time</ThemedText>
                <TextInput
                  value={time}
                  onChangeText={setTime}
                  placeholder={DefaultTime}
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundElement },
                  ]}
                />
              </View>
            </View>

            {date.length > 0 && time.length > 0 && at === null ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                Use YYYY-MM-DD and a time like 6:30 pm.
              </ThemedText>
            ) : null}

            <PlaceAutocompleteInput
              label="Venue"
              value={location}
              onChangeText={(next) => {
                setLocation(next);
                // Typing over a picked venue makes both its address and its
                // position stale, and either one wrong is worse than none.
                setLocationDetail(null);
                setCoordinates(null);
              }}
              onSelectPlace={(suggestion) => {
                setLocation(suggestion.mainText);
                setLocationDetail(suggestion.secondaryText);
                setCoordinates(null);
                // Not awaited: the field should stay responsive, and the match is
                // perfectly valid without a position.
                fetchPlaceLocation(suggestion.placeId).then(setCoordinates);
              }}
              placeholder="Where you are playing"
              hint="Pick a suggestion, or type anything — a living room is a venue too."
              kind="venue"
            />

            {locationDetail ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>
                {locationDetail}
              </ThemedText>
            ) : null}

            <View style={styles.field}>
              <ThemedText type="label" themeColor="textSecondary">Notes</ThemedText>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Parking, buzzer code, what to bring"
                placeholderTextColor={theme.placeholder}
                multiline
                style={[
                  styles.input,
                  styles.multiline,
                  { color: theme.text, backgroundColor: theme.backgroundElement },
                ]}
              />
            </View>

            <View style={styles.toggle}>
              <ThemedText style={styles.toggleLabel}>I am providing tiles and racks</ThemedText>
              <Switch value={supplies} onValueChange={setSupplies} />
            </View>

            {/* A picker rather than a toggle: "counts toward the league" was
                never able to say which one. Hidden entirely when you are in no
                leagues, where the question is meaningless. */}
            {leagues.length > 0 ? (
              <View style={styles.field}>
                <ThemedText type="label" themeColor="textSecondary">
                  Points count toward
                </ThemedText>
                <View style={styles.leagueChips}>
                  <Pressable
                    onPress={() => setLeagueId(null)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      type={leagueId === null ? 'backgroundSelected' : 'background'}
                      style={[styles.leagueChip, { borderColor: theme.rule }]}>
                      <ThemedText
                        type="label"
                        themeColor={leagueId === null ? 'text' : 'textSecondary'}>
                        Nothing
                      </ThemedText>
                    </ThemedView>
                  </Pressable>

                  {leagues.map((league) => {
                    const selected = league.id === leagueId;
                    const tint = LeagueColors[league.color] ?? theme.accent;
                    return (
                      <Pressable
                        key={league.id}
                        onPress={() => setLeagueId(league.id)}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <ThemedView
                          type={selected ? 'backgroundSelected' : 'background'}
                          style={[styles.leagueChip, { borderColor: selected ? tint : theme.rule }]}>
                          <View style={[styles.leagueDot, { backgroundColor: tint }]} />
                          <ThemedText type="label" style={{ color: tint }}>
                            {league.name}
                          </ThemedText>
                        </ThemedView>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {error ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            ) : null}

            <View style={styles.actions}>
              <Pressable onPress={close} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundElement" style={styles.button}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Cancel
                  </ThemedText>
                </ThemedView>
              </Pressable>

              <Pressable
                onPress={save}
                disabled={!canSave}
                style={({ pressed }) => pressed && styles.pressed}>
                <View
                  style={[
                    styles.button,
                    { backgroundColor: theme.accentButton },
                    !canSave && styles.disabled,
                  ]}>
                  {isSaving ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <ThemedText type="smallBold" style={styles.postLabel}>
                      {isEditing ? 'Save changes' : 'Post match'}
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            </View>

            {/* Two-step rather than a system confirm dialog: a native alert blocks
                the whole page, and an inline step can say what will actually
                happen to the other players. */}
            {isEditing ? (
              <View style={[styles.removal, { borderColor: theme.rule }]}>
                {isConfirmingRemoval ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {isAlone
                        ? 'This removes the match completely. Nobody else has joined, so nobody is affected.'
                        : `${match.players.length - 1} other ${
                            match.players.length - 1 === 1 ? 'player has' : 'players have'
                          } joined. They keep their seat and see the match marked canceled.`}
                    </ThemedText>
                    <View style={styles.removalActions}>
                      <Pressable
                        onPress={() => setIsConfirmingRemoval(false)}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <ThemedText type="smallBold" themeColor="textSecondary">
                          Keep it
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={remove}
                        disabled={isSaving}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <ThemedText type="smallBold" style={{ color: theme.danger }}>
                          Yes, {removalLabel.toLowerCase()}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Pressable
                    onPress={() => setIsConfirmingRemoval(true)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText type="smallBold" style={{ color: theme.danger }}>
                      {removalLabel}
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            ) : null}
              </>
            )}
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
    maxHeight: '90%',
  },
  sheetContent: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  pair: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  pairItem: {
    flex: 1,
    gap: Spacing.one,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.small,
    fontSize: 16,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  detail: {
    marginTop: -Spacing.two,
  },
  leagueChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  leagueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leagueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  toggleLabel: {
    flex: 1,
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
    minHeight: 44,
  },
  removal: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  removalActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    alignItems: 'center',
    minHeight: 44,
  },
  disabled: {
    opacity: 0.5,
  },
  postLabel: {
    // White on the deep teal fill: 5.4:1, where the near-black it replaced was
    // correct only while the fill was the pale `accent`.
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});
