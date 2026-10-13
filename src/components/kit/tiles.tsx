/**
 * Mahjong-tile surfaces — `DESIGN_HANDOFF.md` §4.2.
 *
 * An ivory face sitting on a thicker coloured edge that shows below it, the way
 * the side of a real tile does. The handoff's CSS draws that with a zero-blur
 * `box-shadow: 0 5px 0 <edge>`; React Native has no reliable equivalent, so it
 * is two stacked Views — an outer box in the edge colour, tall enough to peek
 * out below the face pinned to its top.
 *
 * The motif carries dates, stats and ranks, which is the whole reason a date is
 * not just another line of text on a card.
 */

import React from 'react';
import { Pressable, type StyleProp, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts, radius } from '@/constants/design';

import { Icon } from './icons';

export function TileSurface({
  width,
  height,
  edgeColor,
  edgeSize = 5,
  borderRadius = radius.tile,
  faceColor = colors.tileFace,
  children,
  style,
}: {
  width: number | `${number}%`;
  /** The height of the face. The edge is added below it. */
  height: number;
  edgeColor: string;
  edgeSize?: number;
  borderRadius?: number;
  faceColor?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ width, height: height + edgeSize, borderRadius, backgroundColor: edgeColor }, style]}>
      <View
        style={{
          height,
          borderRadius,
          backgroundColor: faceColor,
          borderWidth: 1,
          borderColor: colors.tileBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {children}
      </View>
    </View>
  );
}

/**
 * The calendar block at the left of every match and meetup card.
 *
 * The caller passes the date already resolved to the match's own time zone —
 * `matches.time_zone`, not the device's. A Tuesday meetup has to read TUE to
 * somebody looking at it from another zone, or the tile is lying about when the
 * game is.
 */
export function DateTile({
  date,
  edgeColor,
  size = 'md',
  timeZone,
}: {
  date: Date;
  edgeColor: string;
  size?: 'md' | 'lg';
  timeZone?: string | null;
}) {
  const large = size === 'lg';
  const options: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  const weekday = date
    .toLocaleDateString(undefined, { ...options, weekday: 'short' })
    .toUpperCase();
  // No leading zero, which is why this is not `{ day: '2-digit' }`.
  const day = date.toLocaleDateString(undefined, { ...options, day: 'numeric' });

  return (
    <TileSurface width={large ? 58 : 54} height={large ? 66 : 62} edgeColor={edgeColor}>
      <Text
        style={{
          fontFamily: fonts.bold,
          fontSize: 11,
          lineHeight: 14,
          letterSpacing: 1.1,
          color: colors.tileWeekday,
        }}>
        {weekday}
      </Text>
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: large ? 26 : 24,
          lineHeight: large ? 28 : 26,
          color: colors.ink,
          marginTop: 1,
        }}>
        {day}
      </Text>
    </TileSurface>
  );
}

/**
 * The three-across summary at the top of a league — Members, Meetups, Season.
 *
 * Only Season is pressable (it opens the picker), and it earns a chevron and a
 * 2pt press travel to say so; the other two are plain numbers and must not look
 * tappable.
 */
export function StatTile({
  value,
  label,
  edgeColor,
  onPress,
  accessibilityLabel,
}: {
  value: string | number;
  label: string;
  edgeColor: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const content = (
    <TileSurface width="100%" height={72} edgeColor={edgeColor} borderRadius={radius.tileLg}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 26, color: colors.ink }}>
          {value}
        </Text>
        {onPress ? <Icon name="chevronDown" size={14} color={colors.inkMuted} strokeWidth={2.4} /> : null}
      </View>
      <Text style={{ fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.inkMuted }}>
        {label}
      </Text>
    </TileSurface>
  );

  if (!onPress) return <View style={{ flex: 1 }}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label} ${value}`}
      style={({ pressed }) => ({ flex: 1, transform: [{ translateY: pressed ? 2 : 0 }] })}>
      {content}
    </Pressable>
  );
}

/** The rank number on a Leaderboard row. The leader's edge is yellow; everyone else's is grey. */
export function RankTile({
  rank,
  leader = false,
  highlighted = false,
}: {
  /** A string for a member with no games yet, who is ranked on nothing. */
  rank: number | string;
  leader?: boolean;
  /** True on the viewer's own row, whose warm ground needs a white face to stay legible. */
  highlighted?: boolean;
}) {
  return (
    <TileSurface
      width={28}
      height={32}
      edgeSize={3}
      borderRadius={7}
      edgeColor={leader ? colors.yellow : colors.rankEdge}
      faceColor={highlighted ? colors.white : colors.tileFace}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.ink }}>
        {rank}
      </Text>
    </TileSurface>
  );
}
