import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { landingHash, recoveryClient, supabase } from './supabase';

/** Where someone goes when nothing on the screen helps them. */
export const SupportEmail = 'sevenbamapp@gmail.com';

/**
 * Marks that a password reset was requested from this browser.
 *
 * A fallback now rather than the main signal. The link itself says what it is — see
 * `passwordResetArrived` — which is the only thing that still works when the mail is
 * opened somewhere other than where it was asked for. This flag covers native, where
 * there is no URL for the app to read on the way in.
 */
const ResetPendingKey = 'sevenbam.passwordResetPending';

/**
 * Reads what a recovery link left in the URL.
 *
 * The link comes back as `#access_token=…&type=recovery`, or, when it has expired or
 * been spent already, as `#error=access_denied&error_code=otp_expired`. Both are read
 * from the snapshot taken before the auth client wiped them.
 */
function landingParams() {
  return new URLSearchParams(landingHash.replace(/^#/, ''));
}

/**
 * Whether this page was opened by following a recovery link.
 *
 * Read from the URL rather than from storage, because the place a reset is asked for
 * and the place the mail is opened are routinely different browsers. Read rather than
 * listened for, because `PASSWORD_RECOVERY` is emitted while the client initialises —
 * on import, before any component exists to hear it.
 */
export function passwordResetArrived() {
  return landingParams().get('type') === 'recovery';
}

/**
 * The reason a link failed, when it arrived carrying one.
 *
 * Worth surfacing because the alternative is what a member actually saw: an ordinary
 * login screen, with no hint that the link they had just followed was the thing that
 * had expired.
 */
export function linkErrorFromUrl(): string | null {
  const params = landingParams();
  const code = params.get('error_code');
  if (!code) return null;

  if (code === 'otp_expired')
    return 'That reset link has expired or has already been used. Ask for a new one below.';

  return (
    params.get('error_description')?.replace(/\+/g, ' ') ??
    'That link did not work. Ask for a new one below.'
  );
}

/**
 * Takes up the session a recovery link arrived with.
 *
 * Has to be done by hand. The main client is on PKCE, and `auth-js` refuses to read
 * an implicit URL while it is — `_getSessionFromURL` throws "Not a valid PKCE flow
 * url." and leaves whatever session was already there alone. That last part is the
 * dangerous half: on a device already signed in, the tokens the link carried would be
 * dropped on the floor and the member left looking at an ordinary signed-in app,
 * which is the bug this whole change is about.
 *
 * So the tokens are read from the snapshot and installed deliberately. Installing
 * rather than merging matters: the link is proof of who this is, and it has to win
 * over whatever session the browser was already holding.
 *
 * The hash goes as soon as it has been spent, so a refresh or a shared URL does not
 * carry a live token around.
 */
export async function adoptRecoverySession(): Promise<boolean> {
  if (Platform.OS !== 'web' || !passwordResetArrived()) return false;

  const params = landingParams();
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });

  if (typeof window !== 'undefined')
    window.history.replaceState(window.history.state, '', window.location.pathname);

  if (error) throw error;

  await setResetPending(true);
  return true;
}

async function setResetPending(pending: boolean) {
  try {
    if (pending) await AsyncStorage.setItem(ResetPendingKey, '1');
    else await AsyncStorage.removeItem(ResetPendingKey);
  } catch {
    // Storage refused. The worst case is a member who has to sign in normally
    // afterwards, which is not worth failing the reset over.
  }
}

/** Whether this browser is part-way through a password reset. */
export async function isPasswordResetPending() {
  try {
    return (await AsyncStorage.getItem(ResetPendingKey)) === '1';
  } catch {
    return false;
  }
}

/**
 * Emails a recovery link.
 *
 * `redirectTo` is the app's own origin, which is already an allowed redirect
 * because Google sign-in returns to exactly the same place — so this needs no new
 * dashboard configuration.
 *
 * Sent through `recoveryClient` rather than the main one, so the link works wherever
 * it is opened. See the note on that client: the app's own sign-in stays on PKCE, and
 * only recovery — the one flow that routinely changes device between the asking and
 * the opening — leaves it.
 */
export async function sendPasswordReset(email: string) {
  const redirectTo =
    Platform.OS === 'web' ? window.location.origin : Linking.createURL('/');

  const { error } = await recoveryClient.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  if (error) throw error;

  await setResetPending(true);
}

