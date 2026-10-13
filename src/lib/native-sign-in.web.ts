/**
 * The web side of `native-sign-in.ts`: nothing.
 *
 * The browser has no native picker to reach for, and Google on web already goes
 * through a redirect that names the right site. Kept as its own file so the static
 * export never loads the two native modules at all.
 */

export const nativeGoogleAvailable = false;

export async function googleIdToken(): Promise<string | null> {
  return null;
}

export async function appleSignInAvailable(): Promise<boolean> {
  return false;
}

export type AppleCredential = { idToken: string; name: string | null };

export async function appleCredential(): Promise<AppleCredential | null> {
  return null;
}
