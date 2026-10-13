import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { ChangeNoticePrompt } from '@/components/change-notice-prompt';
import { PlaceAutocompleteInput } from '@/components/place-autocomplete-input';
import { Button, GradientButton, Toggle } from '@/components/kit/controls';
import { FilterChip } from '@/components/kit/filters';
import { Sheet } from '@/components/kit/sheet';
import { colors, leagueEdge, radius, text } from '@/constants/design';
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
import { fetchPlaceDetails } from '@/lib/places';

const DefaultTime = '7:00 pm';

const fieldInput = {
  ...text.body,
  fontSize: 16,
  color: colors.ink,
  backgroundColor: colors.bg,
  borderWidth: 1,
  borderColor: colors.track,
  borderRadius: radius.inset,
  paddingHorizontal: 14,
  height: 48,
};

const fieldLabel = { ...text.caption, color: colors.inkMuted, letterSpacing: 0.6 };

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
  /**
   * The venue's own clock, from the same Places lookup as the coordinates.
   *
   * Used only when this match turns into email — every screen renders a time in
   * the reader's device zone, but a notification is composed by a function running
   * in UTC and has no device to ask. Cleared with the coordinates when the venue is
   * edited by hand, for the same reason: the previous venue's zone is worse than
   * none, because the mail would print it as if it were checked.
   */
  const [timeZone, setTimeZone] = useState<string | null>(match?.time_zone ?? null);
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
      time_zone: timeZone,
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
    <Sheet visible={visible} onClose={close} keyboardAvoiding>
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
          {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}
        </>
      ) : (
        <>
          <View style={{ gap: 4 }}>
            <Text style={[text.sectionTitle, { color: colors.ink }]}>
              {isEditing ? 'Edit match' : 'Propose a match'}
            </Text>
            <Text style={[text.meta, { color: colors.inkMuted }]}>
              {isEditing
                ? `${match.players.length} of ${SEATS_PER_MATCH} seats taken.`
                : 'You take the first seat. Three others can join.'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={fieldLabel}>DATE</Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="2026-08-15"
                placeholderTextColor={colors.placeholder}
                style={fieldInput}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={fieldLabel}>TIME</Text>
              <TextInput
                value={time}
                onChangeText={setTime}
                placeholder={DefaultTime}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                style={fieldInput}
              />
            </View>
          </View>

          {date.length > 0 && time.length > 0 && at === null ? (
            <Text style={[text.meta, { color: colors.danger }]}>
              Use YYYY-MM-DD and a time like 6:30 pm.
            </Text>
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
              setTimeZone(null);
            }}
            onSelectPlace={(suggestion) => {
              setLocation(suggestion.mainText);
              setLocationDetail(suggestion.secondaryText);
              setCoordinates(null);
              setTimeZone(null);
              // Not awaited: the field should stay responsive, and the match is
              // perfectly valid without either of these.
              fetchPlaceDetails(suggestion.placeId).then((details) => {
                setCoordinates(details.location);
                setTimeZone(details.timeZone);
              });
            }}
            placeholder="Where you are playing"
            hint="Pick a suggestion, or type anything — a living room is a venue too."
            kind="venue"
          />

          {locationDetail ? (
            <Text style={[text.meta, { color: colors.inkMuted, marginTop: -10 }]}>
              {locationDetail}
            </Text>
          ) : null}

          <View style={{ gap: 6 }}>
            <Text style={fieldLabel}>NOTES</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Parking, buzzer code, what to bring"
              placeholderTextColor={colors.placeholder}
              multiline
              style={[fieldInput, { height: 88, paddingTop: 12, textAlignVertical: 'top' }]}
            />
          </View>

          <Toggle
            value={supplies}
            onValueChange={setSupplies}
            label="I am providing tiles and racks"
          />

          {/* A picker rather than a toggle: "counts toward the league" was never
              able to say which one. Hidden entirely when you are in no leagues,
              where the question is meaningless. */}
          {leagues.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={fieldLabel}>POINTS COUNT TOWARD</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <FilterChip
                  label="Nothing"
                  selected={leagueId === null}
                  onPress={() => setLeagueId(null)}
                />
                {leagues.map((league) => (
                  <FilterChip
                    key={league.id}
                    label={league.name}
                    dotColor={leagueEdge(league.color)}
                    selected={league.id === leagueId}
                    onPress={() => setLeagueId(league.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="soft" size="md" label="Cancel" onPress={close} />
            <GradientButton
              size="md"
              label={isEditing ? 'Save changes' : 'Post match'}
              disabled={!canSave}
              busy={isSaving}
              onPress={save}
            />
          </View>

          {/* Two-step rather than a system confirm dialog: a native alert blocks
              the whole page, and an inline step can say what will actually
              happen to the other players. */}
          {isEditing ? (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 14, gap: 10 }}>
              {isConfirmingRemoval ? (
                <>
                  <Text style={[text.meta, { color: colors.inkMuted }]}>
                    {isAlone
                      ? 'This removes the match completely. Nobody else has joined, so nobody is affected.'
                      : `${match.players.length - 1} other ${
                          match.players.length - 1 === 1 ? 'player has' : 'players have'
                        } joined. They keep their seat and see the match marked canceled.`}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      variant="soft"
                      size="md"
                      label="Keep it"
                      onPress={() => setIsConfirmingRemoval(false)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="danger"
                      size="md"
                      label={`Yes, ${removalLabel.toLowerCase()}`}
                      disabled={isSaving}
                      onPress={remove}
                      style={{ flex: 1 }}
                    />
                  </View>
                </>
              ) : (
                <Button
                  variant="danger"
                  label={removalLabel}
                  onPress={() => setIsConfirmingRemoval(true)}
                />
              )}
            </View>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