/**
 * Sets a new password for the member the recovery link signed in.
 *
 * Clears the pending flag on success so the app stops holding them on the
 * set-password screen. Left set on failure, deliberately: a rejected password must
 * not drop somebody into the app with the old one still live.
 */
export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;

  await setResetPending(false);
}

/**
 * Abandons a reset — for the member who followed the link and would rather not
 * change their password after all.
 */
export async function cancelPasswordReset() {
  await setResetPending(false);
}

/**
 * Turns an auth failure into something a person can act on.
 *
 * The login screen used to print `error.message` straight from the server, which
 * is written for whoever is reading the logs. A member trying to join a mahjong
 * game was shown "Email rate limit exceeded" — true, meaningless, and silent about
 * the fact that Continue with Google would have worked immediately. That one cost
 * a real signup.
 *
 * Matched on `code` rather than on the message text. Codes are a documented part
 * of the auth API and are enumerated in its types; the prose is not, and changes
 * without warning. Anything unrecognised falls through to the original message
 * plus the support address, so a new failure mode is still reported honestly
 * rather than flattened into "something went wrong".
 */
export function describeAuthError(error: unknown): string {
  const code = error instanceof AuthError ? error.code : undefined;

  switch (code) {
    case 'over_email_send_rate_limit':
      // The one that prompted all this. Names the way out rather than the cause:
      // the member cannot do anything about a mail quota.
      return `We could not send your confirmation email just now. Try Continue with Google — that works straight away — or try again in a few minutes.`;

    case 'over_request_rate_limit':
      return 'Too many attempts in a row. Wait a minute and try again.';

    case 'invalid_credentials':
      // Deliberately does not say which half was wrong; that tells a stranger
      // whether an address has an account. Google is named because this is also what
      // a Google account gets when it tries a password it never set, and saying so
      // here costs nothing: the same line is shown for every refusal alike.
      return 'That email and password do not match an account. If you signed up with Google, use Continue with Google — that account has no password. Otherwise check for a typo, or create an account below.';

    case 'email_not_confirmed':
      return 'Your email address is not confirmed yet. Open the link in the confirmation email we sent, then sign in.';

    case 'user_already_exists':
    case 'email_exists':
      return 'There is already an account with that email address. Sign in instead, and use a password reset if you have forgotten it.';

    case 'weak_password':
      return 'That password is too short. Use at least six characters.';

    case 'same_password':
      return 'That is already your password. Choose a different one.';

    case 'otp_expired':
      // Recovery links are single-use and time-limited, and an expired one is the
      // single most likely way a reset fails. Says what to do, not what expired.
      return 'That reset link has expired or has already been used. Ask for a new one below.';

    case 'reauthentication_needed':
      return 'For safety, sign in again before changing your password.';

    case 'signup_disabled':
      return `New accounts are closed at the moment. Email ${SupportEmail} if you were expecting an invitation.`;

    case 'user_banned':
      return `This account cannot be used. Email ${SupportEmail} if that is unexpected.`;

    case 'validation_failed':
      return 'Check the email address — that one does not look complete.';

    default: {
      // The only branch that names support, and it should stay that way: an
      // address offered for every stumble teaches people to ignore it.
      const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
      return `Something went wrong at our end${detail}. Try Continue with Google, or email ${SupportEmail} if it keeps happening.`;
    }
  }
}

/**
 * Sign in with Google.
 *
 * The two platforms take different routes to the same place. On web the
 * browser leaves for Google and comes back with a code in the URL, which the
 * client picks up itself because `detectSessionInUrl` is on. On native there is
 * no page to come back to, so the consent screen opens in an auth session, the
 * deep link is caught here, and the code is exchanged by hand.
 */
export async function signInWithGoogle() {
  const redirectTo =
    Platform.OS === 'web'
      ? // Back to the page the member started on, not a hardcoded host, so the
        // same build works on localhost and on the deployed site.
        window.location.origin
      : Linking.createURL('/');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // On native the app opens the URL itself; on web supabase-js navigates.
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });

  if (error) throw error;
  if (Platform.OS === 'web' || !data?.url) return;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // Member closed the sheet.

  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new Error('Google did not return a sign-in code.');

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}
