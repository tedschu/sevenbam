import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';

import { TabBarButton, TabBarShell } from '@/components/kit/layout';
import { useNeedsProfileSetup } from '@/hooks/use-profile-setup';

/**
 * The app's navigation — one bottom bar on every platform.
 *
 * Built on `expo-router/ui` rather than the native tabs this used before, and
 * rather than the separate top bar the web build had. The design's bar carries a
 * gradient indicator hanging off its top border, and a real `UITabBar` renders
 * its own children with nowhere to put ours. `expo-router/ui` hands the markup
 * back, which is the only way to draw it — and doing it once means web and native
 * can no longer drift apart.
 *
 * Browse stays on the `index` route. Google returns members to the app's origin
 * after sign-in and recovery links land there too, so `/` has to be a real screen
 * rather than a redirect to `/browse`.
 */
export default function AppTabs() {
  const needsSetup = useNeedsProfileSetup();

  return (
    <Tabs>
      {/*
        `TabSlot`'s own `ScreenContainer` wrapper (`flexShrink: 0`, no `flexBasis`)
        never shrinks below its content's height on web. Every screen here is a
        `ScrollView` meant to be exactly one viewport tall and scroll internally,
        so that wrapper handed its oversized, content-fit height straight down to
        it — the ScrollView grew to match the content instead of clipping it, the
        whole page became taller than the viewport, and the tab bar (positioned
        absolute against an ancestor that scrolled away with that overgrown page)
        drifted up the screen as soon as a list was long enough to scroll.
        `flex: 1` restores a real `flexBasis` of 0 so it shrinks to the space it
        is actually given, and `overflow: hidden` keeps it from doing this again
        if some future child is taller still.
      */}
      <TabSlot style={{ flex: 1, overflow: 'hidden' }} />
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="index" href="/" asChild>
            <TabBarButton icon="search" label="Browse" />
          </TabTrigger>
          <TabTrigger name="matches" href="/matches" asChild>
            {/* "My matches" wraps on a small phone; the screen keeps the full title. */}
            <TabBarButton icon="calendar" label="Matches" />
          </TabTrigger>
          <TabTrigger name="leagues" href="/leagues" asChild>
            <TabBarButton icon="trophy" label="Leagues" />
          </TabTrigger>
          <TabTrigger name="leaderboard" href="/leaderboard" asChild>
            <TabBarButton icon="bars" label="Leaderboard" />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabBarButton icon="profile" label="Profile" badge={needsSetup} />
          </TabTrigger>
          {/* The component gallery, in development only. */}
          {__DEV__ ? (
            <TabTrigger name="gallery" href="/gallery" asChild>
              <TabBarButton icon="info" label="Kit" />
            </TabTrigger>
          ) : null}
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
