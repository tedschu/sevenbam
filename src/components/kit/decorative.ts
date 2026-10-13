import { Platform } from 'react-native';

/**
 * Marks an SVG as decoration for assistive tech.
 *
 * Spelled per platform on purpose: `accessible` and `importantForAccessibility`
 * are React Native props, and react-native-svg forwards anything it does not
 * recognise straight to the DOM on web — where React then warns about both. Web
 * gets the ARIA attribute that actually works there.
 */
export const decorativeSvgProps = Platform.select({
  web: { 'aria-hidden': true },
  default: { accessible: false, importantForAccessibility: 'no-hide-descendants' as const },
})!;
