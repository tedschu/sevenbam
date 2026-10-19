import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * The iOS OAuth client in the "Mahjong Meetup" Google Cloud project, tied to the
 * bundle ID. Not a secret: it ships inside every copy of the app, and its reversed
 * form is the URL scheme in app.json, which has to match it.
 *
 * Supabase has to list it under the Google provider's client IDs, next to the web
 * client, or it refuses the token this hands over.
 */
const GoogleIosClientId =
  '371987596215-ij5ljjopg1hjg28liksdotni5kj7kvd5.apps.googleusercontent.com';

/** Whether this device signs in with Google natively rather than in a browser sheet. */
export const nativeGoogleAvailable = Platform.OS === 'ios';

/**
 * Asks Google for an ID token through its own account picker.
 *
 * The point of this over the browser sheet is the prompt in front of it. The sheet
 * has to open the Supabase project's address, and iOS names that address in a
 * system alert nobody can reword: "Seven Bam wants to use xiiiswp…supabase.co to
 * sign in". Google's kit goes to Google directly, so the alert names google.com
 * instead, which is what every app with Google sign-in shows.
 *
 * Null when the member backs out, which is not an error worth showing.
 */
export async function googleIdToken(): Promise<string | null> {
  GoogleSignin.configure({ iosClientId: GoogleIosClientId });

  try {
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;

    const token = response.data.idToken;
    if (!token) throw new Error('Google did not return a sign-in token.');
    return token;
  } catch (cause) {
    // A second tap while the picker is still opening. The first one is in hand.
    if (isErrorWithCode(cause) && cause.code === statusCodes.IN_PROGRESS) return null;
    throw cause;
  }
}

/** False on iPads and Macs without an Apple Account signed in, and on Android. */
export function appleSignInAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync();
}

export type AppleCredential = { idToken: string; nonce: string; name: string | null };

/**
 * Asks Apple for an ID token, and the member's name.
 *
 * The name comes back the first time somebody signs in to this app with Apple and
 * never again, not even after deleting the account here. So the caller has to save
 * it on that first pass or it is gone for good, and the member is left nameless on
 * every roster until they type one in.
 *
 * Carries a nonce so a token lifted from one sign-in cannot be replayed into
 * another. Apple gets the SHA-256 of it and writes that into the token; Supabase
 * gets the original, hashes it again and refuses the token if the two differ.
 *
 * Null when the member cancels.
 */
export async function appleCredential(): Promise<AppleCredential | null> {
  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');

    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ');

    return { idToken: credential.identityToken, nonce, name: name || null };
  } catch (cause) {
    if ((cause as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw cause;
  }
}
