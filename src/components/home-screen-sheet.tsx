import { Text, View } from 'react-native';

import { GradientButton } from '@/components/kit/controls';
import { Sheet, SheetFooter, SheetHeader } from '@/components/kit/sheet';
import { colors, fonts, text } from '@/constants/design';
import type { MobilePlatform } from '@/lib/home-screen-prompt';

/**
 * Steps for putting Seven Bam on a phone's home screen, shown once, just after a
 * member takes their first seat.
 *
 * The timing is the point. Somebody who has just joined a game now has a reason to
 * come back to a particular date, which is exactly when a shortcut is worth having
 * — and it is the first moment they have anything of their own in the app. The same
 * words on the sign-in screen would be an install prompt from a stranger.
 *
 * Written for one platform at a time rather than listing both. Whoever reads this
 * is holding a phone, and half a set of instructions that do not match the phone in
 * their hand is how people conclude the app is broken.
 */
export function HomeScreenSheet({
  visible,
  platform,
  onClose,
}: {
  visible: boolean;
  /** Which set of steps to show. Never rendered without one. */
  platform: MobilePlatform;
  onClose: () => void;
}) {
  /**
   * Written for the platform, not for one browser. Safari is the common case on
   * iOS but not the only one, and on Android the menu belongs to Chrome, Samsung
   * Internet, Firefox or Edge depending on the phone — naming the wrong browser is
   * how somebody concludes these instructions are not for them and gives up. So
   * each step describes the control and where it sits, which is the same in all of
   * them, and hedges the label where the wording differs.
   */
  const steps =
    platform === 'ios'
      ? [
          'Tap the Share button in your browser — a square with an arrow pointing up.',
          'Scroll down the list and choose Add to Home Screen.',
          'Tap Add.',
        ]
      : [
          "Open your browser's menu — usually ⋮ at the top right.",
          'Choose Add to Home screen, or Install app.',
          'Confirm with Add or Install.',
        ];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Keep Seven Bam one tap away"
        eyebrow={
          <Text style={[text.meta, { color: colors.inkMuted }]}>You are in — nice one</Text>
        }
        onClose={onClose}
      />

      {/* Leads with what this is, because somebody who has just joined a game is
          entitled to wonder where the app is. Saying "web app, apps coming" first
          turns the steps below from a workaround into the interim answer. */}
      <Text style={[text.meta, { color: colors.inkMuted }]}>
        This is the web version of Seven Bam — the iOS and Android apps are coming
        soon. Until then, add it to your home screen and it opens just like a native
        app, straight to your matches. Nothing to install, and you stay signed in.
      </Text>

      <View style={{ gap: 14 }}>
        {steps.map((step, index) => (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {/* Numbered rather than bulleted: these have to happen in order, and
                the second one is the step people miss. */}
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.white }}>
                {index + 1}
              </Text>
            </View>
            <Text style={[text.body, { color: colors.ink, flex: 1 }]}>{step}</Text>
          </View>
        ))}
      </View>

      <SheetFooter>
        {/* One way out, and it is not a refusal. There is nothing to decline here —
            the sheet has already said everything it has to say, so "Got it" is the
            honest label and the close button in the corner does the same job. */}
        <GradientButton label="Got it" onPress={onClose} style={{ flex: 1 }} />
      </SheetFooter>
    </Sheet>
  );
}
