/**
 * Chips — the "more filters" panel on Browse and the scope row on Leaderboard.
 *
 * One chip shape for both, per §5.5: white with a hairline when off, ink-filled
 * with white type when on. Distinct from `Pill`, which is a status label and
 * never pressable — and from the segmented control, which is for a single choice
 * out of a short fixed list. These are multi-select, or a scroll of leagues.
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { colors, fonts, type PillTone, pillTones, radius, text } from '@/constants/design';
import type { BrowseFilters } from '@/components/browse-filters';
import { DayIndexes, DayNames, TimesOfDay, type DayIndex, type TimeOfDay } from '@/lib/geo';

import { Card, LeagueDot } from './layout';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function FilterChip({
  label,
  selected,
  onPress,
  dotColor,
  compact = false,
  selectedTone,
  leading,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** A league's colour, on the Leaderboard scope chips. */
  dotColor?: string;
  /** Seven weekday chips have to fit a phone's width. */
  compact?: boolean;
  /**
   * Overrides the ink fill of a selected chip with a pill tone, for the one
   * place a chip carries meaning rather than just selection: answering a meetup,
   * where "Going" and "Can't make it" have to be told apart at a glance.
   */
  selectedTone?: PillTone;
  leading?: React.ReactNode;
}) {
  const tone = selectedTone ? pillTones[selectedTone] : null;
  const background = selected ? (tone?.bg ?? colors.ink) : colors.white;
  const foreground = selected ? (tone?.fg ?? colors.white) : colors.inkMuted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        {
          height: 40,
          minWidth: compact ? 46 : undefined,
          paddingHorizontal: compact ? 10 : 14,
          borderRadius: radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          backgroundColor: background,
          borderWidth: selected ? 0 : 1,
          borderColor: colors.track,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      {leading}
      {dotColor && selected ? <LeagueDot color={dotColor} /> : null}
      <Text
        style={{
          fontFamily: selected ? fonts.semibold : fonts.medium,
          fontSize: 13,
          lineHeight: 18,
          color: foreground,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[text.caption, { color: colors.inkMuted, letterSpacing: 0.6 }]}>
        {label.toUpperCase()}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

/**
 * Everything the distance control does not cover, behind Browse's sliders
 * button. The same filter state as before — this is the panel's presentation,
 * not its rules.
 */
export function ExtraFilters({
  filters,
  onChange,
}: {
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
}) {
  return (
    <Card gap={16}>
      <Group label="Day">
        {DayIndexes.map((day: DayIndex) => (
          <FilterChip
            key={day}
            label={DayNames[day]}
            compact
            selected={filters.days.includes(day)}
            onPress={() => onChange({ ...filters, days: toggle(filters.days, day) })}
          />
        ))}
      </Group>

      <Group label="Time of day">
        {TimesOfDay.map(({ key, label }: { key: TimeOfDay; label: string }) => (
          <FilterChip
            key={key}
            label={label}
            selected={filters.times.includes(key)}
            onPress={() => onChange({ ...filters, times: toggle(filters.times, key) })}
          />
        ))}
      </Group>

      <Group label="Only show">
        <FilterChip
          label="Open seats"
          selected={filters.openOnly}
          onPress={() => onChange({ ...filters, openOnly: !filters.openOnly })}
        />
        <FilterChip
          label="Tiles provided"
          selected={filters.suppliesOnly}
          onPress={() => onChange({ ...filters, suppliesOnly: !filters.suppliesOnly })}
        />
      </Group>
    </Card>
  );
}

/** Leaderboard's scope row: All matches, then one chip per league. */
export function ScopeChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; dotColor?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Negative margin and matching padding: the row scrolls edge to edge while
      // its first chip still lines up with the gutter above it.
      style={{ marginHorizontal: -20 }}
      contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
      {options.map((option) => (
        <FilterChip
          key={option.value}
          label={option.label}
          dotColor={option.dotColor}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}
