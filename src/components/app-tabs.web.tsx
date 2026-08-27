import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Image } from 'expo-image';
import { Pressable, View, StyleSheet } from 'react-native';

import { GlobalViewChip } from './global-view-toggle';
import { Icon, type IconName } from './icon';
import { ThemedText } from './themed-text';

import {
  CompactTabBarHeight,
  MaxContentWidth,
  Spacing,
  WebTabBarInset,
} from '@/constants/theme';
import { useCompact } from '@/hooks/use-compact';
import { useNeedsProfileSetup } from '@/hooks/use-profile-setup';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const compact = useCompact();
  const needsSetup = useNeedsProfileSetup();

  return (
    <Tabs>
      {/* The bar floats over the content, so the content has to be inset past
          it — above on wide screens, below on narrow ones. */}
      <TabSlot
        style={{
          height: '100%',
          paddingTop: compact ? Spacing.three : WebTabBarInset,
          paddingBottom: compact ? CompactTabBarHeight : 0,
        }}
      />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="search" compactLabel="Browse">
              Browse
            </TabButton>
          </TabTrigger>
          <TabTrigger name="matches" href="/matches" asChild>
            <TabButton icon="calendar" compactLabel="Matches">
              My Matches
            </TabButton>
          </TabTrigger>
          <TabTrigger name="leagues" href="/leagues" asChild>
            <TabButton icon="people" compactLabel="Leagues">
              Leagues
            </TabButton>
          </TabTrigger>
          <TabTrigger name="leaderboard" href="/leaderboard" asChild>
            <TabButton icon="standings" compactLabel="Ranking">
              Leaderboard
            </TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            {/* Marked while this member has no name — see useNeedsProfileSetup. */}
            <TabButton icon="person" compactLabel="Profile" mark={needsSetup}>
              Profile
            </TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({
  children,
  isFocused,
  icon,
  compactLabel,
  mark,
  ...props
}: TabTriggerSlotProps & {
  icon: IconName;
  /**
   * "Leaderboard" cannot fit a quarter of a phone's width and was being cut off,
   * so the bottom bar takes a shorter word under the icon. The full label stays
   * on the wide bar, where there is room for it.
   */
  compactLabel: string;
  /** Draws the attention dot. Only Profile uses it, and only until set up. */
  mark?: boolean;
}) {
  const compact = useCompact();
  const theme = useTheme();
  const tint = isFocused ? theme.text : theme.textSecondary;

  return (
    <Pressable
      {...props}
      // Announced as well as drawn: a coloured dot says nothing to a screen
      // reader, and this one is the only prompt some members get.
      accessibilityLabel={mark ? `${compactLabel} — setup needed` : undefined}
      style={({ pressed }) => [compact && styles.compactTrigger, pressed && styles.pressed]}>
      {/* A teal rule marks the active tab rather than a filled shape: the
          filter chips are filled pills, and the navigation should not read as
          another row of filters. The rule sits above the label in the bottom
          bar and below it in the top bar, so it always points at the edge the
          bar is anchored to. Transparent when inactive keeps the row from
          shifting as the selection moves. */}
      <View
        style={[
          styles.tabButtonView,
          compact && styles.compactTabButtonView,
          compact
            ? { borderTopColor: isFocused ? theme.accent : 'transparent' }
            : { borderBottomColor: isFocused ? theme.accent : 'transparent' },
        ]}>
        {/* The icon only appears on the bottom bar. On the wide bar the labels
            already fit, and four icons there would just be decoration. */}
        {compact ? <Icon name={icon} color={tint} size={22} /> : null}
        <ThemedText
          type="label"
          themeColor={isFocused ? 'text' : 'textSecondary'}
          numberOfLines={1}
          style={compact ? styles.compactLabel : undefined}>
          {compact ? compactLabel : children}
        </ThemedText>

        {/* Absolutely positioned so appearing and disappearing never moves the
            label — a tab that shifts sideways when a dot arrives is worse than no
            dot. Warm amber rather than the danger red: nothing is wrong, there is
            just something left to do. */}
        {mark ? (
          <View
            style={[
              styles.mark,
              compact ? styles.markCompact : styles.markWide,
              { backgroundColor: theme.accentWarm, borderColor: theme.background },
            ]}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const compact = useCompact();
  const theme = useTheme();

  if (compact) {
    return (
      <View
        {...props}
        style={[
          styles.compactContainer,
          { backgroundColor: theme.background, borderColor: theme.rule },
        ]}>
        {props.children}
      </View>
    );
  }

  return (
    // Explicitly themed rather than left transparent. Transparent let the page
    // body show through, which is white — so in dark mode the bar stayed white
    // and the active tab's label, which is near-white ink, all but disappeared
    // on it.
    <View {...props} style={[styles.tabListContainer, { backgroundColor: theme.background }]}>
      {/* Shares the content column's width and padding, so the mark's left
          edge lines up with the headings and cards below it. */}
      <View style={styles.bar}>
        {/* The mark sits outside the pill so it reads as the app's own, rather
            than as the first item in the navigation. */}
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.brandMark}
          contentFit="contain"
          accessibilityLabel="SEVEN BAM"
        />

        {/* No pill around the tabs: the gold rule already marks the active one,
            and a filled container made the navigation read as another card. */}
        <View style={styles.innerContainer}>{props.children}</View>

        <GlobalViewChip />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    paddingVertical: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: MaxContentWidth,
    // Matches the horizontal padding every screen's content uses.
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  brandMark: {
    width: 48,
    height: 48,
  },
  innerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    // Tightened from Spacing.four: five labels and the brand mark no longer fit
    // the content column at the wider gap.
    gap: Spacing.two,
  },
  compactContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: CompactTabBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
  },
  /** Equal shares of the bar, so the four labels never crowd each other out. */
  compactTrigger: {
    flex: 1,
  },
  tabButtonView: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  compactTabButtonView: {
    paddingHorizontal: Spacing.one,
    // Comfortably tappable; below this a thumb starts missing.
    minHeight: 44,
    borderBottomWidth: 0,
    borderTopWidth: 2,
    borderTopColor: 'transparent',
    gap: 2,
  },
  /** Small enough that the shortest sensible word still fits a quarter width. */
  compactLabel: {
    fontSize: 10,
    letterSpacing: 0.4,
  },
  /**
   * The attention dot. Ringed in the bar's own colour so it stays legible where it
   * overlaps the icon, the way the leaderboard avatars are ringed.
   */
  mark: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  /** Off the label's top-right on the wide bar, where there is no icon. */
  markWide: {
    top: 2,
    right: 0,
  },
  /** On the icon's shoulder in the bottom bar, which is where a badge belongs. */
  markCompact: {
    top: 4,
    right: '50%',
    marginRight: -16,
  },
  pressed: {
    opacity: 0.7,
  },
});
