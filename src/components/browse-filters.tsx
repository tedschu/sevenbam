import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  DayIndexes,
  DayNames,
  DistanceOptions,
  TimesOfDay,
  type DayIndex,
  type DistanceMiles,
  type TimeOfDay,
} from '@/lib/geo';

/**
 * Whether a match counts toward a league or is a one-off. Both on by default —
 * a filter nobody set should not be hiding anything.
 */
export type MatchKinds = { single: boolean; league: boolean };

export const AllKinds: MatchKinds = { single: true, league: true };

/**
 * Both off is treated as both on rather than as an empty list. Turning off the
 * last one would otherwise blank the screen with no way to tell why, and nobody
 * means "show me nothing".
 */
export function keepKind(leagueId: string | null, kinds: MatchKinds) {
  if (kinds.single === kinds.league) return true;
  return leagueId === null ? kinds.single : kinds.league;
}

/** The pair of chips, for any screen that lists matches of both kinds. */
export function MatchKindChips({
  kinds,
  onChange,
}: {
  kinds: MatchKinds;
  onChange: (next: MatchKinds) => void;
}) {
  return (
    <View style={styles.chipRow}>
      <Chip
        label="Single matches"
        selected={kinds.single}
        onPress={() => onChange({ ...kinds, single: !kinds.single })}
      />
      <Chip
        label="League matches"
        selected={kinds.league}
        onPress={() => onChange({ ...kinds, league: !kinds.league })}
      />
    </View>
  );
}

export type BrowseFilters = {
  /** null is "any distance", a deliberate choice rather than an unset value. */
  distance: DistanceMiles;
  /** Empty means every day. Indexes match `Date.getDay()`. */
  days: DayIndex[];
  /** Empty means any time. */
  times: TimeOfDay[];
  openOnly: boolean;
  suppliesOnly: boolean;
};

/**
 * Distance starts at 15 miles because that is the useful default for a group
 * that plays around one town. Everything else starts unset: a filter nobody
 * asked for should not be hiding matches on first visit.
 */
export function defaultFilters(distance: DistanceMiles): BrowseFilters {
  return { distance, days: [], times: [], openOnly: false, suppliesOnly: false };
}

