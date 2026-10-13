/**
 * The bottom sheet every modal in the app opens as — a match's or league's full
 * detail, the propose form, scoring a table, the home-screen prompt.
 *
 * One shell rather than the four the app had (each screen built its own Modal +
 * backdrop + rounded panel by hand), so the gesture reads as the same kind of
 * thing everywhere: it slides up from the same height, dims the page the same
 * amount, and carries the same drag handle and close button.
 */

import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, text } from '@/constants/design';

import { IconButton } from './controls';

export function Sheet({
  visible,
  onClose,
  /**
   * Wraps the panel in a `KeyboardAvoidingView`, for the sheets with a text
   * field a keyboard would otherwise cover — the propose form, scoring.
   */
  keyboardAvoiding = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  keyboardAvoiding?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  const backdrop = (
    <View
      style={{
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
        backgroundColor: 'rgba(20,26,46,0.4)',
      }}>
      {/*
        The tappable backdrop, as a sibling behind the panel rather than a
        Pressable wrapping it. Wrapping would swallow presses meant for the
        controls inside: on web a press is a click, and a click bubbles up to
        every handler above it instead of stopping at the deepest one.
      */}
      <Pressable
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        onPress={onClose}
        accessibilityLabel="Close"
      />

      <View
        style={[
          {
            width: '100%',
            maxWidth: 560,
            maxHeight: '92%',
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.cardLg,
            borderTopRightRadius: radius.cardLg,
            overflow: 'hidden',
          },
          shadow.card,
        ]}>
        {/* A drag handle rather than nothing above the content: it is the
            universal "this slides away" affordance, and the sheet has no
            other visual cue that it is a layer rather than a page. */}
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.track }} />
        </View>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom, gap: 20 }}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {backdrop}
        </KeyboardAvoidingView>
      ) : (
        backdrop
      )}
    </Modal>
  );
}

/**
 * The heading: what this is, above what it is called, with the dismiss
 * control. A sheet tall enough to fill the screen leaves no obvious backdrop
 * left to tap, so it needs a real close button.
 */
export function SheetHeader({
  title,
  eyebrow,
  onClose,
}: {
  title: string;
  /** What kind of thing this is — "Pick-up match", "League". */
  eyebrow?: ReactNode;
  onClose: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[text.sectionTitle, { color: colors.ink }]}>{title}</Text>
        {eyebrow}
      </View>
      <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
    </View>
  );
}

/**
 * A titled block. Every fact in a sheet is one of these, so the eye can find
 * "where" without reading "when" first — which is the whole reason these
 * sheets exist rather than longer cards.
 */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[text.caption, { color: colors.inkMuted, letterSpacing: 0.6 }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

/** The action row, ruled off from the facts above it. */
export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: colors.divider,
        paddingTop: 14,
      }}>
      {children}
    </View>
  );
}
