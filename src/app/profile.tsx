import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { Image } from 'expo-image';

import { GlobalViewRow } from '@/components/global-view-toggle';
import { PlaceAutocompleteInput } from '@/components/place-autocomplete-input';
import { Button, GradientButton, Toggle } from '@/components/kit/controls';
import { FilterChip } from '@/components/kit/filters';
import { Icon } from '@/components/kit/icons';
import { Card, InsetWell, ScreenScaffold, SectionHeader, TitleBlock } from '@/components/kit/layout';
import { colors, pillTones, radius, shadow, text } from '@/constants/design';
import { refreshProfileSetup, useNeedsProfileSetup } from '@/hooks/use-profile-setup';
import { SupportEmail } from '@/lib/auth';
import { openSupportEmail } from '@/lib/contact';
import { coordinatesOf, type Coordinates } from '@/lib/geo';
import {
  AllOn,
  fetchMyNotificationSettings,
  updateMyNotificationSettings,
  type NotificationSettings,
} from '@/lib/notifications';
import { fetchPlaceDetails } from '@/lib/places';
import {
  deleteMyAccount,
  EXPERIENCE_LEVELS,
  fetchMyProfile,
  signOut,
  updateMyProfile,
  type ExperienceLevel,
  type SignInMethod,
} from '@/lib/profile';

type Draft = {
  name: string;
  phone: string;
  town: string;
  experience_level: string;
};

const EMPTY: Draft = { name: '', phone: '', town: '', experience_level: '' };

const fieldStyle = {
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

const labelStyle = { ...text.caption, color: colors.inkMuted, letterSpacing: 0.6 };

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  keyboardType?: 'default' | 'phone-pad';
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={labelStyle}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        keyboardType={keyboardType ?? 'default'}
        style={fieldStyle}
      />
      {hint ? <Text style={[text.caption, { color: colors.inkMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * One email switch, with the sentence that says what it turns off underneath.
 *
 * The label is written as the mail itself rather than as a category — "when a game
 * you are in has four players", not "Game notifications" — because the only
 * question anybody is answering here is whether they want to receive that
 * particular thing. A category name makes them guess.
 */
function AlertRow({
  label,
  detail,
  value,
  onValueChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return <Toggle label={label} description={detail} value={value} onValueChange={onValueChange} />;
}

/**
 * A titled section that starts closed.
 *
 * Exists so Name and Town sit at the top of this screen. Those are the two fields
 * the app actually needs — one so other players know who is at the table, the
 * other so Browse can sort by distance — and they were the fourth and seventh
 * things down the page, behind a read-only email, an optional phone number and
 * four paragraphs about who can see them. All of that still matters; none of it is
 * what a new member is here to do.
 *
 * Closed rather than removed, and the summary line says what is inside, so the
 * privacy note is one tap away rather than hidden. Drawn as the same expandable
 * well as the league screen's "N tables drawn" row, so the app has one pattern
 * for "there is more here, tap to read it" rather than two.
 */
function Disclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ gap: 8 }}>
      <InsetWell style={{ padding: 0, overflow: 'hidden' }}>
        <Pressable
          onPress={() => setOpen((was) => !was)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={title}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 44,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[text.bodyStrong, { color: colors.ink }]}>{title}</Text>
            {open ? null : (
              <Text style={[text.caption, { color: colors.inkMuted }]}>{summary}</Text>
            )}
          </View>
          <View style={open ? { transform: [{ rotate: '180deg' }] } : undefined}>
            <Icon name="chevronDown" size={18} color={colors.link} strokeWidth={2} />
          </View>
        </Pressable>
        {open ? (
          <View style={{ padding: 14, paddingTop: 0, gap: 10 }}>{children}</View>
        ) : null}
      </InsetWell>
    </View>
  );
}

/** A line of link text that opens a message to us. Full tap height for a short word. */
function SupportLink({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        { justifyContent: 'center', minHeight: 44 },
        pressed && { opacity: 0.6 },
      ]}>
      <Text style={[text.bodyStrong, { color: colors.link }]}>{label}</Text>
    </Pressable>
  );
}

