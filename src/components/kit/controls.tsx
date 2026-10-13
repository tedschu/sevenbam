/**
 * Buttons, pills, the switch and the segmented control —
 * `DESIGN_HANDOFF.md` §4.3–§4.6.
 *
 * The hierarchy is the point of this file: at most one gradient button per card
 * and one in the header, everything else outline / soft / plain. `draw` exists
 * only for Draw tables and Reshuffle, so that one action is recognisable by
 * colour alone across the league screen.
 *
 * Gradient buttons always take ink labels, never white. White over the yellow
 * stop in the middle of the gradient is illegible, and the gradient is fixed.
 */

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  type LayoutChangeEvent,
  Pressable,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { brandGradient, colors, fonts, motion, pillTones, radius, shadow, text } from '@/constants/design';

import { Icon, type IconName } from './icons';

type ButtonSize = 'lg' | 'md' | 'sm';

const ButtonHeight: Record<ButtonSize, number> = { lg: 50, md: 48, sm: 44 };

/**
 * The one primary action on a card or in a header — a flat surface inside a
 * thin gradient ring, not a filled gradient.
 *
 * Filled, the gradient was the loudest thing on every screen it sat on, and
 * it forced the label dark: white over the gradient's `#FFD44D` midpoint is
 * 1.4:1. As a ring it still reads unmistakably as the brand while `ink` sits
 * on plain white at full contrast. Built as a gradient View padded by the
 * ring width with the flat surface laid inside it, since a border cannot
 * itself take a gradient on either platform.
 */
