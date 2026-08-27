import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Radius, Spacing } from '@/constants/theme';
import { useCompact } from '@/hooks/use-compact';
import { setGlobalView, useGlobalView, useIsAdmin } from '@/hooks/use-global-view';
import { useTheme } from '@/hooks/use-theme';

/**
 * Two shapes of the same switch, because it has to be reachable from two places
 * that afford completely different amounts of room.
 *
 * The chip belongs on the wide tab bar, where an admin doing a round of checks
 * wants to flip back and forth without leaving the screen they are checking. The
 * row belongs on Profile, which is the only surface a phone has for it — the
 * narrow layout puts navigation in a bottom bar and has no top-right corner to
 * put a chip in. Neither is the "real" one; an admin on a laptop will use the
 * chip and an admin on a phone will use the row, and both drive the same store.
 *
 * Both draw nothing at all for a non-admin, so this can be rendered
 * unconditionally by whatever contains it.
 */

/** The bar's version: outlined, quiet, and wordless where the tabs need the room. */
export function GlobalViewChip() {
  const theme = useTheme();
  const compact = useCompact();
  const isAdmin = useIsAdmin();
  const globalView = useGlobalView();

  if (!isAdmin) return null;

  return (
    <Pressable
      onPress={() => setGlobalView(!globalView)}
      accessibilityRole="switch"
      accessibilityState={{ checked: globalView }}
      accessibilityLabel={
        globalView
          ? 'Global view is on. Switch back to seeing only what you are a member of.'
          : 'Global view is off. Switch to seeing every league and match.'
      }
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: globalView ? theme.accentWarm : theme.rule,
          backgroundColor: globalView ? theme.backgroundSelected : 'transparent',
        },
        pressed && styles.pressed,
      ]}>
      <Icon
        name={globalView ? 'search' : 'person'}
        size={16}
        color={globalView ? theme.accentWarmInk : theme.textSecondary}
      />
      {compact ? null : (
        <ThemedText
          type="label"
          style={{ color: globalView ? theme.accentWarmInk : theme.textSecondary }}>
          {globalView ? 'Global' : 'Normal'}
        </ThemedText>
      )}
    </Pressable>
  );
}

/**
 * Profile's version: says what the mode does, because this is where somebody
 * meets it for the first time and a two-word chip explains nothing.
 *
 * Framed as what you are currently seeing rather than as a setting to configure —
 * the useful question is "am I looking at the app as a member right now?", and
 * the answer should be readable without working out what the switch's position
 * means.
 */
export function GlobalViewRow() {
  const theme = useTheme();
  const isAdmin = useIsAdmin();
  const globalView = useGlobalView();

  if (!isAdmin) return null;

  return (
    <ThemedView
      type={globalView ? 'backgroundSelected' : 'background'}
      style={[styles.row, { borderColor: globalView ? theme.accentWarm : theme.rule }]}>
      <View style={styles.rowText}>
        <ThemedText type="smallBold" style={globalView ? { color: theme.accentWarmInk } : undefined}>
          {globalView ? 'Seeing everything' : 'Seeing your own'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {globalView
            ? 'Every league and match in the app, including ones you are not in. You cannot change anything you are not already an organizer of, and looking does not join you to anything.'
            : 'The app as any member sees it: the leagues you belong to and the matches you can join.'}
        </ThemedText>
      </View>

      <Pressable
        onPress={() => setGlobalView(!globalView)}
        accessibilityRole="switch"
        accessibilityState={{ checked: globalView }}
        accessibilityLabel={
          globalView ? 'Switch back to your own view' : 'Switch to seeing everything'
        }
        style={({ pressed }) => [
          styles.rowButton,
          { borderColor: globalView ? theme.accentWarm : theme.rule },
          pressed && styles.pressed,
        ]}>
        <ThemedText
          type="label"
          style={{ color: globalView ? theme.accentWarmInk : theme.accentInk }}>
          {globalView ? 'Show mine' : 'Show all'}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    minHeight: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
  },
  rowText: {
    flex: 1,
    gap: Spacing.one,
  },
  rowButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    minHeight: 32,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
  },
  pressed: {
    opacity: 0.7,
  },
});