/** For the count on the disclosure, so a collapsed panel cannot hide filtering. */
export function activeExtraCount(filters: BrowseFilters) {
  return (
    filters.days.length +
    filters.times.length +
    (filters.openOnly ? 1 : 0) +
    (filters.suppliesOnly ? 1 : 0)
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** One chip. Filled with the highlight and outlined in teal when it is on. */
function Chip({
  label,
  selected,
  onPress,
  compact,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Day chips are three letters and sit seven to a row. */
  compact?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.compactChip,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.background,
          // Outlined as well as filled, so the chosen chip still reads as chosen
          // in dark mode where the highlight is a muted warm brown.
          borderColor: selected ? theme.accent : theme.rule,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="label" themeColor={selected ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

/**
 * Where distance is measured from, and how the member changes it.
 *
 * Bundled into one prop rather than six loose ones because they are only ever
 * meaningful together: "busy" is about the fetch that "onUseDevice" starts, and
 * "usingDevice" is what both of the callbacks toggle between.
 */
export type DistanceOrigin = {
  /** A saved town, which supplies an origin without asking anyone's permission. */
  hasHome: boolean;
  /** Measuring from the device right now rather than from that town. */
  usingDevice: boolean;
  /** A fix is on its way. Worth showing: a cold GPS can take several seconds. */
  busy: boolean;
  /** Services off, or a fix that never arrived. A plain refusal is not an error. */
  error: string | null;
  onUseDevice: () => void;
  onUseHome: () => void;
};

/**
 * Browse's filters: how far, which days, what time of day, and the two flags
 * that were already here.
 *
 * Distance leads and is always visible, because it is the one that is on by
 * default — a filter that hides matches has to be the first thing you see. The
 * rest sit behind a disclosure that carries a count, so a collapsed panel can
 * never be quietly filtering the list.
 */
export function BrowseFilterBar({
  filters,
  onChange,
  expanded,
  onToggleExpanded,
  origin,
}: {
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  origin: DistanceOrigin;
}) {
  const theme = useTheme();
  const extras = activeExtraCount(filters);

  /**
   * Whether anything can be measured. A device fix counts as much as a saved
   * town, which is the point of offering it: somebody who has never set a town
   * gets the distance chips the moment they say where they are.
   */
  const hasOrigin = origin.hasHome || origin.usingDevice;

  return (
    <View style={styles.container}>
      <View style={styles.group}>
        <View style={styles.headerRow}>
          {hasOrigin ? (
            <ThemedText type="label" themeColor="textSecondary">
              Within
            </ThemedText>
          ) : (
            // Rather than showing a distance filter that silently does nothing.
            // Both ways out are named, because the button below is the one that
            // works without leaving the screen.
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              Set your town on Profile, or use your location, to filter by distance.
            </ThemedText>
          )}
          <Pressable
            onPress={onToggleExpanded}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="label" style={{ color: theme.accentInk }}>
              {expanded ? 'Fewer filters' : extras > 0 ? `Filters · ${extras}` : 'More filters'}
            </ThemedText>
          </Pressable>
        </View>

        {hasOrigin ? (
          <View style={styles.chipRow}>
            {DistanceOptions.map((miles) => (
              <Chip
                key={miles ?? 'any'}
                label={miles === null ? 'Any' : `${miles} mi`}
                selected={filters.distance === miles}
                onPress={() => onChange({ ...filters, distance: miles })}
              />
            ))}
          </View>
        ) : null}

        {/* What the distances are measured from, under the chips they govern.

            Quiet text rather than a pair of chips: this is answered once and then
            wants to stay out of the way, unlike the distances above it, which are
            the thing being adjusted. */}
        <View style={styles.originRow}>
          {origin.busy ? (
            <>
              <ActivityIndicator size="small" />
              <ThemedText type="small" themeColor="textSecondary">
                Finding you…
              </ThemedText>
            </>
          ) : origin.usingDevice ? (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
                Measured from where you are now.
              </ThemedText>
              {/* Only when there is a town to go back to. Otherwise this would
                  offer to switch to nothing. */}
              {origin.hasHome ? (
                <Pressable
                  onPress={origin.onUseHome}
                  accessibilityRole="button"
                  accessibilityLabel="Measure distance from your saved town instead"
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="label" style={{ color: theme.accentInk }}>
                    Use my town
                  </ThemedText>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable
              onPress={origin.onUseDevice}
              accessibilityRole="button"
              accessibilityLabel="Measure distance from where you are now"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="label" style={{ color: theme.accentInk }}>
                Use my location
              </ThemedText>
            </Pressable>
          )}
        </View>

        {origin.error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {origin.error}
          </ThemedText>
        ) : null}
      </View>

      {expanded ? (
        <>
          <Group label="Day">
            {DayIndexes.map((day) => (
              <Chip
                key={day}
                label={DayNames[day]}
                compact
                selected={filters.days.includes(day)}
                onPress={() => onChange({ ...filters, days: toggle(filters.days, day) })}
              />
            ))}
          </Group>

          <Group label="Time of day">
            {TimesOfDay.map(({ key, label }) => (
              <Chip
                key={key}
                label={label}
                selected={filters.times.includes(key)}
                onPress={() => onChange({ ...filters, times: toggle(filters.times, key) })}
              />
            ))}
          </Group>

          <Group label="Only show">
            <Chip
              label="Open seats"
              selected={filters.openOnly}
              onPress={() => onChange({ ...filters, openOnly: !filters.openOnly })}
            />
            <Chip
              label="Tiles provided"
              selected={filters.suppliesOnly}
              onPress={() => onChange({ ...filters, suppliesOnly: !filters.suppliesOnly })}
            />
          </Group>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  note: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  /**
   * One line under the chips, holding either a sentence and a way back or a
   * single link. Centred so the spinner sits on the text's line rather than
   * above it.
   */
  originRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 24,
  },
  chip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  /** Seven of these have to fit a phone's width. */
  compactChip: {
    paddingHorizontal: Spacing.two,
    minWidth: 44,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
