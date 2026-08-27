import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GradientButton } from '@/components/button';
import { LeagueDetail } from '@/components/league-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  CardShadow,
  LeagueColorNames,
  LeagueColors,
  MaxContentWidth,
  OnAccent,
  Radius,
  Spacing,
  type LeagueColor,
} from '@/constants/theme';
import { useGlobalView } from '@/hooks/use-global-view';
import { useTheme } from '@/hooks/use-theme';
import { createLeague, fetchMyLeagues, type MyLeague } from '@/lib/leagues';
import { supabase } from '@/lib/supabase';

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
  const theme = useTheme();
  const [name, setName] = useState('');
  const [color, setColor] = useState<LeagueColor>('blue');
  // Private by default. Making a group of people discoverable is a choice someone
  // should make on purpose, not one they get by leaving a switch alone.
  const [isPublic, setIsPublic] = useState(false);
  const [maxMembers, setMaxMembers] = useState('');

  return (
    <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
      <ThemedText type="label" themeColor="textSecondary">
        League name
      </ThemedText>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Fox Valley League"
        placeholderTextColor={theme.placeholder}
        style={[styles.input, { color: theme.text, borderColor: theme.rule }]}
      />

      <ThemedText type="label" themeColor="textSecondary">
        Colour
      </ThemedText>
      <View style={styles.swatches}>
        {LeagueColorNames.map((option) => (
          <Pressable
            key={option}
            onPress={() => setColor(option)}
            accessibilityRole="button"
            accessibilityLabel={option}
            style={({ pressed }) => pressed && styles.pressed}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: LeagueColors[option] },
                color === option && { borderColor: theme.text, borderWidth: 3 },
              ]}
            />
          </Pressable>
        ))}
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <ThemedText type="label" themeColor="textSecondary">
            Open to join
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isPublic
              ? 'Anyone signed in can find this league in Browse and join it.'
              : 'Invite-only. Only people you send the link to can join.'}
          </ThemedText>
        </View>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          trackColor={{ true: theme.accent, false: theme.rule }}
        />
      </View>

      {/* Only relevant once the league is discoverable — a private league's size
          is governed by who you send the link to. */}
      {isPublic ? (
        <View style={styles.field}>
          <ThemedText type="label" themeColor="textSecondary">
            Member limit
          </ThemedText>
          <TextInput
            value={maxMembers}
            onChangeText={(next) => setMaxMembers(next.replace(/[^0-9]/g, ''))}
            placeholder="No limit"
            keyboardType="number-pad"
            placeholderTextColor={theme.placeholder}
            style={[styles.input, { color: theme.text, borderColor: theme.rule }]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Browse stops offering the league once it is full. Leave blank for no
            limit.
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.formActions}>
        <Pressable onPress={onCancel} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={styles.secondaryButton}>
            <ThemedText type="label" themeColor="textSecondary">
              Cancel
            </ThemedText>
          </ThemedView>
        </Pressable>
        <Pressable
          onPress={() =>
            onCreate(name, color, {
              is_public: isPublic,
              // Blank means no cap. Parsed here rather than stored as a number so
              // the field can be genuinely empty rather than showing a 0.
              max_members: isPublic && maxMembers ? Number(maxMembers) : null,
            })
          }
          disabled={busy || name.trim().length === 0}
          style={({ pressed }) => pressed && styles.pressed}>
          <View
            style={[
              styles.primaryButton,
              { backgroundColor: LeagueColors[color] },
              (busy || name.trim().length === 0) && styles.disabled,
            ]}>
            <ThemedText type="label" style={styles.primaryLabel}>
              {busy ? 'Creating…' : 'Create league'}
            </ThemedText>
          </View>
        </Pressable>
      </View>
    </ThemedView>
  );
}

/**
 * One league in the list. An archived one is dimmed rather than hidden — the
 * standings are still worth reading — and says so, since "You organize this" on
 * its own would suggest there is still something to organize.
 */
function LeagueRow({ league, onPress }: { league: MyLeague; onPress: () => void }) {
  const theme = useTheme();
  const tint = LeagueColors[league.color] ?? theme.accent;
  const isArchived = league.archived_at !== null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type="background"
        style={[styles.leagueCard, { borderLeftColor: tint }, isArchived && styles.muted]}>
        <ThemedText type="subtitle" numberOfLines={1}>
          {league.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {isArchived ? 'Archived · ' : ''}
          {/* A viewer is an admin in global view looking at a league they are not
              in. Said plainly, because a list that mixes leagues you belong to
              with leagues you are only reading has to tell them apart. */}
          {league.role === 'organizer'
            ? 'You organize this'
            : league.role === 'viewer'
              ? 'Not a member — viewing'
              : 'Member'}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export default function LeaguesScreen() {
  const globalView = useGlobalView();
  const theme = useTheme();
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
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
      <ThemedView type="backgroundElement" style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <LeagueDetail
            league={openLeague}
            userId={userId}
            onBack={() => setOpenLeagueId(null)}
            onChanged={load}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="label" themeColor="accentAltInk">
              {leagues.length === 0
                ? 'Not in a league'
                : `${leagues.length} ${leagues.length === 1 ? 'league' : 'leagues'}`}
            </ThemedText>
            <ThemedText type="title">Leagues</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              Seasons, meetups, and standings of their own
            </ThemedText>
          </View>

          {error ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}

          {isLoading ? <ActivityIndicator style={styles.centered} /> : null}

          {live.map((league) => (
            <LeagueRow
              key={league.id}
              league={league}
              onPress={() => setOpenLeagueId(league.id)}
            />
          ))}

          {archived.length > 0 ? (
            <>
              <ThemedText type="label" themeColor="textSecondary" style={styles.groupHeader}>
                Archived
              </ThemedText>
              {archived.map((league) => (
                <LeagueRow
                  key={league.id}
                  league={league}
                  onPress={() => setOpenLeagueId(league.id)}
                />
              ))}
            </>
          ) : null}

          {isCreating ? (
            <NewLeagueForm
              onCreate={create}
              onCancel={() => setIsCreating(false)}
              busy={busy}
            />
          ) : (
            <GradientButton label="New league" onPress={() => setIsCreating(true)} wide />
          )}

          {!isLoading && leagues.length === 0 && !isCreating ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Start one and share its link, or open a link somebody sent you.
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  header: {
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  subtitle: {
    marginTop: 2,
  },
  leagueCard: {
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderLeftWidth: 4,
    boxShadow: CardShadow,
  },
  /** The same step back a played or cancelled match card takes. */
  muted: {
    opacity: 0.62,
  },
  groupHeader: {
    marginTop: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    boxShadow: CardShadow,
  },
  input: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },
  swatches: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 0,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  toggleText: {
    flex: 1,
    gap: Spacing.half,
  },
  field: {
    gap: Spacing.one,
  },
  primaryButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  wide: {
    borderRadius: Radius.pill,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  primaryLabel: {
    color: OnAccent,
  },
  disabled: {
    opacity: 0.5,
  },
  centered: {
    marginTop: Spacing.three,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
