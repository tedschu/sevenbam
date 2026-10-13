import * as AppleAuthentication from 'expo-apple-authentication';
import { View } from 'react-native';

/**
 * Apple's own Continue with Apple button, sized to sit with the Google one.
 *
 * Apple's control rather than one of ours, because the guidelines want its
 * wording, mark and proportions left alone. White with an outline to match the
 * outline treatment Google gets beside it; 48 tall and fully rounded for the same
 * reason. It has no disabled state of its own, so the wrapper supplies one.
 */
export function AppleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={{ opacity: disabled ? 0.5 : 1 }}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
        cornerRadius={24}
        style={{ height: 48 }}
        onPress={onPress}
      />
    </View>
  );
}
