/**
 * The composite cards — `DESIGN_HANDOFF.md` §4.7, §4.12, §4.13 and §5.
 *
 * Presentation only. Every one of these takes its data and its callbacks from
 * the screen, so the existing actions — take a seat, enter scores, draw the
 * tables, offer them to subs — keep their current behaviour and rules.
 */

import React, { useId } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { colors, fonts, type PillTone, pillTones, radius, shadow, text } from '@/constants/design';

import { Button, GradientButton, IconButton, Pill } from './controls';
import { Icon } from './icons';
import {
  Avatar,
  AvatarStack,
  Card,
  InfoNote,
  InsetWell,
  LeagueDot,
  type Player,
  PointsBar,
} from './layout';
import { Ribbon } from './ribbon';
import { DateTile, RankTile } from './tiles';

export type PillSpec = { label: string; tone: PillTone };

/**
 * The top of every match and meetup card: date tile, then pills, title and a
 * meta line. Pills sit above the title so the state of the thing is read before
 * its name.
 */
export function CardHeading({
  date,
  timeZone,
  edgeColor,
  pills,
  title,
  meta,
  leagueColor,
  size = 'md',
}: {
  date: Date;
  timeZone?: string | null;
  edgeColor: string;
  pills: readonly PillSpec[];
  title: string;
  meta: string;
  /** Set for a league item, which precedes its meta line with a dot. */
  leagueColor?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <DateTile date={date} timeZone={timeZone} edgeColor={edgeColor} size={size} />
      <View style={{ flex: 1, gap: 3 }}>
        {pills.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {pills.map((pill) => (
              <Pill key={pill.label} {...pill} />
            ))}
          </View>
        ) : null}
        <Text
          style={[
            size === 'lg' ? text.heroCardTitle : text.cardTitle,
            { color: colors.ink, marginTop: 3 },
          ]}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {leagueColor ? <LeagueDot color={leagueColor} /> : null}
          <Text
            style={[
              size === 'lg' ? { ...text.meta, fontSize: 14, lineHeight: 20 } : text.meta,
              { color: colors.inkMuted, flexShrink: 1 },
            ]}>
            {meta}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Browse's lead card: a table one player short.
 *
 * The seat well says how full the table is twice over — as circles and as words —
 * and the dashed coral circle does the same thing as the button under it, because
 * it is the one people reach for.
 */
export function NeedsSubCard({
  date,
  timeZone,
  leagueColor,
  whenPill,
  venue,
  meta,
  players,
  seats,
  tableLabel,
  onTakeSeat,
  onPress,
}: {
  date: Date;
  timeZone?: string | null;
  leagueColor: string;
  /** "Tonight" or "Tomorrow", when either applies. */
  whenPill?: string;
  venue: string;
  meta: string;
  players: readonly Player[];
  seats: number;
  tableLabel: string;
  onTakeSeat: () => void;
  /** Opens the existing match or table detail. */
  onPress?: () => void;
}) {
  const pills: PillSpec[] = [{ label: 'Needs a sub', tone: 'sub' }];
  if (whenPill) pills.push({ label: whenPill, tone: 'soon' });

  const body = (
    <Card padding={18} gap={16}>
      <CardHeading
        size="lg"
        date={date}
        timeZone={timeZone}
        edgeColor={leagueColor}
        pills={pills}
        title={venue}
        meta={meta}
      />
      <InsetWell style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AvatarStack
          players={players}
          seats={seats}
          ring={colors.bg}
          openSeatStyle="join"
          onJoin={onTakeSeat}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.ink }}>
            {players.length} of {seats} seats filled
          </Text>
          <Text style={[text.caption, { color: colors.inkMuted }]}>{tableLabel}</Text>
        </View>
      </InsetWell>
      <GradientButton label="Take the open seat" onPress={onTakeSeat} />
    </Card>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Needs a sub${whenPill ? `, ${whenPill}` : ''}. ${venue}, ${meta}. ${players.length} of ${seats} seats filled.`}>
      {body}
    </Pressable>
  );
}

/** A league, on Browse and on the Leagues list. */
export function LeagueRowCard({
  name,
  status,
  meta,
  onPress,
  compact = false,
  action,
  muted = false,
}: {
  name: string;
  /** "Full", "Meets soon" — whatever qualifies the LEAGUE label. */
  status?: string;
  meta: string;
  onPress: () => void;
  /** The tighter row the empty Browse screen uses under "Meanwhile". */
  compact?: boolean;
  /**
   * The screen's own control — Browse's Join. A sibling of the pressable row
   * rather than a child, so tapping the card cannot also mean tapping Join; on
   * web a click bubbles to every handler above it.
   */
  action?: React.ReactNode;
  /** A full league recedes rather than disappearing. */
  muted?: boolean;
}) {
  const chip = compact ? 44 : 52;

  const row = (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, ${meta}`}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        }}>
        <View
          style={{
            width: chip,
            height: chip,
            borderRadius: radius.iconChip,
            backgroundColor: pillTones.league.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="trophyHandles" size={compact ? 22 : 26} color={pillTones.league.fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 11,
              lineHeight: 14,
              letterSpacing: 0.88,
              color: pillTones.league.fg,
            }}>
            LEAGUE
            {status ? (
              <Text style={{ fontFamily: fonts.regular, letterSpacing: 0, color: colors.inkMuted }}>
                {`  · ${status}`}
              </Text>
            ) : null}
          </Text>
          <Text style={[text.cardTitle, { color: colors.ink }]}>{name}</Text>
          <Text style={[text.meta, { color: colors.inkMuted }]}>{meta}</Text>
        </View>
        <Icon name="chevronRight" size={20} color={colors.inkMuted} strokeWidth={2} />
      </View>
    </Pressable>
  );

  return (
    <Card
      padding={compact ? 12 : 16}
      gap={12}
      style={[
        { paddingHorizontal: compact ? 14 : 18, borderRadius: compact ? 20 : radius.card },
        muted && { opacity: 0.72 },
      ]}>
      {row}
      {action}
    </Card>
  );
}

