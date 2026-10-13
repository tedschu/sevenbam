import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  describeAuthError,
  linkErrorFromUrl,
  sendPasswordReset,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/auth';
import { appleSignInAvailable } from '@/lib/native-sign-in';
import { describeMissing, type Intent } from '@/lib/credentials';
import { supabase } from '@/lib/supabase';
import { AnimatedIcon } from '@/components/animated-icon';
import { GoogleMark } from '@/components/google-mark';
import { Button, GradientButton, SegmentedControl, TextLink } from '@/components/kit/controls';
import { Card } from '@/components/kit/layout';
import { Ribbon } from '@/components/kit/ribbon';
import { AppleButton } from '@/components/apple-button';
import { colors, pillTones, radius, text } from '@/constants/design';

/**
 * Which of the three things this screen is doing.
 *
 * They were two buttons on one form before — Sign in and Create account, side by
 * side, identical fields, no indication which one a first-time visitor wanted. The
 * form is the same either way, but the question "have you been here before?" is
 * not, and it is the first thing to answer rather than something to infer from a
 * pair of buttons.
 */
type Mode = Intent;

/**
 * The warm half of the tagline.
 *
 * `pillTones.hosting.fg` rather than a new token: it is the palette's deep amber,
 * already chosen to carry type on a light ground, and the tagline is the only
 * other place amber is set as text.
 */
const TaglineWarm = pillTones.hosting.fg;