export function GradientButton({
  label,
  icon,
  onPress,
  size = 'lg',
  glow = false,
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  size?: ButtonSize;
  /** The coral glow, which belongs to the header Propose button alone. */
  glow?: boolean;
  disabled?: boolean;
  /**
   * A request is in flight. Keeps the label — a spinner alone loses what is
   * being waited for — and blocks a second press, which on sign-in meant two
   * requests for one intent.
   */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        {
          borderRadius: radius.pill,
          opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        glow && shadow.glow,
        style,
      ]}>
      <LinearGradient
        colors={brandGradient.colors}
        locations={brandGradient.locations}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        // The ring: fixed to the button's own height, padded by the ring
        // width, with the flat surface below filling what's left of it.
        style={{ height: ButtonHeight[size], borderRadius: radius.pill, padding: 2 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: radius.pill,
            paddingHorizontal: size === 'sm' ? 16 : 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : icon ? (
            <Icon name={icon} size={18} color={colors.ink} strokeWidth={2.4} />
          ) : null}
          <Text
            style={[
              size === 'lg' ? text.button : text.buttonSm,
              { color: colors.ink, fontSize: size === 'sm' ? 14 : size === 'md' ? 15 : 16 },
            ]}>
            {label}
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export type ButtonVariant = 'outline' | 'soft' | 'plain' | 'draw' | 'dark' | 'danger';

/**
 * Everything below the primary action.
 *
 * `active` is for the buttons that are really toggles — "Ask subs" while seats
 * are being offered — and turns the button dark, which is the design's one way
 * of saying a button is currently on.
 */
export function Button({
  label,
  icon,
  onPress,
  variant = 'soft',
  size = 'sm',
  active = false,
  disabled = false,
  busy = false,
  leading,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize | 'xs';
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** For a mark the icon set does not own — Google's, on the sign-in screen. */
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const tones = {
    outline: { bg: colors.white, border: colors.teal, borderWidth: 2, fg: colors.link },
    soft: { bg: colors.bg, border: colors.track, borderWidth: 1, fg: colors.ink },
    plain: { bg: colors.white, border: colors.track, borderWidth: 1, fg: colors.ink },
    draw: { bg: pillTones.draw.bg, border: 'transparent', borderWidth: 0, fg: pillTones.draw.fg },
    dark: { bg: colors.ink, border: 'transparent', borderWidth: 0, fg: colors.white },
    /** Archive and Delete: soft, so it is not louder than the primary action, but in danger ink. */
    danger: { bg: colors.bg, border: colors.track, borderWidth: 1, fg: colors.danger },
  }[active ? 'dark' : variant];

  const height = size === 'xs' ? 40 : ButtonHeight[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      // 40pt is under the 44 minimum, so the shortfall is made up in slop.
      hitSlop={size === 'xs' ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, selected: active, busy }}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal: size === 'xs' ? 14 : 16,
          borderRadius: radius.pill,
          backgroundColor: tones.bg,
          borderWidth: tones.borderWidth,
          borderColor: tones.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={tones.fg} />
      ) : (
        (leading ?? (icon ? <Icon name={icon} size={17} color={tones.fg} /> : null))
      )}
      <Text
        style={[
          text.buttonSm,
          { color: tones.fg, fontSize: size === 'xs' ? 13 : size === 'sm' ? 14 : 15 },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A round icon button — back, share, more filters, edit.
 *
 * `locked` is the reshuffle-after-a-table-was-played state from §4.10: pale lime
 * with a padlock badge, rather than the faded button today's app shows, which
 * read as broken instead of deliberately closed.
 */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  size = 44,
  tone = 'plain',
  locked = false,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  size?: 44 | 48;
  tone?: 'plain' | 'draw';
  locked?: boolean;
}) {
  const background = locked ? colors.lockedDrawBg : tone === 'draw' ? pillTones.draw.bg : colors.white;
  const foreground = locked ? colors.lockedDrawFg : tone === 'draw' ? pillTones.draw.fg : colors.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={locked || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: locked }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        borderWidth: tone === 'plain' && !locked ? 1 : 0,
        borderColor: colors.track,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}>
      <Icon name={icon} size={size === 48 ? 20 : 18} color={foreground} />
      {locked ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: colors.white,
            borderWidth: 1,
            borderColor: colors.track,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="lock" size={11} color={colors.inkMuted} strokeWidth={2.4} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** "+ Add meetup", "+ New season", "Use my location", and "Leave this league" in danger ink. */
export function TextLink({
  label,
  onPress,
  icon,
  color = colors.link,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>
      {icon ? <Icon name={icon} size={16} color={color} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color }}>{label}</Text>
    </Pressable>
  );
}

/**
 * A status pill. Uppercased here rather than by the caller, so no screen can
 * pass sentence case by accident.
 */
export function Pill({ label, tone }: { label: string; tone: keyof typeof pillTones }) {
  const colour = pillTones[tone];
  return (
    <View
      style={{
        backgroundColor: colour.bg,
        borderRadius: radius.pill,
        paddingVertical: 3,
        paddingHorizontal: 10,
        alignSelf: 'flex-start',
      }}>
      <Text style={[text.pill, { color: colour.fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** The coral count beside a section title. */
export function CountBadge({ count }: { count: number }) {
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: 7,
        borderRadius: 11,
        backgroundColor: colors.coral,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.ink }}>
        {count}
      </Text>
    </View>
  );
}

/**
 * The switch, with its label and description — the whole row is the target.
 *
 * Built by hand rather than with RN's `Switch` so the on state is brand teal on
 * both platforms; the platform control would be iOS green here and Material
 * purple there.
 */
export function Toggle({
  value,
  onValueChange,
  label,
  description,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  // State rather than a ref — see the note in kit/ribbon.tsx.
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: motion.base,
      // The track colour is interpolated, and colour is not native-driver safe.
      useNativeDriver: false,
    }).start();
  }, [value, progress]);

  const trackColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.dashed, colors.teal],
  });
  // 52 − 3 − 3 − 26.
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[text.bodyStrong, { color: colors.ink }]}>{label}</Text>
        {description ? <Text style={[text.caption, { color: colors.inkMuted }]}>{description}</Text> : null}
      </View>
      <Animated.View
        style={{ width: 52, height: 32, borderRadius: 16, padding: 3, backgroundColor: trackColor }}>
        <Animated.View
          style={[
            { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.white, transform: [{ translateX }] },
            {
              shadowColor: colors.ink,
              shadowOpacity: 0.2,
              shadowRadius: 1.5,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

/**
 * The distance picker on Browse and the match-type filter on My Matches.
 *
 * The thumb is a sibling of the labels rather than a background on the selected
 * one, so it can slide between them. Its width comes from a measured layout,
 * which is why nothing is drawn until the track has one.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  // The track's 4pt padding on each side, and 2pt between each pair of segments.
  const segmentWidth =
    trackWidth > 0 ? (trackWidth - 8 - 2 * (options.length - 1)) / options.length : 0;
  const [x] = useState(() => new Animated.Value(0));
  /** A ref, not state: this is only ever read and written inside the effect. */
  const placed = useRef(false);

  useEffect(() => {
    if (segmentWidth <= 0) return;
    const to = index * (segmentWidth + 2);

    /**
     * The first placement jumps, and only later changes slide.
     *
     * The width is not known until the track has been laid out, so on the first
     * pass there is nowhere to animate to — and animating from 0 once it arrives
     * left the thumb under the first segment while a different one was selected,
     * which is what a preselected filter like "15 mi" looks like on open.
     */
    if (!placed.current) {
      x.setValue(to);
      placed.current = true;
      return;
    }

    Animated.timing(x, { toValue: to, duration: motion.base, useNativeDriver: true }).start();
  }, [index, segmentWidth, x]);

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: colors.track,
          borderRadius: radius.pill,
          padding: 4,
          gap: 2,
        },
        style,
      ]}>
      {segmentWidth > 0 ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 4,
              left: 4,
              width: segmentWidth,
              height: 36,
              borderRadius: radius.pill,
              backgroundColor: colors.white,
            },
            shadow.segment,
            { transform: [{ translateX: x }] },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            // The segments are 36 tall inside a 44 track; slop covers the rest.
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Text
              style={{
                fontFamily: selected ? fonts.semibold : fonts.medium,
                fontSize: 13,
                lineHeight: 18,
                color: selected ? colors.link : colors.inkMuted,
              }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