/**
 * A match on My Matches.
 *
 * The footer carries who is playing on the left and the actions on the right.
 * Empty seats are only drawn on matches the viewer hosts: on somebody else's
 * table, the gaps are not theirs to fill from here.
 */
export function MatchCard({
  date,
  timeZone,
  edgeColor,
  pills,
  venue,
  meta,
  leagueColor,
  players,
  seats,
  countLabel,
  scoresState,
  onScores,
  onEdit,
  onPress,
}: {
  date: Date;
  timeZone?: string | null;
  edgeColor: string;
  pills: readonly PillSpec[];
  venue: string;
  meta: string;
  leagueColor?: string;
  players: readonly Player[];
  seats: number;
  /** "2 players" or "1 of 4". */
  countLabel: string;
  /** Upcoming matches have no scores button at all. */
  scoresState?: 'missing' | 'entered';
  onScores?: () => void;
  /** Only when the viewer is hosting. */
  onEdit?: () => void;
  onPress?: () => void;
}) {
  const body = (
    <Card>
      <CardHeading
        date={date}
        timeZone={timeZone}
        edgeColor={edgeColor}
        pills={pills}
        title={venue}
        meta={meta}
        leagueColor={leagueColor}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AvatarStack
          players={players}
          seats={seats}
          size={32}
          openSeatStyle={onEdit ? 'empty' : 'none'}
        />
        <Text style={[text.meta, { color: colors.inkMuted, flex: 1 }]}>{countLabel}</Text>
        {onEdit ? <IconButton icon="pencil" accessibilityLabel="Edit match" onPress={onEdit} /> : null}
        {scoresState && onScores ? (
          scoresState === 'missing' ? (
            <Button variant="outline" icon="plus" label="Add scores" onPress={onScores} />
          ) : (
            <Button variant="soft" icon="scores" label="Scores" onPress={onScores} />
          )
        ) : null}
      </View>
    </Card>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${venue}, ${meta}. ${countLabel}.`}>
      {body}
    </Pressable>
  );
}

/**
 * A meetup on the league screen — the organizer's weekly job.
 *
 * Two shapes, decided by whether a table has been played. Before: a gradient
 * Add scores, then draw / subs / edit in a row, with the note explaining the
 * first two. After: scores become editable and the draw is locked, because a
 * reshuffle then would erase scores that are already part of the standings.
 */
export function MeetupCard({
  number,
  date,
  timeZone,
  leagueColor,
  venue,
  meta,
  tablesLabel,
  onToggleTables,
  played,
  scoresEntered,
  tablesDrawn,
  offeringSubs,
  onScores,
  onDraw,
  onToggleSubs,
  onEdit,
  children,
}: {
  number: number;
  date: Date;
  timeZone?: string | null;
  leagueColor: string;
  venue: string;
  /** "Sep 10 · 7:00 pm · 2 in". */
  meta: string;
  tablesLabel: string;
  onToggleTables: () => void;
  played: boolean;
  scoresEntered: boolean;
  tablesDrawn: boolean;
  offeringSubs: boolean;
  onScores: () => void;
  onDraw: () => void;
  onToggleSubs: () => void;
  onEdit: () => void;
  /** The drawn tables, when the row above is expanded. */
  children?: React.ReactNode;
}) {
  const pill: PillSpec | null =
    played && !scoresEntered
      ? { label: 'Scores needed', tone: 'sub' }
      : played
        ? { label: 'Played', tone: 'neutral' }
        : null;
  const drawLabel = tablesDrawn ? 'Reshuffle' : 'Draw tables';

  return (
    <Card>
      <CardHeading
        date={date}
        timeZone={timeZone}
        edgeColor={leagueColor}
        pills={pill ? [pill] : []}
        title={`${number} · ${venue}`}
        meta={meta}
      />
      <Pressable
        onPress={onToggleTables}
        accessibilityRole="button"
        accessibilityLabel={tablesLabel}
        style={{
          height: 44,
          borderRadius: 12,
          backgroundColor: colors.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
        }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.link }}>
          {tablesLabel}
        </Text>
        <Icon name="chevronDown" size={18} color={colors.link} strokeWidth={2} />
      </Pressable>

      {children}

      {played ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            variant="outline"
            size="md"
            icon="scores"
            label={scoresEntered ? 'Edit scores' : 'Add scores'}
            onPress={onScores}
            style={{ flex: 1 }}
          />
          <IconButton
            size={48}
            icon="shuffle"
            tone="draw"
            locked
            accessibilityLabel="Reshuffle locked: a table has been played"
          />
          <IconButton size={48} icon="pencil" accessibilityLabel="Edit meetup" onPress={onEdit} />
        </View>
      ) : (
        <>
          <GradientButton size="md" icon="plus" label="Add scores" onPress={onScores} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              variant="draw"
              icon="shuffle"
              label={drawLabel}
              onPress={onDraw}
              style={{ flex: 1, paddingHorizontal: 0 }}
            />
            <Button
              variant="plain"
              icon="users"
              label="Ask subs"
              active={offeringSubs}
              onPress={onToggleSubs}
              style={{ flex: 1, paddingHorizontal: 0 }}
            />
            <Button
              variant="plain"
              icon="pencil"
              label="Edit"
              onPress={onEdit}
              style={{ flex: 1, paddingHorizontal: 0 }}
            />
          </View>
          <InfoNote
            rows={[
              {
                icon: 'shuffle',
                chipBg: pillTones.draw.bg,
                chipFg: pillTones.draw.fg,
                term: drawLabel,
                body:
                  'deals everyone coming into tables of four and adds each table to their My Matches. ' +
                  "It locks once a table is played, so scores can't be erased.",
              },
              {
                icon: 'users',
                chipBg: colors.white,
                chipFg: colors.ink,
                chipBorder: true,
                term: 'Ask subs',
                body:
                  "lists this meetup's empty seats in Browse for players outside the league. Tap again to stop.",
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}

/** What Browse shows instead of "Needs you" when nothing nearby has a seat. */
export function NoOpenSeatsCard({
  radiusLabel,
  nextRadiusLabel,
  onPropose,
  onWiden,
}: {
  radiusLabel: string;
  /** Absent once the radius is already Any, which hides the Widen button. */
  nextRadiusLabel?: string;
  onPropose: () => void;
  onWiden?: () => void;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.cardLg,
          // The table illustration used to sit above the text here. Dropped —
          // on a phone it pushed "No open seats" and both buttons below the
          // fold, for a graphic that said nothing the heading didn't already.
          paddingVertical: 22,
          paddingHorizontal: 22,
          alignItems: 'center',
          gap: 16,
        },
        shadow.card,
      ]}>
      <View style={{ gap: 6, alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 21,
            lineHeight: 26,
            color: colors.ink,
            textAlign: 'center',
          }}>
          No open seats within {radiusLabel}
        </Text>
        <Text
          style={{
            fontFamily: fonts.regular,
            fontSize: 14,
            lineHeight: 21,
            color: colors.inkMuted,
            textAlign: 'center',
          }}>
          Every table nearby is full right now. Start one yourself and nearby players can join.
        </Text>
      </View>
      <View style={{ alignSelf: 'stretch', gap: 10 }}>
        <GradientButton label="Propose a game" onPress={onPropose} />
        {nextRadiusLabel && onWiden ? (
          <Button variant="outline" size="md" label={`Widen to ${nextRadiusLabel}`} onPress={onWiden} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The viewer's own standing, on ink — the one place the ribbon appears inside a
 * card. The detail line is capped so it wraps before it reaches the stroke.
 */
export function YourStandingCard({
  me,
  rank,
  points,
  detail,
}: {
  me: Player;
  /** Already ordinal: "2nd". */
  rank: string;
  points: number;
  detail: string;
}) {
  const ringId = `ring-${useId().replace(/:/g, '')}`;
  return (
    <View
      style={{
        backgroundColor: colors.ink,
        borderRadius: radius.card,
        padding: 20,
        gap: 14,
        overflow: 'hidden',
      }}>
      <Ribbon variant="card" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {/* A 56pt gradient circle behind a 50pt avatar, which leaves a 3pt ring. */}
        <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={56} height={56} viewBox="0 0 56 56" style={{ position: 'absolute' }}>
            <Defs>
              <SvgGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
                <Stop offset={0} stopColor={colors.teal} />
                <Stop offset={0.5} stopColor={colors.yellow} />
                <Stop offset={1} stopColor={colors.coral} />
              </SvgGradient>
            </Defs>
            <Circle cx={28} cy={28} r={28} fill={`url(#${ringId})`} />
          </Svg>
          <Avatar player={me} size={50} ring={colors.ink} />
        </View>
        <View>
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 12,
              lineHeight: 16,
              letterSpacing: 1.2,
              color: colors.yellow,
            }}>
            YOUR STANDING
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 26, lineHeight: 31, color: colors.white }}>
            {rank} · {points} pts
          </Text>
        </View>
      </View>
      <Text
        style={{
          fontFamily: fonts.regular,
          fontSize: 14,
          lineHeight: 20,
          color: colors.inkOnDarkMuted,
          maxWidth: 210,
        }}>
        {detail}
      </Text>
    </View>
  );
}

