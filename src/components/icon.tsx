import { Image } from 'expo-image';

/**
 * A small stroke-drawn icon set, kept in one place so the navigation and the card
 * controls stay visually consistent.
 *
 * The colour is substituted into the SVG source rather than applied with
 * `tintColor`. Tinting relies on the renderer supporting a mask over a vector,
 * which varies by platform; baking the stroke colour in cannot fail anywhere
 * that can draw an SVG at all. It also means no bitmap variants per state.
 *
 * All paths are drawn on a 24×24 grid so weights match when they sit together.
 */
const Paths: Record<string, string> = {
  /** Browse — looking for a table. */
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.6 16.6 21 21"/>',
  /** My Matches — what is on the calendar. */
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  /** Leaderboard — a podium, rather than a trophy that only one person gets. */
  standings: '<path d="M5 21v-5M12 21V6M19 21v-9"/>',
  /** Profile. */
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.2 8-6.2s8 2.2 8 6.2"/>',
  /** Add to calendar — the same calendar, plus something. */
  calendarPlus:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18M12 14.5v4M10 16.5h4"/>',
  /** Already sent to a calendar. */
  calendarCheck:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18M9 15.5l2.2 2.2 4-4"/>',
  /** Edit. */
  pencil: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="m14.5 5.5 4 4"/>',
  /** Enter scores — a scorecard's ruled columns. */
  scorecard: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>',
  /** Leagues — a group of people rather than one. */
  people:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.4 2.9-5.3 6.5-5.3s6.5 1.9 6.5 5.3"/><path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M18 14.2c2.1.6 3.5 2.1 3.5 4.3"/>',
  /** Draw the tables — two paths crossing over, the usual shuffle mark. */
  shuffle:
    '<path d="M3 7h3.5l3 4M21 7h-3.5l-8 10H3M21 17h-3.5"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>',
  /** Remove. */
  trash:
    '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5A1.5 1.5 0 0 0 8.8 21h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>',
  /** Dismiss a sheet. Doubles as "not coming" beside `check`. */
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  /** Coming. Paired with `close` on the availability control. */
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  /** A venue on a map — the marker teardrop, for the directions link. */
  pin: '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  /** Write to the people who joined — an envelope. */
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  /** Put a league away without erasing it — a lidded box. */
  archive:
    '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 13h4"/>',
  /** Points down when a section is closed; rotated 180° when it is open. */
  chevronDown: '<path d="M6 9.5 12 15.5 18 9.5"/>',
  /** One more of whatever is above it — a table, in the seating editor. */
  plus: '<path d="M12 5v14M5 12h14"/>',
};

export type IconName = keyof typeof Paths;

function source(name: IconName, color: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${Paths[name]}</svg>`;

  return { uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

export function Icon({
  name,
  color,
  size = 20,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  return (
    <Image
      source={source(name, color)}
      style={{ width: size, height: size }}
      contentFit="contain"
      // Icons here always sit beside a label or carry one on the pressable, so
      // announcing them again would just repeat it.
      accessible={false}
    />
  );
}
