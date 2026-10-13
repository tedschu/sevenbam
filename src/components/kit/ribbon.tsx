/**
 * The ribbon — the gradient squiggle taken from the icon's S-curve.
 * `DESIGN_HANDOFF.md` §4.1, whose geometry table is copied here verbatim.
 *
 * One stroked `<path>`, no fill, round caps, 90% opacity. Distinct from
 * `components/ribbon.tsx`, which builds an SVG data URI and hands it to
 * `expo-image` to avoid a renderer dependency: that approach cannot carry the
 * measured path lengths the draw-on animation needs, and cannot give each
 * instance its own gradient id. Both can stand until the login screen and the
 * old empty states move over, at which point the older one goes.
 *
 * Placement is the part that is easy to get wrong:
 *
 * - Offsets are measured from the *physical* top-right corner of the screen, so
 *   the ribbon must be positioned against an unpadded wrapper whose corner is
 *   the screen's — `ScreenScaffold` provides one.
 * - It belongs inside the scroll content, rendered first, so it scrolls away
 *   with the header and everything else paints over it.
 * - It is fixed-size. On a wider phone it stays 300×230 in the corner rather
 *   than scaling, which is what keeps the stroke weight constant.
 */

import React, { useEffect, useId, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { brandGradient, colors, motion } from '@/constants/design';

import { decorativeSvgProps } from './decorative';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Preset = {
  width: number;
  height: number;
  viewBox: string;
  d: string;
  strokeWidth: number;
  opacity: number;
  /** The gradient vector, in the SVG default `objectBoundingBox` units. */
  x2: string;
  y2: string;
  stops: readonly (readonly [number, string])[];
  /** Measured length in viewBox units, for the draw-on animation. */
  length: number;
  position: ViewStyle;
};

const spectrum = brandGradient.colors.map(
  (color, index) => [brandGradient.ribbonLocations[index], color] as const
);

export const RibbonPresets = {
  /** Browse. Four segments; the tail curls back under the header. */
  hero: {
    width: 300,
    height: 230,
    viewBox: '0 0 300 230',
    d: 'M40 30 C 110 -5, 170 70, 215 55 S 290 10, 270 80 S 170 150, 150 190 S 190 240, 250 210',
    strokeWidth: 16,
    opacity: 0.9,
    x2: '1',
    y2: '1',
    stops: spectrum,
    length: 590,
    position: { top: -18, right: -70 },
  },
  /** My Matches and League. The hero curve minus its last segment. */
  compact: {
    width: 300,
    height: 230,
    viewBox: '0 0 300 230',
    d: 'M40 30 C 110 -5, 170 70, 215 55 S 290 10, 270 80 S 170 150, 150 190',
    strokeWidth: 16,
    opacity: 0.9,
    x2: '1',
    y2: '1',
    stops: spectrum,
    length: 457,
    position: { top: -40, right: -110 },
  },
  /**
   * Inside the Leaderboard standing card — the only in-card use. Horizontal
   * gradient, four stops, and it stays in the bottom-right corner clear of the
   * detail text (which the card caps at 210pt for exactly that reason).
   */
  card: {
    width: 260,
    height: 150,
    viewBox: '0 0 260 150',
    d: 'M10 120 C 60 40, 110 40, 140 90 S 220 150, 250 60',
    strokeWidth: 14,
    opacity: 0.9,
    x2: '1',
    y2: '0',
    stops: [
      [0, colors.teal],
      [0.35, colors.lime],
      [0.6, colors.yellow],
      [1, colors.coral],
    ],
    length: 332,
    position: { right: -120, bottom: -70 },
  },
} satisfies Record<string, Preset>;

export type RibbonVariant = keyof typeof RibbonPresets;

export function Ribbon({
  variant = 'hero',
  style,
  animateIn = false,
}: {
  variant?: RibbonVariant;
  /** Overrides the preset's placement — League passes `{ top: -30, right: -90 }`. */
  style?: StyleProp<ViewStyle>;
  /** Draws the stroke on once, over 900ms. Skipped under Reduce Motion. */
  animateIn?: boolean;
}) {
  const preset: Preset = RibbonPresets[variant];
  /**
   * A gradient id per mounted instance. Duplicated ids make SVG gradients pick
   * the wrong definition, or render nothing at all on Android.
   */
  const gradientId = `ribbon-${useId().replace(/:/g, '')}`;
  // Held in state, not a ref: `reactCompiler` is on, and reading `ref.current`
  // during render is what the compiler's lint forbids. Same shape as
  // `animated-icon.web.tsx`.
  const [offset] = useState(() => new Animated.Value(animateIn ? preset.length : 0));

  useEffect(() => {
    if (!animateIn) return;
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        offset.setValue(0);
        return;
      }
      Animated.timing(offset, {
        toValue: 0,
        duration: motion.ribbonDraw,
        easing: Easing.out(Easing.cubic),
        // SVG attributes are not native-driver animatable.
        useNativeDriver: false,
      }).start();
    });

    return () => {
      cancelled = true;
    };
  }, [animateIn, offset]);

  return (
    <Svg
      width={preset.width}
      height={preset.height}
      viewBox={preset.viewBox}
      fill="none"
      // Decoration. It sits behind a button on Browse and must never take a press.
      pointerEvents="none"
      {...decorativeSvgProps}
      style={[{ position: 'absolute' }, preset.position, style]}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2={preset.x2} y2={preset.y2}>
          {preset.stops.map(([at, color]) => (
            <Stop key={at} offset={at} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <AnimatedPath
        d={preset.d}
        stroke={`url(#${gradientId})`}
        strokeWidth={preset.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={preset.opacity}
        strokeDasharray={animateIn ? [preset.length, preset.length] : undefined}
        strokeDashoffset={animateIn ? offset : undefined}
      />
    </Svg>
  );
}
