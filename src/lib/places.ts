import { supabase } from './supabase';

/**
 * Venue and town lookup, served by the `places-autocomplete` edge function
 * rather than by Google directly: the Maps key is billed per request and would
 * be readable in the web bundle if the app called Places itself.
 */
export type PlaceSuggestion = {
  placeId: string;
  /** The full string to drop into the field when this row is picked. */
  text: string;
  /** Google's split of that string, for a two-line suggestion row. */
  mainText: string;
  secondaryText: string | null;
};

/**
 * `venue` suggests anything you could play at — a business, a hall, a street
 * address. `city` suggests towns only, which is what a profile wants.
 */
export type PlaceKind = 'venue' | 'city';

/** Matches the proxy's floor. Shorter queries are noise and still cost money. */
export const MinPlaceQuery = 3;

/**
 * Set when the proxy reports it has no Google key configured. Autocomplete is
 * an enhancement on top of a working text field, so a project without a key
 * should quietly stop asking rather than surface an error on every keystroke.
 */
let missingKey = false;

export function isPlaceSearchConfigured() {
  return !missingKey;
}

export async function searchPlaces(input: string, kind: PlaceKind): Promise<PlaceSuggestion[]> {
  const trimmed = input.trim();
  if (missingKey || trimmed.length < MinPlaceQuery) return [];

  const { data, error } = await supabase.functions.invoke<{ suggestions: PlaceSuggestion[] }>(
    'places-autocomplete',
    { body: { input: trimmed, kind } }
  );

  if (error) {
    // supabase-js wraps a non-2xx response, putting the status on `context`.
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 501) {
      missingKey = true;
      return [];
    }
    throw error;
  }

  return data?.suggestions ?? [];
}

/**
 * Where a picked place is, and what clock it runs on.
 *
 * The zone matters for one thing only: email. Every screen in the app renders a
 * time in the reader's own device zone, which is right and costs nothing — but a
 * notification is composed by a function running in UTC, with no reader's device
 * to ask, so without the venue's zone a 7pm game goes out as "12:00 AM UTC".
 *
 * Both halves are optional and come apart independently. A place can have a
 * position and no zone; a venue typed by hand rather than picked has neither.
 * Coordinates only power the distance filter on Browse, and the zone only changes
 * how an email reads — neither is worth blocking somebody from proposing a game
 * over, so every failure returns nulls rather than throwing.
 */
export type PlaceDetails = {
  latitude: number;
  longitude: number;
} | null;

export async function fetchPlaceDetails(
  placeId: string
): Promise<{ location: PlaceDetails; timeZone: string | null }> {
  const nothing = { location: null, timeZone: null };
  if (missingKey || !placeId) return nothing;

  try {
    const { data, error } = await supabase.functions.invoke<{
      location: { latitude: number; longitude: number } | null;
      timeZone: string | null;
    }>('places-autocomplete', { body: { placeId } });

    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 501) missingKey = true;
      return nothing;
    }

    return { location: data?.location ?? null, timeZone: data?.timeZone ?? null };
  } catch {
    return nothing;
  }
}
