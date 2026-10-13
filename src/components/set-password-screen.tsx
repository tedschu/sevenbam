import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, GradientButton } from '@/components/kit/controls';
import { Card } from '@/components/kit/layout';
import { Ribbon } from '@/components/kit/ribbon';
import { colors, radius, text } from '@/constants/design';
import { cancelPasswordReset, describeAuthError, updatePassword } from '@/lib/auth';
import { fetchMySignInMethod, type SignInMethod } from '@/lib/profile';

/**
 * Where a recovery link lands: choose a new password, then carry on into the app.
 *
 * This screen exists because of the shape of the flow rather than for its own sake.
 * Following a recovery link **signs the member in** — the link is the proof of
 * identity — and the root layout shows the tabs whenever there is a session. Without
 * something claiming that session first, somebody clicking "reset my password" would
 * be dropped into Browse with their old password still live, having reset nothing,
 * and with no hint that they were meant to do anything. So the layout holds them
 * here while a reset is pending.
 *
 * Deliberately mirrors the login screen — same ribbon, same wordmark, same card — so
 * arriving from an email feels like arriving at the app rather than at a form.
 */
export function SetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * How this account actually signs in.
   *
   * The one place the question can be answered out loud. Somebody who signs in with
   * Google has no password, cannot be told so on the login screen — that screen cannot
   * look an address up without becoming a way to find out who is a member — and so
   * goes round the reset loop hunting for something that was never there. By the time
   * this screen is up, the link has proved who they are, and saying so costs nothing.
   *
   * `null` until the answer arrives, which is why nothing is drawn yet: offering a
   * password box to somebody who has no password and then taking it away again is
   * worse than a moment of nothing.
   */
  const [method, setMethod] = useState<SignInMethod | null>(null);

  useEffect(() => {
    // On failure it falls through to the form rather than sticking: everybody can set
    // a password, and a member who did not need one is mildly confused rather than
    // stranded on a screen with no way off it.
    fetchMySignInMethod()
      .then((found) => setMethod(found ?? 'password'))
      .catch(() => setMethod('password'));
  }, []);

  /**
   * Checked here rather than left to the server, because the server cannot see the
   * second field. Six is the project's minimum, set in supabase/config.toml.
   */
  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const ready = password.length >= 6 && confirmation === password;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      onDone();
    } catch (cause) {
      setError(describeAuthError(cause));
      setBusy(false);
    }
  };

  /**
   * For somebody who followed the link and would rather not change anything. The
   * session from the link stays, so they end up signed in — which is what the link
   * entitled them to, and better than a dead end.
   */
  const skip = async () => {
    await cancelPasswordReset();
    onDone();
  };

  const provider = method === 'apple' ? 'Apple' : 'Google';

  return (
    <View style={styles.container}>
      <Ribbon variant="hero" />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.brand}>
          <Text style={styles.wordmark}>SEVEN BAM</Text>
          <Text style={[text.bodyStrong, { color: colors.link }]}>
            {method === 'google' || method === 'apple' ? 'Nothing to reset' : 'Choose a new password'}
          </Text>
        </View>

        {method === null ? null : method === 'google' || method === 'apple' ? (
          /* The answer to the support thread that started this. A member asked for a
             reset link, followed it, and found herself simply signed in — because her
             account is a Google one and there has never been a password on it. Now the
             link says so, on the account it was sent for, and puts her where she was
             trying to get to anyway. */
          <Card padding={20} gap={14} style={styles.formCard}>
            <Text style={[text.meta, { color: colors.inkMuted }]}>
              You sign in to Seven Bam with {provider}, so there is no password on this
              account to reset. Nothing has gone wrong, and nothing needs changing.
            </Text>
            <Text style={[text.meta, { color: colors.inkMuted }]}>
              Next time, use the Continue with {provider} button on the sign-in screen.
            </Text>
            <GradientButton label="Continue to Seven Bam" onPress={skip} />
          </Card>
        ) : (
          <Card padding={20} gap={14} style={styles.formCard}>
            <TextInput
              style={[styles.input, tooShort && { borderColor: colors.danger }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="New password"
              autoCapitalize="none"
              placeholderTextColor={colors.placeholder}
            />
            <TextInput
              style={[styles.input, mismatch && { borderColor: colors.danger }]}
              value={confirmation}
              onChangeText={setConfirmation}
              secureTextEntry
              placeholder="Type it again"
              autoCapitalize="none"
              placeholderTextColor={colors.placeholder}
            />

            {/* One line at a time, and only once there is something to say about —
                telling somebody their password is too short before they have finished
                typing it is just noise. */}
            <Text style={[text.meta, { color: colors.inkMuted }]}>
              {tooShort
                ? 'At least six characters.'
                : mismatch
                  ? 'The two do not match yet.'
                  : 'At least six characters. You will stay signed in afterwards.'}
            </Text>

            <GradientButton label="Save password" onPress={save} busy={busy} disabled={!ready} />
            <Button variant="outline" size="md" label="Skip for now" onPress={skip} disabled={busy} />

            {error ? (
              <Text style={[text.meta, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
            ) : null}
          </Card>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  safeArea: {
    width: '100%',
    maxWidth: 400,
    padding: 24,
    alignItems: 'center',
    gap: 24,
  },
  brand: {
    alignItems: 'center',
    gap: 4,
  },
  wordmark: {
    ...text.display,
    color: colors.ink,
    textAlign: 'center',
  },
  formCard: {
    alignSelf: 'stretch',
  },
  input: {
    ...text.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.track,
    borderRadius: radius.inset,
    paddingHorizontal: 14,
    height: 48,
  },
});
