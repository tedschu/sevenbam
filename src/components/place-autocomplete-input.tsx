import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { colors, radius, shadow } from '@/constants/design';
import { MinPlaceQuery, searchPlaces, type PlaceKind, type PlaceSuggestion } from '@/lib/places';

/** Long enough that typing a venue name is one lookup, not eight billable ones. */
const DebounceMs = 300;

/**
 * Tapping a suggestion blurs the field first, so the list has to outlive the
 * blur long enough for the press to land.
 */
const BlurCloseMs = 150;

/**
 * A text field that offers Google Places suggestions as you type, and stays a
 * plain text field if the lookup is unavailable. Anything typed is kept
 * verbatim — a member's living room is not in Places, and that has to remain a
 * valid answer.
 */
export function PlaceAutocompleteInput({
  label,
  value,
  onChangeText,
  onSelectPlace,
  placeholder,
  hint,
  kind,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /**
   * Fires only when a suggestion is picked, carrying Google's own split of the
   * place into a name and an address. Callers that want to keep the address
   * separately — a match's venue — use this; callers happy with one line can
   * ignore it and read `value`.
   */
  onSelectPlace?: (suggestion: PlaceSuggestion) => void;
  placeholder?: string;
  hint?: string;
  kind: PlaceKind;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Drops responses that a later keystroke has already superseded. */
  const requestRef = useRef(0);
  /**
   * What was last accepted from the list, so picking it does not immediately
   * re-query it. Held as the whole suggestion because the caller decides what
   * lands in the field — the full string, or just the name with the address
   * stored elsewhere — and either counts as unchanged.
   */
  const pickedRef = useRef<PlaceSuggestion | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = value.trim();
    const picked = pickedRef.current;
    const isUnchangedPick =
      picked !== null && (trimmed === picked.text || trimmed === picked.mainText);

    if (!isEditing || trimmed.length < MinPlaceQuery || isUnchangedPick) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      const request = ++requestRef.current;
      setIsSearching(true);

      try {
        const found = await searchPlaces(trimmed, kind);
        if (request !== requestRef.current) return;
        setSuggestions(found);
        setFailed(false);
      } catch {
        if (request !== requestRef.current) return;
        setSuggestions([]);
        setFailed(true);
      } finally {
        if (request === requestRef.current) setIsSearching(false);
      }
    }, DebounceMs);

    return () => clearTimeout(timer);
  }, [value, kind, isEditing]);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  const pick = (suggestion: PlaceSuggestion) => {
    pickedRef.current = suggestion;
    setSuggestions([]);

    // A caller that wants the two parts separately takes over entirely, because
    // only it knows which part belongs in this field. Everyone else gets the
    // joined string, which is what a single text field wants.
    if (onSelectPlace) {
      onSelectPlace(suggestion);
      return;
    }

    onChangeText(suggestion.text);
  };

  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>

      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            setIsEditing(true);
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setIsEditing(false), BlurCloseMs);
          }}
          style={styles.input}
        />
        {isSearching ? (
          <ActivityIndicator style={styles.spinner} size="small" color={colors.inkMuted} />
        ) : null}
      </View>

      {/* Rendered in the flow rather than floating over the form: an absolutely
          positioned menu is clipped by the scroll views these fields sit in on
          Android, and pushing the next field down is the lesser problem. */}
      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion.placeId}
              onPress={() => pick(suggestion)}
              style={({ pressed }) => [
                styles.suggestion,
                index > 0 && { borderTopWidth: 1, borderTopColor: colors.divider },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="defaultSemiBold" numberOfLines={1}>
                {suggestion.mainText}
              </ThemedText>
              {suggestion.secondaryText ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {suggestion.secondaryText}
                </ThemedText>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Required by the Google Maps Platform policies whenever Places results
          are shown outside a Google map. Outside the bordered list, so it does
          not read as a fourth suggestion. */}
      {suggestions.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.attribution}>
          Powered by Google
        </ThemedText>
      ) : null}

      {failed ? (
        <ThemedText type="small" themeColor="textSecondary">
          Suggestions are unavailable — type the {kind === 'city' ? 'town' : 'venue'} instead.
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 4,
  },
  inputRow: {
    justifyContent: 'center',
  },
  /** The same filled well as every other field on the redesign — see login.tsx. */
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radius.inset,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.track,
    fontSize: 16,
    color: colors.ink,
  },
  spinner: {
    position: 'absolute',
    right: 14,
  },
  suggestions: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadow.card,
  },
  suggestion: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  attribution: {
    paddingHorizontal: 14,
  },
  pressed: {
    opacity: 0.7,
  },
});
