import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { LeagueDetail } from '@/components/league-detail';
import { initialsOf } from '@/components/match-card';
import { LeagueRowCard } from '@/components/kit/cards';
import { Button, GradientButton, Toggle } from '@/components/kit/controls';
import {
  Card,
  ScreenHeader,
  ScreenScaffold,
  SectionHeader,
  TitleBlock,
} from '@/components/kit/layout';
import { colors, radius, text } from '@/constants/design';
import { LeagueColorNames, LeagueColors, type LeagueColor } from '@/constants/theme';
import { useGlobalView } from '@/hooks/use-global-view';
import { useNeedsProfileSetup } from '@/hooks/use-profile-setup';
import { createLeague, fetchMyLeagues, type MyLeague } from '@/lib/leagues';
import { fetchMyBearings } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

const AppMark = require('@/assets/images/app-mark.png');

/**
 * Creating a league: what it is called, what colour it is, and whether anyone can
 * find it.
 */
function NewLeagueForm({
  onCreate,
  onCancel,
  busy,
}: {
  onCreate: (
    name: string,
    color: LeagueColor,
    visibility: { is_public: boolean; max_members: number | null }
  ) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<LeagueColor>('blue');
  // Private by default. Making a group of people discoverable is a choice someone
  // should make on purpose, not one they get by leaving a switch alone.
  const [isPublic, setIsPublic] = useState(false);
  const [maxMembers, setMaxMembers] = useState('');

  const field = {
    ...text.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.track,
    borderRadius: radius.inset,
    paddingHorizontal: 14,
    height: 48,
  } as const;
  const label = [text.caption, { color: colors.inkMuted, letterSpacing: 0.6 }];

  return (
    <Card gap={16}>
      <View style={{ gap: 6 }}>
        <Text style={label}>LEAGUE NAME</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Fox Valley League"
          placeholderTextColor={colors.placeholder}
          style={field}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={label}>COLOUR</Text>
        {/* The colour is the league's identity everywhere else — its dot in a meta
            line, the edge under every one of its date tiles — so it is picked as
            the colour itself rather than from a list of names. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {LeagueColorNames.map((option) => (
            <Pressable
              key={option}
              onPress={() => setColor(option)}
              accessibilityRole="button"
              accessibilityLabel={option}
              accessibilityState={{ selected: color === option }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: LeagueColors[option],
                  borderWidth: color === option ? 3 : 0,
                  borderColor: colors.ink,
                }}
              />
            </Pressable>
          ))}
        </View>
      </View>

      <Toggle
        value={isPublic}
        onValueChange={setIsPublic}
        label="Open to join"
        description={
          isPublic
            ? 'Anyone signed in can find this league in Browse and join it.'
            : 'Invite-only. Only people you send the link to can join.'
        }
      />

      {/* Only relevant once the league is discoverable — a private league's size
          is governed by who you send the link to. */}
      {isPublic ? (
        <View style={{ gap: 6 }}>
          <Text style={label}>MEMBER LIMIT</Text>
          <TextInput
            value={maxMembers}
            onChangeText={(next) => setMaxMembers(next.replace(/[^0-9]/g, ''))}
            placeholder="No limit"
            keyboardType="number-pad"
            placeholderTextColor={colors.placeholder}
            style={field}
          />
          <Text style={[text.caption, { color: colors.inkMuted }]}>
            Browse stops offering the league once it is full. Leave blank for no limit.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button variant="soft" size="md" label="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <GradientButton
          size="md"
          label="Create league"
          busy={busy}
          disabled={name.trim().length === 0}
          onPress={() =>
            onCreate(name, color, {
              is_public: isPublic,
              // Blank means no cap. Parsed here rather than stored as a number so
              // the field can be genuinely empty rather than showing a 0.
              max_members: isPublic && maxMembers ? Number(maxMembers) : null,
            })
          }
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

/**
 * One league in the list. An archived one is dimmed rather than hidden — the
 * standings are still worth reading — and says so, since "You organize this" on
 * its own would suggest there is still something to organize.
 */
function LeagueRow({ league, onPress }: { league: MyLeague; onPress: () => void }) {
  const isArchived = league.archived_at !== null;

  return (
    <LeagueRowCard
      name={league.name}
      muted={isArchived}
      /* A viewer is an admin in global view looking at a league they are not in.
         Said plainly, because a list that mixes leagues you belong to with
         leagues you are only reading has to tell them apart. */
      status={
        league.role === 'organizer'
          ? 'You organize this'
          : league.role === 'viewer'
            ? 'Not a member — viewing'
            : 'Member'
      }
      meta={isArchived ? 'Archived · standings still count' : 'Seasons, meetups and standings'}
      onPress={onPress}
    />
  );
}

export default function LeaguesScreen() {
  const globalView = useGlobalView();
  const needsSetup = useNeedsProfileSetup();
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [me, setMe] = useState<{ name: string | null; avatarUrl: string | null }>({
    name: null,
    avatarUrl: null,
  });
  const [userId, setUserId] = useState<string | null>(null);
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('You are signed out.');
        return;
      }

      setUserId(user.id);
      setMe(await fetchMyBearings(user.id));
      setLeagues(await fetchMyLeagues(user.id, globalView));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your leagues.');
    }
  }, [globalView]);

  // Refetch on focus, so a league joined from an invite link on another screen
  // is here when you come back.
  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        await load();
        if (active) setIsLoading(false);
      })();

      return () => {
        active = false;
      };
    }, [load])
  );

  const create = async (
    name: string,
    color: LeagueColor,
    visibility: { is_public: boolean; max_members: number | null }
  ) => {
    if (!userId) return;

    setBusy(true);
    try {
      const id = await createLeague(userId, name, color, visibility);
      await load();
      setIsCreating(false);
      // Straight into the new league, because the next thing anyone wants is the
      // invite link.
      setOpenLeagueId(id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create that league.');
    } finally {
      setBusy(false);
    }
  };

  const openLeague = leagues.find((league) => league.id === openLeagueId) ?? null;

  // Archived leagues stay reachable — their standings are still worth reading —
  // but they go below the live ones under a heading, rather than sitting in the
  // list looking like something you could still turn up to.
  const live = leagues.filter((league) => league.archived_at === null);
  const archived = leagues.filter((league) => league.archived_at !== null);

  if (openLeague && userId) {
    return (
      <LeagueDetail
        league={openLeague}
        userId={userId}
        onBack={() => setOpenLeagueId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <ScreenScaffold ribbon="compact">
      <ScreenHeader
        logo={AppMark}
        initials={initialsOf(me.name)}
        photoUrl={me.avatarUrl}
        badge={needsSetup}
        onProfilePress={() => router.push('/profile')}
      />

      <TitleBlock
        eyebrow={
          leagues.length === 0
            ? 'Not in a league'
            : `${leagues.length} ${leagues.length === 1 ? 'league' : 'leagues'}`
        }
        title="Leagues"
        subtitle="Seasons, meetups, and standings of their own"
      />

      {error ? <Text style={[text.meta, { color: colors.danger }]}>{error}</Text> : null}

      {isLoading ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}

      {live.map((league) => (
        <LeagueRow key={league.id} league={league} onPress={() => setOpenLeagueId(league.id)} />
      ))}

      {archived.length > 0 ? (
        <>
          <SectionHeader title="Archived" />
          {archived.map((league) => (
            <LeagueRow key={league.id} league={league} onPress={() => setOpenLeagueId(league.id)} />
          ))}
        </>
      ) : null}

      {isCreating ? (
        <NewLeagueForm onCreate={create} onCancel={() => setIsCreating(false)} busy={busy} />
      ) : (
        <GradientButton icon="plus" label="New league" onPress={() => setIsCreating(true)} />
      )}

      {!isLoading && leagues.length === 0 && !isCreating ? (
        <Text style={[text.meta, { color: colors.inkMuted, textAlign: 'center' }]}>
          Start one and share its link, or open a link somebody sent you.
        </Text>
      ) : null}
    </ScreenScaffold>
  );
}