/** One row of the standings list. */
export function StandingRow({
  rank,
  player,
  name,
  isMe,
  points,
  leaderPoints,
  detail,
}: {
  rank: number | string;
  player: Player;
  name: string;
  isMe: boolean;
  points: number;
  leaderPoints: number;
  /** "1 game · 1 win". */
  detail: string;
}) {
  const leader = rank === 1;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 18,
        backgroundColor: isMe ? colors.youRow : 'transparent',
      }}>
      <RankTile rank={rank} leader={leader} highlighted={isMe} />
      <Avatar player={player} size={40} ring="transparent" />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={[text.bodyStrong, { color: colors.ink, flexShrink: 1 }]}>
            {name}
            {isMe ? (
              <Text style={{ fontFamily: fonts.regular, color: colors.inkMuted }}> (you)</Text>
            ) : null}
          </Text>
          <Text
            style={{
              fontFamily: fonts.bold,
              fontSize: 20,
              lineHeight: 24,
              color: leader ? colors.leaderPoints : colors.ink,
              // Scores line up across rows rather than on each row's own width.
              fontVariant: ['tabular-nums'],
            }}>
            {points}
          </Text>
        </View>
        <PointsBar
          fraction={leaderPoints ? points / leaderPoints : 0}
          trackColor={isMe ? colors.youRowTrack : colors.divider}
        />
        <Text style={[text.caption, { color: colors.inkMuted }]}>{detail}</Text>
      </View>
    </View>
  );
}
