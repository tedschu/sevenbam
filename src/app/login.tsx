import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  describeAuthError,
  linkErrorFromUrl,
  sendPasswordReset,
  signInWithGoogle,
} from '@/lib/auth';
import { describeMissing, type Intent } from '@/lib/credentials';
import { supabase } from '@/lib/supabase';
import { AnimatedIcon } from '@/components/animated-icon';
import { GradientButton, OutlineButton } from '@/components/button';
import { GoogleMark } from '@/components/google-mark';
import { CornerRibbon } from '@/components/ribbon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { OnAccent, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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

export default function LoginScreen() {
  const theme = useTheme();
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

  const continueWithGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      // On web the page navigates away, so this only matters when it fails.
      setLoading(false);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      {/* Behind everything, and non-interactive: the screen was otherwise a blank
          field with a mark floating in it. */}
      <CornerRibbon />

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
              <ThemedText type="title" style={styles.wordmark}>
                SEVEN BAM
              </ThemedText>
              <ThemedText type="smallBold" style={styles.tagline}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                  Your next game{' '}
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: theme.accentWarmInk }}>
                  starts here.
                </ThemedText>
              </ThemedText>
            </View>

            <ThemedView style={[styles.formCard, { borderColor: theme.rule }]}>
              {/* Answered before the fields, because it decides what they are for.
                  Hidden while resetting, which is neither. */}
              {isReset ? null : (
                <View style={[styles.tabs, { borderColor: theme.rule }]}>
                  {(
                    [
                      ['signIn', 'Sign in'],
                      ['signUp', 'Create account'],
                    ] as const
                  ).map(([value, label], index) => {
                    const chosen = mode === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => go(value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: chosen }}
                        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
                        <ThemedView
                          type="backgroundElement"
                          style={[
                            styles.tabInner,
                            // The chosen half is filled rather than underlined. The
                            // app's usual highlight was tried first and is the wrong
                            // tool here: against the grey of the other half it is
                            // 1.05:1, a difference of hue with none of lightness, so
                            // which half was chosen came down to seeing yellow.
                            //
                            // A tint of the accent rather than the accent itself.
                            // At full strength it was a block of brand colour
                            // arguing with the gradient button below it; softened it
                            // still reads as filled at 1.7:1 against the other half,
                            // and carries the dark ink at 9.9:1.
                            chosen && { backgroundColor: theme.accentSoft },
                            // Square, and hard against its neighbour. The two are
                            // halves of one control rather than two chips sharing a
                            // box, so the only rounding is the container's own and
                            // the only edge between them is this hairline.
                            index === 1 && {
                              borderLeftWidth: StyleSheet.hairlineWidth,
                              borderLeftColor: theme.rule,
                            },
                          ]}>
                          <ThemedText
                            type="smallBold"
                            style={chosen ? { color: OnAccent } : undefined}
                            themeColor={chosen ? undefined : 'textSecondary'}>
                            {label}
                          </ThemedText>
                        </ThemedView>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <ThemedText type="small" themeColor="textSecondary">
                {isReset
                  ? 'We will email you a link to set a new password.'
                  : isSignUp
                    ? 'New here? Pick an email and a password — you will get a confirmation email to open before your first sign in.'
                    : 'Welcome back.'}
              </ThemedText>

              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    color: theme.text,
                    borderColor: theme.rule,
                  },
                ]}
                onChangeText={setEmail}
                value={email}
                placeholder="email@address.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholderTextColor={theme.placeholder}
              />

              {/* Hidden while resetting: a password field on a screen whose whole
                  purpose is that you have forgotten it is just something to ignore. */}
              {isReset ? null : (
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.backgroundElement,
                      color: theme.text,
                      borderColor: theme.rule,
                    },
                  ]}
                  onChangeText={setPassword}
                  value={password}
                  secureTextEntry
                  placeholder={isSignUp ? 'Choose a password' : 'Password'}
                  autoCapitalize="none"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  placeholderTextColor={theme.placeholder}
                />
              )}

              {/* Above the buttons, not below them. This is the answer to whatever
                  was just pressed, and at the bottom of the card it was the first
                  thing off the screen on a phone. */}
              {error ? (
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {error}
                </ThemedText>
              ) : null}
              {/* Before the button rather than after it, because it is the one thing
                  that saves a wasted round trip. Deliberately worded at everybody:
                  this screen cannot look an address up without becoming a way to find
                  out who is a member and how they sign in. */}
              {isReset ? (
                <ThemedText type="small" themeColor="textSecondary">
                  If you use the Continue with Google button, there is no password on
                  your account to reset — go back and use it instead.
                </ThemedText>
              ) : null}

              {notice ? (
                <ThemedText type="small" style={{ color: theme.accentInk }}>
                  {notice}
                </ThemedText>
              ) : null}

              <GradientButton
                label={isReset ? 'Email me a reset link' : isSignUp ? 'Create account' : 'Sign in'}
                onPress={submit}
                busy={loading}
                wide
              />

              {isReset ? (
                <OutlineButton
                  label="Back to sign in"
                  onPress={() => go('signIn')}
                  disabled={loading}
                  wide
                />
              ) : (
                <>
                  {/* Quietest control on the card, and only where it applies:
                      somebody creating an account has no password to forget, and
                      neither does anybody who has not yet been turned away. */}
                  {isSignUp || !signInRefused ? null : (
                    <Pressable
                      onPress={() => go('reset')}
                      accessibilityRole="button"
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedText
                        type="small"
                        style={[styles.forgotLink, { color: theme.accentInk }]}>
                        Forgot your password?
                      </ThemedText>
                    </Pressable>
                  )}

                  <View style={[styles.divider, { backgroundColor: theme.rule }]} />

                  <OutlineButton
                    label="Continue with Google"
                    leading={<GoogleMark />}
                    onPress={continueWithGoogle}
                    disabled={loading}
                    wide
                  />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.googleNote}>
                    {isSignUp
                      ? 'Fastest way in — no password and no confirmation email.'
                      : 'Works whether or not you have signed in this way before.'}
                  </ThemedText>
                </>
              )}
            </ThemedView>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    paddingVertical: Spacing.four,
  },
  safeArea: {
    width: '100%',
    maxWidth: 400,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.four,
  },
  brand: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  wordmark: {
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  tagline: {
    textAlign: 'center',
  },
  formCard: {
    alignSelf: 'stretch',
    padding: Spacing.four,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
  },
  /**
   * One rectangle split down the middle, not two pills in a box. `overflow`
   * clips the halves to the container's corners, which is what lets each of them
   * be square and still leave the control rounded.
   */
  tabs: {
    flexDirection: 'row',
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    minHeight: 44,
  },
  input: {
    padding: Spacing.three,
    borderRadius: Radius.small,
    borderWidth: 1,
    fontSize: 16,
  },
  /** Separates the two account routes from the third-party one. */
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  forgotLink: {
    textAlign: 'center',
  },
  googleNote: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
