/**
 * Screen scaffolding, surfaces, avatars and the tab bar —
 * `DESIGN_HANDOFF.md` §4.7, §4.8, §4.11 and §5.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  type ImageSourcePropType,
  Pressable,
  type RefreshControlProps,
  ScrollView,
  type StyleProp,
  Text,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { avatarPalette, brandGradient, colors, fonts, layout, radius, shadow, text } from '@/constants/design';

import { CountBadge } from './controls';
import { Icon, type IconName } from './icons';
import { Ribbon, type RibbonVariant } from './ribbon';

/**
 * Every tab screen's outer shell.
 *
 * The ScrollView runs edge to edge and under the status bar — no SafeAreaView —
 * because the ribbon has to bleed off the top and right edges to read as
 * something swooping in from outside the screen. The inset is paid back as
 * content padding instead.
 *
 * The unpadded wrapper View matters: the ribbon is positioned against it, so its
 * offsets are measured from the physical corner of the screen rather than from
 * inside the 20pt gutter.
 */
export function ScreenScaffold({
  ribbon,
  ribbonStyle,
  animateRibbon = false,
  refreshControl,
  children,
}: {
  ribbon?: RibbonVariant;
  ribbonStyle?: StyleProp<ViewStyle>;
  animateRibbon?: boolean;
  /** Pull to refresh, for the screens that reload their own data. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="never"
      refreshControl={refreshControl}>
      {/* Capped and centred for the browser. The design is drawn for a phone, and
          left to fill a desktop window the cards became bands and the ribbon a
          speck in the corner. On a phone this box is the whole width, so the
          ribbon's offsets still measure from the screen's own corner. */}
      <View style={{ position: 'relative', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        {/* First, so everything else paints on top of it. */}
        {ribbon ? <Ribbon variant={ribbon} style={ribbonStyle} animateIn={animateRibbon} /> : null}
        <View
          style={{
            paddingTop: insets.top + layout.headerTopPad,
            // Clears the translucent tab bar, so the last card is not half under it.
            paddingBottom: layout.tabBarHeight + insets.bottom + 24,
            paddingHorizontal: layout.screenGutter,
            gap: layout.sectionGap,
          }}>
          {children}
        </View>
      </View>
    </ScrollView>
  );
}

/** App mark · spacer · optional action · profile avatar. */
export function ScreenHeader({
  logo,
  trailing,
  initials,
  photoUrl,
  onProfilePress,
  badge = false,
}: {
  logo: ImageSourcePropType;
  /** Browse passes the gradient Propose button. */
  trailing?: React.ReactNode;
  initials: string;
  photoUrl?: string | null;
  onProfilePress: () => void;
  /** The dot the old tab-bar badge carried: this member has no name yet. */
  badge?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {/* The shadow goes on a wrapper: a rounded Image clips its own shadow on iOS. */}
      <View style={[{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.white }, shadow.raised]}>
        <Image
          source={logo}
          accessibilityLabel="Seven Bam"
          style={{ width: 42, height: 42, borderRadius: 12 }}
        />
      </View>
      <View style={{ flex: 1 }} />
      {trailing}
      <Pressable
        onPress={onProfilePress}
        accessibilityRole="button"
        accessibilityLabel="Profile"
        style={[
          {
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 2,
            borderColor: colors.white,
            backgroundColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          },
          shadow.raised,
        ]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={{ width: 40, height: 40, borderRadius: 20 }} />
        ) : (
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.white }}>{initials}</Text>
        )}
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: colors.coral,
              borderWidth: 2,
              borderColor: colors.white,
            }}
          />
        ) : null}
      </Pressable>
    </View>
  );
}

