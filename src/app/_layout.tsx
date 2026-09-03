import { Poppins_600SemiBold, useFonts } from '@expo-google-fonts/poppins';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { HomeScreenSheet } from '@/components/home-screen-sheet';
import { SetPasswordScreen } from '@/components/set-password-screen';
import {
  inviteTokenFromUrl,
  joinLeagueWithToken,
  rememberPendingInvite,
  takePendingInvite,
} from '@/lib/leagues';
import {
  dismissHomeScreenPrompt,
  offerHomeScreenPrompt,
  useHomeScreenPrompt,
} from '@/hooks/use-home-screen-prompt';
import { clearAdminStatus, refreshAdminStatus } from '@/hooks/use-global-view';
import { clearProfileSetup, refreshProfileSetup } from '@/hooks/use-profile-setup';
import { adoptRecoverySession, isPasswordResetPending } from '@/lib/auth';
import { syncMyAvatar } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import LoginScreen from './login';

SplashScreen.preventAutoHideAsync();

/**
 * Cashes in an invite once there is a session.
 *
 * Two cases arrive here. Someone already signed in who opens an invite link, and
 * someone who had to sign in first — Google returns people to the app's origin
 * rather than to the link they followed, so the token is stashed on the way past
 * and redeemed on the way back.
 *
 * Silent on failure. A bad or already-used invite is not worth interrupting a
 * sign-in over, and re-opening the link reports it properly.
 */
async function redeemInvite(userId: string) {
  const token = await takePendingInvite();
  if (!token) return;

  try {
    await joinLeagueWithToken(token);
    // The strongest case for the home screen shortcut: somebody who followed a
    // link on their phone and has just landed in a league. Offered only after the
    // join succeeds, so a stale or spent invite never produces a welcome sheet.
    await offerHomeScreenPrompt(userId);
  } catch {
    // Deliberately ignored; see above.
  }
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);
  const [fontsLoaded] = useFonts({ Poppins_600SemiBold });
  const homeScreenPrompt = useHomeScreenPrompt();
  /**
   * Holds a member on the set-password screen after they follow a recovery link.
   *
   * Needed because the link itself signs them in, and a session is all this layout
   * normally looks at — so without this they would land in Browse having reset
   * nothing, with the old password still working. Which is exactly what a member
   * reported: "it does not give me the chance to reset but just logs me in."
   *
   * Decided from the link rather than from storage, because the URL is the only
   * signal that survives the mail being opened on a different device from the one
   * that asked for it. Storage is kept as a second look for native, where there is
   * no URL to read. The PASSWORD_RECOVERY event is honoured too, for the case where
   * the app was already open — it cannot be relied on alone, since it is emitted
   * while the client initialises, on import, before any listener here exists.
   */
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    (async () => {
      // Stashed before the session is even known, because a signed-out visitor
      // gets sent to the login screen and the token would be gone by the time
      // they came back.
      const fromUrl = inviteTokenFromUrl();
      if (fromUrl) await rememberPendingInvite(fromUrl);

      // Before the session is read, not after: a recovery link brings its own
      // session, and on a device already signed in as somebody it has to replace the
      // one sitting in storage rather than lose to it.
      let arrivedOnRecoveryLink = false;
      try {
        arrivedOnRecoveryLink = await adoptRecoverySession();
      } catch {
        // A link that will not open is reported by the login screen, which reads the
        // same URL. Nothing to do here but carry on and let it say so.
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);
      if (session?.user && (arrivedOnRecoveryLink || (await isPasswordResetPending())))
        setRecovering(true);
      // Publishes this member's Google photo to their profile so the group can
      // see it on match cards. Once per session, not per screen.
      if (session?.user) {
        syncMyAvatar();
        redeemInvite(session.user.id);
        // Marks the Profile tab when this member has no name yet, which in
        // practice means they signed up with an email address rather than Google.
        // Independent of syncMyAvatar, which only ever writes a photo — the name
        // arrives from provider metadata at signup or not at all.
        refreshProfileSetup();
        // Decides whether the global-view toggle is drawn at all. Same shape as
        // the line above: asked once per session rather than per screen.
        refreshAdminStatus();
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (session?.user) {
        syncMyAvatar();
        redeemInvite(session.user.id);
        refreshProfileSetup();
        refreshAdminStatus();
      } else {
        // Signing out has to clear it, or the mark would still be sitting on a
        // tab bar that the next member to sign in inherits. The same goes double
        // for global view, which would otherwise carry an admin's visibility into
        // the next account to sign in on this device.
        clearProfileSetup();
        clearAdminStatus();
        setRecovering(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Headings and every number are set in the display face, so rendering before
  // it arrives would show a full screen of text in the wrong font and reflow.
  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {session && session.user ? (
        // Ordered deliberately: a pending reset outranks the tabs, so the only way
        // past this screen is to set a password or explicitly decline.
        recovering ? <SetPasswordScreen onDone={() => setRecovering(false)} /> : <AppTabs />
      ) : (
        <LoginScreen />
      )}
      {/* One sheet for the whole app, so every join path can raise it — Browse
          after a seat or a league, and redeemInvite after a link. */}
      {homeScreenPrompt ? (
        <HomeScreenSheet
          visible
          platform={homeScreenPrompt}
          onClose={dismissHomeScreenPrompt}
        />
      ) : null}
    </ThemeProvider>
  );
}
