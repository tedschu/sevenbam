/**
 * Distance between two points, and the vocabulary Browse filters on.
 *
 * Computed on the device rather than in the database. A group's list of upcoming
 * matches is tens of rows, so filtering them in JavaScript costs nothing and
 * avoids adding PostGIS, a geography column, and an index to a schema that would
 * otherwise never need them. Revisit if the list ever runs to thousands.
 */

import * as Location from 'expo-location';

export type Coordinates = { latitude: number; longitude: number };

/** Mean radius. Good to a fraction of a percent at the distances this filters on. */
const EarthRadiusMiles = 3958.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in miles.
 *
 * Haversine rather than a flat approximation — not because the error matters at
 * 15 miles, where it does not, but because the flat version needs a cosine
 * correction that is easy to get subtly wrong and impossible to notice.
 */
export function milesBetween(from: Coordinates, to: Coordinates) {
  const dLatitude = toRadians(to.latitude - from.latitude);
  const dLongitude = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLongitude / 2) ** 2;

  return 2 * EarthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Reads a pair of nullable columns as a point, or nothing. */
export function coordinatesOf(row: {
  latitude?: number | null;
  longitude?: number | null;
}): Coordinates | null {
  if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return null;
  return { latitude: row.latitude, longitude: row.longitude };
}

/**
 * Where the member is standing, for measuring distance from instead of their
 * saved town.
 *
 * A town is the right default — it is stable, it needs no permission, and it is
 * where most people are looking for a game from. It is also wrong precisely when
 * somebody is most likely to be searching: away for the weekend, at the office,
 * new in a place they have not set a town for yet. So this is offered beside it
 * rather than in place of it.
 *
 * Returns null on refusal rather than throwing, because a declined permission
 * prompt is an answer, not a fault: the caller quietly stays on the saved town.
 * A genuine failure — location services off at the OS level, a fix that never
 * arrives — throws, since that one is worth a sentence on screen.
 */
export async function fetchDeviceLocation(): Promise<Coordinates | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;

  // `Balanced` rather than `High`: the nearest hundred metres is far finer than
  // a filter whose smallest step is five miles can use, and asking for better
  // costs a GPS fix and the seconds that go with it.
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

/**
 * How near counts as near. `null` is "any distance" and is a real choice, not an
 * absence — someone willing to drive should be able to say so.
 */
export const DistanceOptions = [5, 15, 25, 50, null] as const;

export type DistanceMiles = (typeof DistanceOptions)[number];

/**
 * Fifteen miles, which for the group this is built for covers the neighbouring
 * towns without reaching the far side of the metro.
 */
export const DefaultDistance: DistanceMiles = 15;

export function formatMiles(miles: number) {
  // Under a mile, a rounded figure would read as "0 mi away" for the venue up
  // the road.
  if (miles < 0.95) return 'nearby';
  return `${Math.round(miles)} mi away`;
}

export const DayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Indexes match `Date.getDay()`, so a day filter is a direct lookup. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DayIndexes: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export const TimesOfDay: { key: TimeOfDay; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

/**
 * Which part of the day a match starts in, by the *device's* clock rather than
 * UTC — "evening" has to mean evening where the player is.
 */
export function timeOfDayOf(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
