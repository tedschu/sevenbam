/**
 * The component gallery for the redesign — step (b) of the handoff's order of
 * work, so the ribbon, tiles, toggle, segments and buttons can be checked on a
 * simulator before any screen is rebuilt around them.
 *
 * Development only: the tab that reaches it is `hidden` in a release build (see
 * `components/app-tabs.tsx`), and this route renders nothing there, so it cannot
 * be reached by typing a URL into the shipped web build either.
 *
 * Everything here is invented data. It is deliberately not wired to Supabase —
 * the point is to look at the parts, and a gallery that needs a session and a
 * seeded league is a gallery nobody opens.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { colors, fonts, pillTones, radius, text } from '@/constants/design';
import {
  Button,
  CountBadge,
  GradientButton,
  IconButton,
  Pill,
  SegmentedControl,
  TextLink,
  Toggle,
} from '@/components/kit/controls';
import {
  LeagueRowCard,
  MatchCard,
  MeetupCard,
  NeedsSubCard,
  NoOpenSeatsCard,
  StandingRow,
  YourStandingCard,
} from '@/components/kit/cards';
import { Icon, type IconName } from '@/components/kit/icons';
import {
  Avatar,
  AvatarStack,
  Card,
  DashedCard,
  InfoNote,
  InsetWell,
  type Player,
  PointsBar,
  ScreenHeader,
  ScreenScaffold,
  SectionHeader,
  TitleBlock,
} from '@/components/kit/layout';
import { Ribbon } from '@/components/kit/ribbon';
import { DateTile, RankTile, StatTile } from '@/components/kit/tiles';

const AppMark = require('@/assets/images/app-mark.png');

const Ted: Player = { id: 'ted', initials: 'TS' };
const April: Player = { id: 'april', initials: 'AL' };
const Mei: Player = { id: 'mei', initials: 'MC' };
const Jian: Player = { id: 'jian', initials: 'JS' };

const Tuesday = new Date(2026, 8, 22, 18, 30);
const Thursday = new Date(2026, 8, 10, 19, 0);

const IconNames: IconName[] = [
  'plus',
  'search',
  'calendar',
  'trophy',
  'trophyHandles',
  'bars',
  'profile',
  'chevronRight',
  'chevronDown',
  'chevronLeft',
  'pin',
  'sliders',
  'pencil',
  'scores',
  'shuffle',
  'users',
  'mail',
  'share',
  'lock',
  'info',
  'archive',
];

/** A labelled band, so it is obvious which piece is being looked at. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[text.caption, { color: colors.inkMuted, letterSpacing: 0.6 }]}>
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

export default function GalleryScreen() {
  const [distance, setDistance] = useState<'5' | '15' | '25' | '50' | 'any'>('15');
  const [kind, setKind] = useState<'all' | 'single' | 'league'>('all');
  const [openToJoin, setOpenToJoin] = useState(false);
  const [askingSubs, setAskingSubs] = useState(false);

  if (!__DEV__) return null;

  return (
    <ScreenScaffold ribbon="hero" animateRibbon>
      <ScreenHeader
        logo={AppMark}
        initials="TS"
        onProfilePress={() => {}}
        trailing={<GradientButton size="sm" icon="plus" label="Propose" glow onPress={() => {}} />}
      />
      <TitleBlock eyebrow="Component kit" title="Gallery" subtitle="Every shared piece, on invented data." />

      <Row label="Type scale">
        <Card gap={6}>
          <Text style={[text.display, { color: colors.ink }]}>Display 34</Text>
          <Text style={[text.displaySm, { color: colors.ink }]}>Display small 30</Text>
          <Text style={[text.eyebrow, { color: colors.link }]}>EYEBROW 12</Text>
          <Text style={[text.sectionTitle, { color: colors.ink }]}>Section title 18</Text>
          <Text style={[text.cardTitle, { color: colors.ink }]}>Card title 17</Text>
          <Text style={[text.body, { color: colors.ink }]}>Body 15 — the quick brown fox.</Text>
          <Text style={[text.meta, { color: colors.inkMuted }]}>Meta 13 · Geneva, IL · 6:30 pm</Text>
          <Text style={[text.caption, { color: colors.inkMuted }]}>Caption 12, for helper text.</Text>
        </Card>
      </Row>

      <Row label="Gradient buttons (ink labels, never white)">
        <View style={{ gap: 10 }}>
          <GradientButton label="Take the open seat" onPress={() => {}} />
          <GradientButton size="md" icon="plus" label="Add scores" onPress={() => {}} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <GradientButton size="sm" icon="plus" label="Propose" glow onPress={() => {}} />
            <GradientButton size="sm" label="Disabled" disabled onPress={() => {}} />
          </View>
        </View>
      </Row>

      <Row label="Secondary buttons">
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="outline" icon="plus" label="Add scores" onPress={() => {}} />
            <Button variant="soft" icon="scores" label="Scores" onPress={() => {}} />
            <Button variant="plain" label="Make organizer" size="xs" onPress={() => {}} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="draw" icon="shuffle" label="Draw tables" onPress={() => {}} />
            <Button variant="dark" label="Copy link" onPress={() => {}} />
            <Button variant="plain" icon="users" label="Ask subs" active={askingSubs} onPress={() => setAskingSubs((on) => !on)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <IconButton icon="chevronLeft" accessibilityLabel="Back" onPress={() => {}} />
            <IconButton icon="share" accessibilityLabel="Share" onPress={() => {}} />
            <IconButton icon="sliders" accessibilityLabel="More filters" onPress={() => {}} />
            <IconButton size={48} icon="shuffle" tone="draw" locked accessibilityLabel="Reshuffle locked" />
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TextLink icon="plus" label="Add meetup" onPress={() => {}} />
            <TextLink label="Use my location" onPress={() => {}} />
            <TextLink label="Leave this league" color={colors.danger} onPress={() => {}} />
          </View>
        </View>
      </Row>

      <Row label="Pills and count">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pill label="Needs a sub" tone="sub" />
            <Pill label="Tomorrow" tone="soon" />
            <Pill label="You're in" tone="you" />
            <Pill label="Hosting" tone="hosting" />
            <Pill label="Played" tone="neutral" />
            <Pill label="Tiles provided" tone="info" />
            <Pill label="Scores needed" tone="sub" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[text.sectionTitle, { color: colors.ink }]}>Needs you</Text>
            <CountBadge count={1} />
          </View>
        </Card>
      </Row>

      <Row label="Tiles">
        <Card style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <DateTile date={Tuesday} edgeColor={colors.teal} />
            <DateTile date={Thursday} edgeColor={colors.lime} />
            <DateTile date={Tuesday} edgeColor={colors.violet} size="lg" />
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <RankTile rank={1} leader />
              <RankTile rank={2} />
              <RankTile rank={3} highlighted />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile value={2} label="Members" edgeColor={colors.teal} />
            <StatTile value={2} label="Meetups" edgeColor={colors.yellow} />
            <StatTile value={1} label="Season" edgeColor={colors.coral} onPress={() => {}} />
          </View>
        </Card>
      </Row>

      <Row label="Segmented controls">
        <View style={{ gap: 10 }}>
          <SegmentedControl
            accessibilityLabel="Distance"
            value={distance}
            onChange={setDistance}
            options={[
              { value: '5', label: '5 mi' },
              { value: '15', label: '15 mi' },
              { value: '25', label: '25 mi' },
              { value: '50', label: '50 mi' },
              { value: 'any', label: 'Any' },
            ]}
          />
          <SegmentedControl
            accessibilityLabel="Match type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'single', label: 'Single' },
              { value: 'league', label: 'League' },
            ]}
          />
        </View>
      </Row>

      <Row label="Toggle">
        <Card>
          <Toggle
            value={openToJoin}
            onValueChange={setOpenToJoin}
            label="Open to join"
            description={
              openToJoin
                ? 'On: anyone can find and join from Leagues.'
                : 'Off: only people with the link can join.'
            }
          />
        </Card>
      </Row>

      <Row label="Avatars and seats">
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Avatar player={Ted} size={44} />
            <Avatar player={April} size={38} />
            <Avatar player={Mei} size={32} />
            <Avatar player={Jian} size={40} />
          </View>
          <InsetWell style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <AvatarStack players={[Mei, April, Jian]} seats={4} ring={colors.bg} openSeatStyle="join" onJoin={() => {}} />
            <Text style={[text.meta, { color: colors.inkMuted }]}>join style</Text>
          </InsetWell>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <AvatarStack players={[Ted]} seats={4} size={32} openSeatStyle="empty" />
            <Text style={[text.meta, { color: colors.inkMuted }]}>1 of 4</Text>
          </View>
        </Card>
      </Row>

      <Row label="Points bar">
        <Card gap={10}>
          <PointsBar fraction={1} />
          <PointsBar fraction={0.68} trackColor={colors.youRowTrack} />
          <PointsBar fraction={0.15} />
        </Card>
      </Row>

      <Row label="Wells and notes">
        <View style={{ gap: 10 }}>
          <InsetWell>
            <Text style={[text.caption, { color: colors.inkMuted }]}>
              An inset well, for the seat row and for notes inside a card.
            </Text>
          </InsetWell>
          <InfoNote
            rows={[
              {
                icon: 'shuffle',
                chipBg: pillTones.draw.bg,
                chipFg: pillTones.draw.fg,
                term: 'Reshuffle',
                body: 'deals everyone coming into tables of four and adds each table to their My Matches.',
              },
              {
                icon: 'users',
                chipBg: colors.white,
                chipFg: colors.ink,
                chipBorder: true,
                term: 'Ask subs',
                body: "lists this meetup's empty seats in Browse for players outside the league.",
              },
            ]}
          />
          <DashedCard>
            <View style={{ flex: 1 }}>
              <Text style={[text.bodyStrong, { color: colors.ink }]}>Nothing booked</Text>
              <Text style={[text.meta, { color: colors.inkMuted }]}>Grab a seat at a table near you.</Text>
            </View>
            <GradientButton size="sm" label="Find a table" onPress={() => {}} />
          </DashedCard>
        </View>
      </Row>

      <SectionHeader title="Composite cards" />

      <NeedsSubCard
        date={Tuesday}
        leagueColor={colors.lime}
        whenPill="Tomorrow"
        venue="The Beer Cellar"
        meta="Glen Ellyn · 6:30 pm"
        players={[Mei, April, Jian]}
        seats={4}
        tableLabel="Fall League · Table 1"
        onTakeSeat={() => {}}
      />

      <LeagueRowCard
        name="Fall League"
        status="Full"
        meta="16 members · Next Tue 6:30 pm"
        onPress={() => {}}
      />

      <MatchCard
        date={Thursday}
        edgeColor={colors.lime}
        leagueColor={colors.lime}
        pills={[{ label: "You played", tone: 'you' }]}
        venue="Geneva Public Library District"
        meta="Fox Valley Mahjsters · Table 1 · 7:00 pm"
        players={[April, Ted]}
        seats={4}
        countLabel="2 players"
        scoresState="missing"
        onScores={() => {}}
      />

      <MatchCard
        date={Thursday}
        edgeColor={colors.teal}
        pills={[
          { label: 'Hosting', tone: 'hosting' },
          { label: 'Tiles provided', tone: 'info' },
        ]}
        venue="Geneva"
        meta="Single match · Sep 10 · 7:00 pm"
        players={[Ted]}
        seats={4}
        countLabel="1 of 4"
        scoresState="entered"
        onScores={() => {}}
        onEdit={() => {}}
      />

      <MeetupCard
        number={2}
        date={Thursday}
        leagueColor={colors.lime}
        venue="Geneva Public Library District"
        meta="Sep 10 · 7:00 pm · 2 in"
        tablesLabel="1 table drawn"
        onToggleTables={() => {}}
        played={false}
        scoresEntered={false}
        tablesDrawn
        offeringSubs={askingSubs}
        onScores={() => {}}
        onDraw={() => {}}
        onToggleSubs={() => setAskingSubs((on) => !on)}
        onEdit={() => {}}
      />

      <MeetupCard
        number={1}
        date={new Date(2026, 8, 8, 19, 0)}
        leagueColor={colors.lime}
        venue="Geneva"
        meta="Sep 8 · 7:00 pm · 2 in"
        tablesLabel="1 table drawn · played"
        onToggleTables={() => {}}
        played
        scoresEntered
        tablesDrawn
        offeringSubs={false}
        onScores={() => {}}
        onDraw={() => {}}
        onToggleSubs={() => {}}
        onEdit={() => {}}
      />

      <NoOpenSeatsCard
        radiusLabel="15 mi"
        nextRadiusLabel="25 mi"
        onPropose={() => {}}
        onWiden={() => {}}
      />

      <YourStandingCard
        me={Ted}
        rank="2nd"
        points={15}
        detail="7 points behind April. 1 game, 0 wins so far."
      />

      <Card padding={8} gap={0}>
        <StandingRow
          rank={1}
          player={April}
          name="April Lane"
          isMe={false}
          points={22}
          leaderPoints={22}
          detail="1 game · 1 win"
        />
        <StandingRow
          rank={2}
          player={Ted}
          name="Ted Schuster"
          isMe
          points={15}
          leaderPoints={22}
          detail="1 game · 0 wins"
        />
      </Card>

      <Row label="Icons">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {IconNames.map((name) => (
              <View key={name} style={{ alignItems: 'center', gap: 4, width: 56 }}>
                <Icon name={name} size={24} color={colors.ink} />
                <Text style={{ fontFamily: fonts.regular, fontSize: 9, color: colors.inkMuted }} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      </Row>

      <Row label="Ribbon variants">
        <View style={{ gap: 10 }}>
          {/* Boxed, only so the hero and compact curves can be seen whole. On a real
              screen both are anchored off the top-right corner and half of each is
              off-screen, which is the intended look. */}
          <View
            style={{
              height: 200,
              borderRadius: radius.card,
              backgroundColor: colors.surface,
              overflow: 'hidden',
            }}>
            <View style={{ position: 'absolute', top: 0, right: 0, width: 300, height: 230 }}>
              <Ribbon variant="hero" style={{ top: 0, right: 0 }} />
            </View>
            <Text style={[text.caption, { color: colors.inkMuted, margin: 12 }]}>hero</Text>
          </View>
          <View
            style={{
              height: 200,
              borderRadius: radius.card,
              backgroundColor: colors.surface,
              overflow: 'hidden',
            }}>
            <View style={{ position: 'absolute', top: 0, right: 0, width: 300, height: 230 }}>
              <Ribbon variant="compact" style={{ top: 0, right: 0 }} />
            </View>
            <Text style={[text.caption, { color: colors.inkMuted, margin: 12 }]}>compact</Text>
          </View>
        </View>
      </Row>
    </ScreenScaffold>
  );
}