const AppMark = require('@/assets/images/app-mark.png');

export default function ProfileScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  /**
   * Which of the two ways in this account uses. Shown beside the email because that
   * is where somebody looks when they are working out why a password will not work —
   * and for a Google account the answer is that there is no password at all.
   */
  const [signInMethod, setSignInMethod] = useState<SignInMethod | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  /**
   * Two steps for closing the account, the same shape as deleting a league: the
   * first tap only reveals what is about to happen, and the wording of the second
   * says it rather than saying "confirm".
   */
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  /** Same source as the dot on the Profile tab, so the two always agree. */
  const needsSetup = useNeedsProfileSetup();
  /**
   * The town's coordinates, kept beside the draft rather than in it because they
   * are not typed — they arrive from a Places lookup after a suggestion is
   * picked, and are dropped whenever the town is edited by hand.
   */
  const [home, setHome] = useState<Coordinates | null>(null);
  /**
   * Which emails this member still wants.
   *
   * Kept out of `draft` on purpose: these save on the tap rather than on Save
   * profile. A switch that silently needs a second button pressed is how somebody
   * ends up believing they unsubscribed and still receiving mail — and the one
   * thing a preference like this has to be is believed.
   */
  const [alerts, setAlerts] = useState<NotificationSettings>(AllOn);

  const load = useCallback(async () => {
    try {
      const { profile, email: accountEmail, signInMethod: method } = await fetchMyProfile();
      setUserId(profile.id);
      // Never fatal. The rest of this screen is worth showing to somebody whose
      // switches would not load, and the defaults match what the database assumes
      // for a row it cannot read.
      setAlerts(await fetchMyNotificationSettings(profile.id).catch(() => AllOn));
      setEmail(accountEmail);
      setSignInMethod(method);
      setDraft({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        town: profile.town ?? '',
        experience_level: profile.experience_level ?? '',
      });
      setHome(coordinatesOf({
        latitude: profile.home_latitude,
        longitude: profile.home_longitude,
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your profile.');
    }
  }, []);

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

  const save = async () => {
    if (!userId) return;

    setIsSaving(true);
    setStatus(null);
    try {
      await updateMyProfile(userId, {
        name: draft.name.trim() || null,
        phone: draft.phone.trim() || null,
        town: draft.town.trim() || null,
        experience_level: draft.experience_level || null,
        home_latitude: home?.latitude ?? null,
        home_longitude: home?.longitude ?? null,
      });
      setStatus('Profile saved.');
      setError(null);
      // Clears the mark on the Profile tab in the same breath, so the prompt
      // disappears on the tap that answers it.
      refreshProfileSetup();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const set = (key: keyof Draft) => (next: string) => {
    setDraft((current) => ({ ...current, [key]: next }));
    setStatus(null);
  };

  /**
   * Optimistic, and reverted if the write fails.
   *
   * A switch that lags a tap reads as broken and gets tapped again, which is how
   * somebody turns a setting off and back on without meaning to. Showing the new
   * position immediately and putting it back on failure is the same bargain the
   * league screen makes for opening a meetup to subs.
   */
  const setAlert = (key: keyof NotificationSettings) => async (next: boolean) => {
    if (!userId) return;

    const before = alerts;
    setAlerts({ ...alerts, [key]: next });
    setStatus(null);
    try {
      await updateMyNotificationSettings(userId, { [key]: next });
      setError(null);
    } catch (cause) {
      setAlerts(before);
      setError(cause instanceof Error ? cause.message : 'Could not change your email alerts.');
    }
  };

  /**
   * No navigation on success, and none needed. Clearing the session makes the root
   * layout swap the tabs for the login screen, which is the right destination and
   * the only one that still exists for this caller.
   */
  const closeAccount = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteMyAccount();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not close your account.');
      setIsConfirmingDelete(false);
      setIsDeleting(false);
    }
  };

  /**
   * Hands the member a message to us with the subject filled in.
   *
   * No in-app form behind it, deliberately. A form needs a table to land in, a
   * queue for somebody to work through, and a route back to the person who filed
   * it. Mail has all three already, and the thread it opens is the one we would
   * answer from anyway.
   *
   * Two subjects for one inbox, so a report of abuse can be picked out of the
   * feedback at a glance and answered first.
   */
  const reportProblem = () =>
    openSupportEmail({
      to: SupportEmail,
      subject: 'Reporting something on SEVEN BAM',
      body: 'What did you see, and where? Naming the league, game or member helps us find it.\n\n',
    });

  const shareFeedback = () =>
    openSupportEmail({
      to: SupportEmail,
      subject: 'Feedback on SEVEN BAM',
      body: 'What is working for you, what is not, or what would you like the app to do?\n\n',
    });

  if (isLoading) {
    return (
      <ScreenScaffold ribbon="compact">
        <ActivityIndicator style={{ marginTop: 40 }} />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold ribbon="compact">
      {/* Just the mark, no profile-avatar button — unlike the other tabs, there
          is nowhere useful for it to lead when it already leads here. */}
      <View style={[{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.white }, shadow.raised]}>
        <Image
          source={AppMark}
          accessibilityLabel="Seven Bam"
          style={{ width: 42, height: 42, borderRadius: 12 }}
        />
      </View>

      <TitleBlock eyebrow="Your account" title="Profile" subtitle="How the group sees you" />

      {/*
        What the dot on the Profile tab means, said in words.

        A dot alone tells somebody that something wants attention but not
        what, and the people who see this one are exactly the people with the
        least context: they signed up with an email address, so nothing
        filled their profile in for them, and they have no idea they are
        currently "Unnamed member" to everyone else.

        Rendered from the same condition that draws the dot, so the two
        cannot disagree, and it leaves the screen on the same save.
      */}
      {needsSetup ? (
        <Card style={{ backgroundColor: pillTones.soon.bg }} gap={6}>
          <Text style={[text.bodyStrong, { color: pillTones.soon.fg }]}>Finish setting up</Text>
          <Text style={[text.meta, { color: colors.inkMuted }]}>
            Add your name so the group knows who is at the table — without it you
            show up as an unnamed player on match cards and the leaderboard. Adding
            your town is optional, and lets Browse show you the closest games first.
          </Text>
        </Card>
      ) : null}

      <Field
        label="Name"
        value={draft.name}
        onChangeText={set('name')}
        placeholder="What the group calls you"
        hint="Shown on match cards and the leaderboard."
      />

      <PlaceAutocompleteInput
        label="Town"
        value={draft.town}
        onChangeText={(next) => {
          setDraft((current) => ({ ...current, town: next }));
          // A town typed by hand has no position, and keeping the previous
          // one would filter Browse around the wrong place.
          setHome(null);
        }}
        onSelectPlace={(suggestion) => {
          setDraft((current) => ({ ...current, town: suggestion.mainText }));
          setHome(null);
          // Not awaited: the field stays responsive, and a profile without
          // coordinates is perfectly valid — it just cannot sort by distance.
          // Coordinates only. A member's home town sorts Browse by distance; it is
          // not a venue and nothing is ever scheduled against its clock.
          fetchPlaceDetails(suggestion.placeId).then(({ location }) => setHome(location));
        }}
        placeholder="Where you play from"
        hint="Worth adding — pick a suggestion and Browse will show you the closest tables first."
        kind="city"
      />

      {/*
        Shown as a field rather than as the caption under the title, where it
        read as decoration — which is no way to present the one detail the
        note below says gets shared.

        Not editable, and not for want of a text input. This is the address
        you sign in with: it lives on the auth account rather than on the
        profile, and changing it means `auth.updateUser` plus a confirmation
        link, which cannot happen behind the same Save button as a name. A
        field that appeared to save and then reverted would be worse than one
        that says where the value comes from.
      */}
      <View style={{ gap: 6 }}>
        <Text style={labelStyle}>EMAIL</Text>
        <View style={[fieldStyle, { justifyContent: 'center' }]}>
          <Text style={[text.body, { color: colors.ink }]} numberOfLines={1}>
            {email ?? '—'}
          </Text>
        </View>
        <Text style={[text.caption, { color: colors.inkMuted }]}>
          {signInMethod === 'google'
            ? 'You sign in with Google, so this account has no password to change or forget. Ask to have the address changed if you need to.'
            : signInMethod === 'apple'
              ? 'You sign in with Apple, so this account has no password to change or forget. If you chose to hide your email, this is the address Apple forwards to you.'
            : signInMethod === 'password'
              ? 'You sign in with this address and a password. Ask to have the address changed if you need to.'
              : 'How you sign in. Ask to have it changed if you need to.'}
        </Text>
      </View>

      <Field
        label="Phone"
        value={draft.phone}
        onChangeText={set('phone')}
        placeholder="Optional"
        keyboardType="phone-pad"
      />

      {/* Said before it happens, not discovered afterwards. Hosting a match
          hands your email to strangers who join it, which is a fair trade for
          being reachable but not one to make on somebody's behalf silently.
          Placed under the contact fields, where the question arises. */}
      <Disclosure
        title="Who can see this"
        summary="Your email is shared with players who join your matches. Tap to read how.">
        <Text style={[text.caption, { color: colors.inkMuted }]}>
          When you host a match, everyone who takes a seat can see your email
          address — and your phone number if you have given one — so they can
          reach you. The same goes for members of a league you organize.
        </Text>
        {/* The other direction, added when hosts got the ability to write to
            their players. Worth its own sentence: it is the one case where
            somebody else can see your address without you choosing to host
            anything. */}
        <Text style={[text.caption, { color: colors.inkMuted }]}>
          It also works the other way. When you join a match or a league, your
          email address is visible to whoever runs it, so they can send you
          updates — a change of venue, or a game called off. Other players
          never see it: group messages are sent blind.
        </Text>
        <Text style={[text.caption, { color: colors.inkMuted }]}>
          Nobody else sees either detail. They are never shown in Browse, on
          the leaderboard, or to people who have not joined.
        </Text>
        {/* Where the question "and how do I get it back" belongs — beside the
            answer to "who has it", rather than only next to the button at the
            bottom of the screen. */}
        <Text style={[text.caption, { color: colors.inkMuted }]}>
          You can take all of it back at any time by closing your account, at
          the bottom of this screen.
        </Text>
      </Disclosure>

      <View style={{ gap: 8 }}>
        <Text style={labelStyle}>EXPERIENCE</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {EXPERIENCE_LEVELS.map((level: ExperienceLevel) => (
            <FilterChip
              key={level}
              label={level}
              selected={draft.experience_level === level}
              onPress={() => set('experience_level')(draft.experience_level === level ? '' : level)}
            />
          ))}
        </View>
      </View>

      {/* Email alerts.

          On the page rather than behind a Disclosure, and above Save rather
          than beside Sign out, because the moment somebody comes looking for
          this they are annoyed — they have had mail they did not want and
          they are hunting for the switch. Anything they have to open first
          is a step taken while already irritated, and the alternative to
          finding it here is marking us as spam.

          Both are on for everybody until they say otherwise, which is what
          the database assumes too. Every one of these emails also carries its
          own unsubscribe link, so this screen is the second way to get here,
          not the only one. */}
      <View style={{ gap: 8 }}>
        <SectionHeader title="Email alerts" />
        <Card gap={16}>
          <AlertRow
            label="When a game is on"
            detail="A game you are in reaches four players."
            value={alerts.game_is_on}
            onValueChange={setAlert('game_is_on')}
          />
          <View style={{ height: 1, backgroundColor: colors.divider }} />
          <AlertRow
            label="When somebody drops out"
            detail="Someone can't make a game you are in, and a seat has opened up."
            value={alerts.someone_drops_out}
            onValueChange={setAlert('someone_drops_out')}
          />
        </Card>
        <Text style={[text.caption, { color: colors.inkMuted }]}>
          These save as you tap them. Emails about your own account, like
          resetting a password, are not affected.
        </Text>
      </View>

      {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}
      {status ? <Text style={[text.meta, { color: colors.link }]}>{status}</Text> : null}

      <GradientButton label="Save profile" onPress={save} busy={isSaving} />

      {/* What this account is currently able to see, for the one account
          that can see more than its own. Above Sign out and below Save
          because it is not part of the profile being edited — it changes
          what every other screen is showing, which is closer to signing out
          than to a field. Drawn for nobody else — see GlobalViewRow. */}
      <GlobalViewRow />

      {/* Reporting, and the only block on this screen that is here for somebody
          other than the member reading it.

          Nothing in the app is a feed, so there is no post to hang a report off.
          What one member can see of another is a name — a league's, a venue's, or
          the person's own — which leaves no single piece of content to attach this
          to and makes this screen the right home for it: somebody already comes
          here to ask what others can see about them, and this is the same question
          turned around.

          Feedback shares the card because it shares the inbox. Reporting stays
          the first link, so a reviewer looking for it does not have to read past
          anything to find it.

          The address is spelled out in the caption as well as behind the links,
          for the reason ContactRows draws a host's: a label that conceals the
          value is worse for anyone who wants to copy it, forward it, or write
          from an account other than the one they are signed in with. */}
      <View style={{ gap: 8 }}>
        <SectionHeader title="Contact us" />
        <Card gap={12}>
          <Text style={[text.caption, { color: colors.inkMuted }]}>
            If the name of a league, a game or a member is offensive or abusive,
            tell us. We read every report, take down what does not belong here,
            and close accounts that keep putting it back. Anything else, good or
            bad, we would like to hear too. Both go to {SupportEmail}.
          </Text>
          <SupportLink
            label="Report a problem"
            accessibilityLabel={`Email us at ${SupportEmail} to report a problem`}
            onPress={reportProblem}
          />
          <SupportLink
            label="Share feedback"
            accessibilityLabel={`Email us at ${SupportEmail} to share feedback`}
            onPress={shareFeedback}
          />
        </Card>
      </View>

      {/* Signing out is not something to encourage, so it stays the quietest
          control on the screen rather than taking the outline treatment. */}
      <Button variant="soft" label="Sign out" onPress={signOut} />

      {/*
        Closing the account, last on the screen and separated by a rule.

        Two steps, and the second one describes what happens rather than
        asking "are you sure" — which is a question nobody can answer well
        without being told the consequences first. What it says is the truth
        about what the database does: the identity goes, the games stay. That
        is a surprising enough bargain that it has to be stated before the
        tap, not explained afterwards.
      */}
      <Card>
        {isConfirmingDelete ? (
          <>
            <Text style={[text.bodyStrong, { color: colors.ink }]}>This cannot be undone.</Text>
            <Text style={[text.caption, { color: colors.inkMuted }]}>
              Your name, email address, phone number, photo and town are
              deleted, and you will not be able to sign in again.
            </Text>
            <Text style={[text.caption, { color: colors.inkMuted }]}>
              Games you have already played stay on the leaderboard, listed
              under a generated name instead of yours. They are part of the
              record for everyone who played at those tables, so they are not
              removed.
            </Text>
            <Text style={[text.caption, { color: colors.inkMuted }]}>
              Matches you are hosting that have not happened yet pass to
              another player, or are called off if nobody else has joined.
            </Text>
            <Text style={[text.caption, { color: colors.inkMuted }]}>
              A league you are the only organizer of needs someone else made
              an organizer first, if it still has meetups coming up — the
              roster has a button beside every name. Leagues that have gone
              quiet pass to their longest-standing member on their own, or
              are archived if you were the last one in them.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                variant="soft"
                size="md"
                label="Keep my account"
                disabled={isDeleting}
                onPress={() => setIsConfirmingDelete(false)}
                style={{ flex: 1 }}
              />
              <Button
                variant="danger"
                size="md"
                label={isDeleting ? 'Closing…' : 'Yes, delete'}
                busy={isDeleting}
                onPress={closeAccount}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : (
          <Button
            variant="danger"
            label="Delete my account"
            onPress={() => setIsConfirmingDelete(true)}
          />
        )}
      </Card>
    </ScreenScaffold>
  );
}