/** Eyebrow, H1, and an optional subtitle. */
export function TitleBlock({
  eyebrow,
  title,
  subtitle,
  small = false,
  leading,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** `displaySm`, for a league name that would otherwise wrap three times. */
  small?: boolean;
  /** The league-colour dot that sits before the eyebrow on a league screen. */
  leading?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 2 }}>
      {eyebrow ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {leading}
          <Text style={[text.eyebrow, { color: colors.link }]}>{eyebrow.toUpperCase()}</Text>
        </View>
      ) : null}
      <Text
        accessibilityRole="header"
        style={[small ? text.displaySm : text.display, { color: colors.ink }]}>
        {title}
      </Text>
      {subtitle ? <Text style={[text.body, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

/**
 * A section title, with an optional count and a right-aligned action.
 *
 * The negative margin turns the scaffold's 20pt section gap into the 12pt the
 * handoff specifies between a header and the card under it, without giving the
 * scaffold a second kind of gap to reason about.
 */
export function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: -8 }}>
      <Text accessibilityRole="header" style={[text.sectionTitle, { color: colors.ink }]}>
        {title}
      </Text>
      {count ? <CountBadge count={count} /> : null}
      <View style={{ flex: 1 }} />
      {action}
    </View>
  );
}

/** White, radius 24, no border and no coloured left edge — the old bordered cards are gone. */
export function Card({
  children,
  padding = 16,
  gap = 14,
  style,
}: {
  children: React.ReactNode;
  padding?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.card, padding, gap },
        shadow.card,
        style,
      ]}>
      {children}
    </View>
  );
}

/** "Nothing booked" — a dashed outline rather than a card, so an empty list does not look full. */
export function DashedCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: colors.dashed,
        borderRadius: radius.card,
        padding: 16,
        paddingLeft: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      }}>
      {children}
    </View>
  );
}

/** The grey box inside a card: the seat row, an info note, the drawn-tables row. */
export function InsetWell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ backgroundColor: colors.bg, borderRadius: radius.inset, padding: 12 }, style]}>
      {children}
    </View>
  );
}

/**
 * The note explaining what the meetup buttons do.
 *
 * Each row's chip is styled like the button it explains, so the explanation can
 * be matched to the control by colour without reading it twice.
 */
export function InfoNote({
  rows,
}: {
  rows: readonly {
    icon: IconName;
    chipBg: string;
    chipFg: string;
    chipBorder?: boolean;
    term: string;
    body: string;
  }[];
}) {
  return (
    <InsetWell style={{ gap: 10 }}>
      {rows.map((row) => (
        <View key={row.term} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: row.chipBg,
              borderWidth: row.chipBorder ? 1 : 0,
              borderColor: colors.track,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name={row.icon} size={13} color={row.chipFg} strokeWidth={2.2} />
          </View>
          <Text style={[text.caption, { color: colors.inkMuted, flex: 1 }]}>
            <Text style={{ fontFamily: fonts.semibold, color: colors.ink }}>{row.term} </Text>
            {row.body}
          </Text>
        </View>
      ))}
    </InsetWell>
  );
}

/**
 * The dot that stands in for a league's name in a meta line.
 *
 * A dot and not coloured type: four of the six league colours are too light to
 * set text in, which is the same rule the old `LeagueColors` comment records.
 */
export function LeagueDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

