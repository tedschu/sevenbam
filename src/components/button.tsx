import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './icon';
import { ThemedText } from './themed-text';

import { BrandGradient, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Common = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks presses. */
  busy?: boolean;
  icon?: IconName;
  /**
   * Something to draw before the label instead of an `icon`, for a mark that
   * cannot be reduced to one stroke colour — Google's G being the case this
   * exists for. Ignored when `icon` is also given.
   */
  leading?: ReactNode;
  /** Stretches to the container's width. Off by default. */
  wide?: boolean;
  style?: ViewStyle;
};

/**
 * The primary button: a flat surface inside a thin gradient border.
 *
 * The gradient is the outline rather than the fill. A fully filled gradient made
 * the button the loudest thing on every screen it appeared on, and it forced the
 * label dark — white type over the gradient's `#ffd44d` midpoint is 1.4:1. As a
 * hairline it still reads unmistakably as the brand while the label sits on plain
 * ink at full contrast.
 *
 * Still deliberately scarce: **at most one per screen**, on the single thing that
 * screen exists to do.
 *
 * Built as a gradient view padded by the border width with the flat surface laid
 * inside it, because a border cannot itself take a gradient on either platform.
 */
export function GradientButton({
  label,
  onPress,
  disabled,
  busy,
  icon,
  wide,
  style,
}: Common) {
  const theme = useTheme();
  const inert = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inert), busy: Boolean(busy) }}
      style={({ pressed }) => [wide && styles.wide, pressed && styles.pressed, style]}>
      <LinearGradient
        colors={BrandGradient}
        // Left to right, as the guide prints it. On web `start`/`end` set only the
        // angle, which is all this needs.
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.gradientEdge, wide && styles.wide, disabled && styles.disabled]}>
        <View style={[styles.button, styles.inset, { backgroundColor: theme.background }]}>
          {busy ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <>
              {icon ? <Icon name={icon} color={theme.text} size={18} /> : null}
              <ThemedText type="smallBold">{label}</ThemedText>
            </>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * The join button: a solid teal fill with white type.
 *
 * Its own variant because joining is the one action that repeats down a list, and
 * neither of the buttons above can do that job. `GradientButton` is explicitly at
 * most one per screen and Browse already spends it on Propose — so league cards
 * using it meant a screen with five gradient buttons on it, each shouting as loudly
 * as the one action the screen is built around. `OutlineButton` is too quiet for
 * the thing a member came to Browse to do.
 *
 * A fill rather than an outline, in `accentButton` — the teal taken deep enough
 * that white type on it passes AA, which the brand teal at 2.5:1 does not.
 *
 * Compact by default so it sits in a card's action row; `wide` stretches it for a
 * sheet footer. Both are the same button, which is the point: taking a seat at a
 * match and joining a league now look identical, because they are the same kind of
 * decision.
 */
export function SolidButton({
  label,
  onPress,
  disabled,
  busy,
  icon,
  wide,
  style,
}: Common) {
  const theme = useTheme();
  const inert = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inert), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.button,
        styles.solid,
        { backgroundColor: theme.accentButton },
        wide && styles.wide,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={theme.onAccentButton} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={theme.onAccentButton} size={18} /> : null}
          <ThemedText type="smallBold" style={{ color: theme.onAccentButton }}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

/**
 * The secondary button: the card surface behind a teal outline, per the guide.
 *
 * The label is `accentInk` rather than the teal of the border, because the border
 * can be light where type cannot.
 */
export function OutlineButton({
  label,
  onPress,
  disabled,
  busy,
  icon,
  leading,
  wide,
  style,
}: Common) {
  const theme = useTheme();
  const inert = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inert), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.button,
        styles.outline,
        { backgroundColor: theme.background, borderColor: theme.accent },
        wide && styles.wide,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={theme.accentInk} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={theme.accentInk} size={18} /> : leading}
          <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

/**
 * An icon-only control, for the row at the foot of a match card. Three labelled
 * buttons cannot share that line at phone width, so each says what it does only
 * to assistive tech.
 *
 * Tones, quietest first:
 * - `default` — the page ground, secondary ink. Most of them.
 * - `done` — the highlight, for a state already reached: added to a calendar.
 * - `primary` — a solid teal fill for the one action worth the eye, in the deeper
 *   `accentButton` so its stroke can be white and still read.
 * - `danger` — destructive, and never filled: a filled red button invites the
 *   press it is warning about.
 */
export function QuietButton({
  icon,
  label,
  onPress,
  disabled,
  tone = 'default',
}: {
  icon: IconName;
  /** Not drawn — the control is icon-only — but announced. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * `accent` keeps the quiet shape but sets the glyph in ink rather than grey, for
   * a control that is genuinely on offer rather than incidental. `primary` fills
   * the whole button and is a louder thing again — it competes with a Join.
   */
  tone?: 'default' | 'done' | 'primary' | 'danger' | 'accent';
}) {
  const theme = useTheme();

  const fill =
    tone === 'primary'
      ? theme.accentButton
      : tone === 'done'
        ? theme.backgroundSelected
        : theme.backgroundElement;
  const color =
    tone === 'primary'
      ? theme.onAccentButton
      : tone === 'done'
        ? theme.accentWarmInk
        : tone === 'danger'
          ? theme.danger
          : tone === 'accent'
            ? theme.accentInk
            : theme.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.quiet,
        { backgroundColor: fill },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <Icon name={icon} color={color} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    // Comfortably tappable; below this a thumb starts missing.
    minHeight: 44,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
  },
  /**
   * Tighter than the base button, matching the row of controls a match card
   * already has. Still 34px tall, which is what the Leave pill beside it uses.
   */
  solid: {
    minHeight: 34,
    minWidth: 104,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  outline: {
    borderWidth: 1.5,
  },
  /**
   * The gradient itself, showing only as the ring left around the inset surface.
   * `padding` is the border's thickness.
   */
  gradientEdge: {
    padding: 1.5,
    borderRadius: Radius.pill,
  },
  /** Sits inside the ring; the pill radius means both curves agree at any size. */
  inset: {
    minHeight: 41,
  },
  wide: {
    alignSelf: 'stretch',
  },
  quiet: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.45,
  },
});