export default function LoginScreen() {
  /**
   * A link that arrived dead opens this screen already asking for a new one. Landing
   * on a plain login form after following a reset link reads as the link having
   * quietly worked, which is how somebody ends up wondering why nothing happened.
   */
  const [linkError] = useState(() => linkErrorFromUrl());
  const [mode, setMode] = useState<Mode>(linkError ? 'reset' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(linkError);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Whether a sign-in has actually been turned away here.
   *
   * The reset link used to sit under the form from the first render, which put
   * "Forgot your password?" in front of people who had not tried one yet — including
   * everybody who signs in with Google and has no password to forget. One of them
   * followed it and spent a support thread trying to reset a password that has never
   * existed. It appears now when it has become the right question: after the password
   * this member typed was refused.
   */
  const [signInRefused, setSignInRefused] = useState(false);

  /** Asked once rather than assumed from the platform: an iPhone with no Apple Account signed in says no. */
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    appleSignInAvailable().then(setAppleAvailable, () => setAppleAvailable(false));
  }, []);

  const isSignUp = mode === 'signUp';
  const isReset = mode === 'reset';

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  /**
   * One entry point for all three, so the local check cannot be skipped on one of
   * them. Nothing reaches the server until the form has something worth sending:
   * an empty form is not an error, it is an unfinished one, and it gets an
   * instruction rather than an apology.
   */
  const submit = async () => {
    const missing = describeMissing(email, password, mode);
    if (missing) {
      setNotice(null);
      setError(missing);
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (isReset) {
        await sendPasswordReset(email);
        // Says the same thing whether or not the address has an account, so this
        // cannot be used to find out who is a member.
        setNotice(
          `If there is an account for ${email.trim()}, a reset link is on its way. Open it on any device — it will bring you back here to choose a new password.`
        );
      } else if (isSignUp) {
        const {
          data: { session },
          error,
        } = await supabase.auth.signUp({ email: email.trim(), password });

        if (error) setError(describeAuthError(error));
        else if (!session)
          setNotice(
            'Account created. Open the link in the confirmation email we just sent, then sign in.'
          );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setError(describeAuthError(error));
          // Only for a refusal, not for a rate limit or an outage: neither of those
          // is answered by resetting anything.
          if (error.code === 'invalid_credentials') setSignInRefused(true);
        }
      }
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setLoading(false);
    }
  };

  const continueWith = (signIn: () => Promise<void>) => async () => {
    setLoading(true);
    setError(null);
    try {
      await signIn();
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      // On web the page navigates away, so this only matters when it fails.
      setLoading(false);
    }
  };

  const inputStyle = styles.input;

  return (
    <View style={styles.container}>
      {/* Behind everything, and non-interactive: the screen was otherwise a blank
          field with a mark floating in it. Anchored to the physical corner, which
          is why it sits outside the padded content below. */}
      <Ribbon variant="hero" animateIn />

      {/* Scrollable, and the reason is the error message. The card used to be
          centred in a fixed view, so on a short screen with the keyboard up a
          two-line message ran off the bottom with no way to reach it — the one
          piece of text on the screen that has to be readable. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <SafeAreaView style={styles.safeArea}>
            <AnimatedIcon />

            <View style={styles.brand}>
              <Text style={styles.wordmark}>SEVEN BAM</Text>
              <Text style={styles.tagline}>
                <Text style={{ color: colors.link }}>Your next game </Text>
                <Text style={{ color: TaglineWarm }}>starts here.</Text>
              </Text>
            </View>

            <Card padding={20} gap={14} style={styles.formCard}>
              {/* Answered before the fields, because it decides what they are for.
                  Hidden while resetting, which is neither. */}
              {isReset ? null : (
                <SegmentedControl
                  accessibilityLabel="Have you been here before?"
                  value={mode}
                  onChange={go}
                  options={[
                    { value: 'signIn', label: 'Sign in' },
                    { value: 'signUp', label: 'Create account' },
                  ]}
                />
              )}

              <Text style={styles.help}>
                {isReset
                  ? 'We will email you a link to set a new password.'
                  : isSignUp
                    ? 'New here? Pick an email and a password — you will get a confirmation email to open before your first sign in.'
                    : 'Welcome back.'}
              </Text>

              <TextInput
                style={inputStyle}
                onChangeText={setEmail}
                value={email}
                placeholder="email@address.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholderTextColor={colors.placeholder}
              />

              {/* Hidden while resetting: a password field on a screen whose whole
                  purpose is that you have forgotten it is just something to ignore. */}
              {isReset ? null : (
                <TextInput
                  style={inputStyle}
                  onChangeText={setPassword}
                  value={password}
                  secureTextEntry
                  placeholder={isSignUp ? 'Choose a password' : 'Password'}
                  autoCapitalize="none"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  placeholderTextColor={colors.placeholder}
                />
              )}

              {/* Above the buttons, not below them. This is the answer to whatever
                  was just pressed, and at the bottom of the card it was the first
                  thing off the screen on a phone. */}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {/* Before the button rather than after it, because it is the one thing
                  that saves a wasted round trip. Deliberately worded at everybody:
                  this screen cannot look an address up without becoming a way to find
                  out who is a member and how they sign in. */}
              {isReset ? (
                <Text style={styles.help}>
                  If you use the Continue with Google or Continue with Apple button,
                  there is no password on your account to reset. Go back and use it
                  instead.
                </Text>
              ) : null}

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <GradientButton
                label={isReset ? 'Email me a reset link' : isSignUp ? 'Create account' : 'Sign in'}
                onPress={submit}
                busy={loading}
              />

              {isReset ? (
                <Button
                  variant="outline"
                  size="md"
                  label="Back to sign in"
                  onPress={() => go('signIn')}
                  disabled={loading}
                />
              ) : (
                <>
                  {/* Quietest control on the card, and only where it applies:
                      somebody creating an account has no password to forget, and
                      neither does anybody who has not yet been turned away. */}
                  {isSignUp || !signInRefused ? null : (
                    <TextLink
                      label="Forgot your password?"
                      onPress={() => go('reset')}
                      style={styles.centred}
                    />
                  )}

                  <View style={styles.divider} />

                  {/* First of the two because App Review asks that it be at least as
                      prominent as Google, and because it is the one that can keep an
                      address private. */}
                  {appleAvailable ? (
                    <AppleButton onPress={continueWith(signInWithApple)} disabled={loading} />
                  ) : null}
                  <Button
                    variant="outline"
                    size="md"
                    label="Continue with Google"
                    leading={<GoogleMark />}
                    onPress={continueWith(signInWithGoogle)}
                    disabled={loading}
                  />
                  <Text style={[styles.help, styles.centredText]}>
                    {isSignUp
                      ? 'Fastest way in — no password and no confirmation email.'
                      : 'Works whether or not you have signed in this way before.'}
                  </Text>
                </>
              )}
            </Card>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    // Keeps the ribbon's overhang from widening the page on web.
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  /** Centres the card while it fits, and scrolls once it does not. */
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
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
  tagline: {
    ...text.bodyStrong,
    textAlign: 'center',
  },
  formCard: {
    alignSelf: 'stretch',
  },
  help: {
    ...text.meta,
    color: colors.inkMuted,
  },
  error: {
    ...text.meta,
    color: colors.danger,
  },
  notice: {
    ...text.meta,
    color: colors.link,
  },
  /**
   * The fields read as wells inside the card rather than as bordered boxes, the
   * same treatment the seat row and info notes get. 16pt because anything
   * smaller makes iOS zoom the page on focus.
   */
  input: {
    ...text.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.track,
    borderRadius: radius.inset,
    paddingHorizontal: 14,
    // Height rather than vertical padding, so both platforms land on 48.
    height: 48,
  },
  /** Separates the two account routes from the third-party one. */
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 2,
  },
  centred: {
    justifyContent: 'center',
  },
  centredText: {
    textAlign: 'center',
  },
});