function hashOf(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

export type Player = { id: string; initials: string; photoUrl?: string | null };

/**
 * A member's photo, or their initials on a colour picked from their id — so the
 * same person is the same colour on every screen, every session.
 *
 * `ring` is the 2pt separator, and has to match whatever the avatar sits on for
 * overlapping stacks to read as separate circles.
 */
export function Avatar({
  player,
  size = 38,
  ring = colors.white,
}: {
  player: Player;
  size?: number;
  ring?: string;
}) {
  const [background, foreground] = avatarPalette[hashOf(player.id) % avatarPalette.length];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: ring,
        backgroundColor: background,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {player.photoUrl ? (
        <Image source={{ uri: player.photoUrl }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Text style={{ fontFamily: fonts.semibold, fontSize: size >= 38 ? 13 : 12, color: foreground }}>
          {player.initials}
        </Text>
      )}
    </View>
  );
}

/**
 * Overlapping avatars, then whatever seats are still empty.
 *
 * The two empty-seat styles say different things. `join` is the ask on Browse —
 * one coral dashed circle, set apart rather than overlapped, and tappable.
 * `empty` is informational, on matches the viewer hosts, and shows one grey
 * circle per missing player.
 */
export function AvatarStack({
  players,
  seats = 4,
  size = 38,
  ring = colors.white,
  openSeatStyle = 'empty',
  onJoin,
}: {
  players: readonly Player[];
  seats?: number;
  size?: number;
  ring?: string;
  openSeatStyle?: 'join' | 'empty' | 'none';
  onJoin?: () => void;
}) {
  const empty = Math.max(0, seats - players.length);

  return (
    <View style={{ flexDirection: 'row' }}>
      {players.map((player, index) => (
        <View key={player.id} style={{ marginLeft: index === 0 ? 0 : -8 }}>
          <Avatar player={player} size={size} ring={ring} />
        </View>
      ))}
      {openSeatStyle === 'join' && empty > 0 ? (
        <Pressable
          onPress={onJoin}
          accessibilityRole="button"
          accessibilityLabel="Take the open seat"
          style={{
            marginLeft: 4,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: colors.coral,
            backgroundColor: colors.white,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="plus" size={16} color={colors.tileWeekday} strokeWidth={2.4} />
        </Pressable>
      ) : null}
      {openSeatStyle === 'empty'
        ? Array.from({ length: empty }).map((_, index) => (
            <View
              key={index}
              style={{
                marginLeft: -8,
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.dashed,
                backgroundColor: colors.white,
              }}
            />
          ))
        : null}
    </View>
  );
}

/** The points bar under a name on Leaderboard, as a fraction of the leader's total. */
export function PointsBar({
  fraction,
  trackColor = colors.divider,
}: {
  fraction: number;
  trackColor?: string;
}) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: trackColor, overflow: 'hidden' }}>
      <LinearGradient
        colors={[colors.teal, colors.lime, colors.yellow, colors.orange]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ width: `${Math.round(clamped * 100)}%`, height: 6, borderRadius: 3 }}
      />
    </View>
  );
}

/**
 * The bottom tab bar — §4.11.
 *
 * Two pieces rather than one component, because the app drives its tabs with
 * `expo-router/ui`: `TabList` and `TabTrigger` render through `asChild` slots,
 * so the bar's chrome and its items are separate children. The same pair serves
 * native and web, which is why `app-tabs.web.tsx` is gone — the design asks for
 * one bottom bar everywhere, and the old file was a second, divergent nav.
 *
 * It replaces the platform tab bar the app used on native. A real `UITabBar`
 * renders its own children and nothing of ours can be positioned inside it,
 * which is why the gradient indicator and the profile dot are drawn here.
 */
export function TabBarShell({ children, style, ...rest }: ViewProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      {...rest}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: layout.tabBarHeight + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          paddingHorizontal: 8,
          flexDirection: 'row',
          backgroundColor: 'rgba(255,255,255,0.94)',
          borderTopWidth: 1,
          borderTopColor: colors.track,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/** How far a screen's content has to clear the bar. */
export function useTabBarInset() {
  const insets = useSafeAreaInsets();
  return layout.tabBarHeight + insets.bottom;
}

export function TabBarButton({
  icon,
  label,
  isFocused,
  badge = false,
  ...rest
}: TabTriggerSlotProps & {
  icon: IconName;
  /**
   * The word under the icon. "My matches" wraps to two lines on a small phone,
   * so the tab says "Matches" while the screen keeps its full title.
   */
  label: string;
  /** The dot that says this member has no name yet — see useNeedsProfileSetup. */
  badge?: boolean;
}) {
  const color = isFocused ? colors.link : colors.inkMuted;

  return (
    <Pressable
      {...rest}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      // Announced as well as drawn: a coloured dot says nothing to a screen
      // reader, and this one is the only prompt some members get.
      accessibilityLabel={badge ? `${label} — setup needed` : label}
      style={{ flex: 1, alignItems: 'center', gap: 3 }}>
      {isFocused ? (
        <LinearGradient
          colors={[...brandGradient.short]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          // Hangs off the bar's top border, above the 8pt top padding.
          style={{
            position: 'absolute',
            top: -9,
            width: 28,
            height: 3,
            borderBottomLeftRadius: 3,
            borderBottomRightRadius: 3,
          }}
        />
      ) : null}
      <View>
        <Icon name={icon} size={24} color={color} strokeWidth={isFocused ? 2 : 1.8} />
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -4,
              width: 9,
              height: 9,
              borderRadius: 4.5,
              backgroundColor: colors.coral,
            }}
          />
        ) : null}
      </View>
      <Text numberOfLines={1} style={[isFocused ? text.tabActive : text.tab, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}
