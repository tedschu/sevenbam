/**
 * A month grid for Browse's calendar view — an alternative to the card list,
 * for someone who thinks in "what's on this week" rather than "what's near
 * me right now". Tapping a day shows that day's matches below the grid, in
 * the same `MatchCard`s the list view uses, so a tap into one opens the same
 * detail sheet either way.
 */

import { Pressable, Text, View } from 'react-native';

import { colors, fonts, radius, text } from '@/constants/design';

import { IconButton } from './controls';
import { Card } from './layout';

export type CalendarDot = { color: string };

const WeekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The grid's own key for a cell — device-local, since a calendar grid is
 * inherently "today, from where you're sitting". Matches are bucketed onto
 * it by their own time zone (see `matchDayKey`), which can disagree with the
 * device by a day for a match far from the device's zone — an edge case
 * worth naming rather than solving; the grid still has to show *a* day for
 * every cell, and device-local is what the cell itself already is.
 */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function MonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelectDate,
  dotsByDay,
}: {
  /** Any date within the month to display. */
  month: Date;
  onMonthChange: (next: Date) => void;
  selected: Date | null;
  onSelectDate: (day: Date) => void;
  /** Keyed by `dayKey`. */
  dotsByDay: Record<string, CalendarDot[]>;
}) {
  const first = startOfMonth(month);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Card gap={14}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton
          icon="chevronLeft"
          accessibilityLabel="Previous month"
          onPress={() => onMonthChange(addMonths(month, -1))}
        />
        <Text style={[text.cardTitle, { color: colors.ink }]}>
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <IconButton
          icon="chevronRight"
          accessibilityLabel="Next month"
          onPress={() => onMonthChange(addMonths(month, 1))}
        />
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WeekdayLabels.map((label, index) => (
          <View key={index} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[text.caption, { color: colors.inkMuted }]}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((date, index) => {
          if (!date) return <View key={index} style={{ width: `${100 / 7}%`, height: 56 }} />;

          const dots = dotsByDay[dayKey(date)] ?? [];
          const hasEvents = dots.length > 0;
          const isSelected = Boolean(selected && sameDay(date, selected));
          const isToday = sameDay(date, today);

          return (
            <Pressable
              key={index}
              onPress={() => onSelectDate(date)}
              accessibilityRole="button"
              accessibilityLabel={
                date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
                (hasEvents ? `, ${dots.length} ${dots.length === 1 ? 'game' : 'games'}` : '')
              }
              accessibilityState={{ selected: isSelected }}
              style={{ width: `${100 / 7}%`, height: 56, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isSelected ? colors.ink : 'transparent',
                  borderWidth: isToday && !isSelected ? 1.5 : 0,
                  borderColor: colors.link,
                }}>
                {/*
                  A dot alone reads as Apple's and Google's own calendars do,
                  but a single 5px mark is easy to miss before you've learned
                  to look for it. A day with something on it also gets a
                  bolder, teal-ink number — a second, higher-contrast cue that
                  doesn't depend on noticing the smallest thing on the screen.
                */}
                <Text
                  style={[
                    text.body,
                    {
                      fontFamily: hasEvents && !isSelected ? fonts.semibold : fonts.regular,
                      color: isSelected ? colors.white : hasEvents ? colors.link : colors.ink,
                    },
                  ]}>
                  {date.getDate()}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
                {dots.slice(0, 3).map((dot, dotIndex) => (
                  <View
                    key={dotIndex}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: radius.pill,
                      backgroundColor: isSelected ? colors.white : dot.color,
                    }}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
