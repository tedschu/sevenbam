import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { colors, radius } from '@/constants/design';
import { Spacing } from '@/constants/theme';
import { fetchMyEmail, openGroupEmail, type Recipient } from '@/lib/contact';

/**
 * Writes to everyone who joined, through whatever mail client the member uses.
 *
 * The addresses are fetched on press rather than when the screen loads. A host
 * opens a match to read it far more often than to write to it, and the alternative
 * is pulling a list of email addresses down for every card in a list on the chance
 * one of them gets used.
 *
 * Shared by matches and leagues because the awkward parts are the same in both: the
 * list is fetched, it might come back empty, and it might be longer than a `mailto:`
 * URL can carry. Doing that twice would mean getting it right twice.
 */
export function EmailGroupButton({
  label,
  gather,
  subject,
  body,
}: {
  /** "Email players", "Email members". */
  label: string;
  /** Fetches the recipients. Returns an empty list when the caller is not entitled. */
  gather: () => Promise<Recipient[]>;
  subject: string;
  /** A prefilled draft. The host writes above the details rather than assembling them. */
  body: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setNote(null);

    try {
      const [recipients, self] = await Promise.all([gather(), fetchMyEmail()]);

      if (recipients.length === 0) {
        setNote('Nobody else has joined yet.');
        return;
      }

      const { sent, omitted } = await openGroupEmail({ self, recipients, subject, body });

      // Said rather than swallowed. A message that reached most of a large league
      // and did not mention it is how somebody misses a cancellation.
      if (omitted > 0) {
        setNote(
          `Your mail app can only take ${sent} addresses at once, so ${omitted} ${
            omitted === 1 ? 'person was' : 'people were'
          } left out. Send again to the rest, or copy the list from the roster.`
        );
      }
    } catch {
      setNote('Could not open your mail app.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={send}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          busy && styles.disabled,
        ]}>
        <Icon name="mail" color={colors.ink} size={16} />
        <ThemedText type="smallBold" style={{ color: colors.ink }}>
          {busy ? 'Opening…' : label}
        </ThemedText>
      </Pressable>

      {note ? (
        <ThemedText type="small" themeColor="textSecondary">
          {note}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  /**
   * The kit's "soft" button, full width — §4.5. Kept as a stylesheet entry
   * rather than moved onto `components/kit/controls.tsx`'s `Button`, whose
   * `onPress` is a plain callback: this control's own press does the fetch,
   * the empty-recipients check and the `mailto:` truncation note, none of
   * which the kit button has anywhere to put.
   */
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.track,
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});
