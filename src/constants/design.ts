/**
 * Design tokens for the "Ribbon" redesign — `design-handoff/DESIGN_HANDOFF.md` §3.
 *
 * A second token module rather than a rewrite of `theme.ts`, deliberately. Every
 * screen in the app imports `Colors` from there, so replacing it in place would
 * mean rebuilding all of them in one commit. The kit in `components/kit/` reads
 * from here; a screen switches token module when it is rebuilt, and `theme.ts`
 * shrinks to what is still referenced once the last one has moved.
 *
 * Two departures from the handoff's `reference-components/theme.ts`, both named
 * so the spec is still greppable:
 *
 * - Its `type` scale is exported here as `text`. `import { type } from …` puts a
 *   TypeScript modifier keyword in an import clause, which is a parse hazard for
 *   no benefit.
 * - Light values only. The palette the handoff supplies has no dark half — no
 *   dark tile face, pill tones or ink card — and inventing one would be guessing
 *   at the brand board rather than reading it. `userInterfaceStyle` goes to
 *   `light` when the last screen moves over.
 */

import { Platform, type ViewStyle } from 'react-native';

import { LeagueColors } from '@/constants/theme';

export const colors = {
  // The brand spectrum, in gradient order — the order is the token.
  teal: '#2FB7A6',
  lime: '#C7D84A',
  yellow: '#FFD44D',
  orange: '#FFA35A',
  coral: '#FF7D72',

  mint: '#66D3B6',
  sky: '#35C3E6',
  violet: '#8B74FF',
  indigo: '#5A48DB',

  /** Primary text, dark buttons, the Leaderboard standing card. */
  ink: '#141A2E',
  /** Secondary text. Passes 4.5:1 on white and on `bg`. */
  inkMuted: '#5E6577',
  /** Secondary text on an ink ground. */
  inkOnDarkMuted: '#C9CEDB',
  /** The page the cards sit on, and the fill of wells inside them. */
  bg: '#F4F5F8',
  surface: '#FFFFFF',
  /** Segmented-control track and every hairline border. */
  track: '#E7E9EE',
  /** Row dividers inside cards. */
  divider: '#EEF0F4',
  /** Dashed empty slots, and the switch's off track. */
  dashed: '#D5D9E2',
  white: '#FFFFFF',
  /**
   * Placeholder text, and only placeholder text. Carried over from `theme.ts`
   * along with its reasoning: at `inkMuted`'s weight an example of what to type
   * reads as a value already in the field, and people could not tell an empty
   * input from a filled one. Lighter on purpose, around 3:1, which is safe
   * because every input here is labelled and no meaning lives in the hint.
   */
  placeholder: '#A2A8B2',

  /**
   * Teal as type. `#2FB7A6` is 2.5:1 on white and cannot carry text, so every
   * link, eyebrow and active tab uses this instead — the same split the old
   * palette made with its `*Ink` roles.
   */
  link: '#127A6E',
  linkPressed: '#0C5C53',
  danger: '#B42318',

  /** The mahjong-tile surface behind dates, stats and ranks. */
  tileFace: '#FFFBEF',
  tileBorder: '#F0E6C9',
  /** The weekday on a date tile, and the "+" on an open seat. */
  tileWeekday: '#B23A2E',

  /** The leader's points on Leaderboard, and the highlighted row's bar track. */
  leaderPoints: '#8A4300',
  youRow: '#FFF7D6',
  youRowTrack: '#F3E6B5',
  /** The rank edge for everyone who is not leading. */
  rankEdge: '#C9CEDB',
  /** The locked reshuffle button: pale lime fill, muted lime icon. */
  lockedDrawBg: '#F2F5DC',
  lockedDrawFg: '#9AA36A',
} as const;

/** The signature gradient. Button stops and ribbon stops differ; both are here. */
export const brandGradient = {
  colors: [colors.teal, colors.lime, colors.yellow, colors.orange, colors.coral] as const,
  /** Buttons, left to right. */
  locations: [0, 0.35, 0.55, 0.8, 1] as const,
  /** The ribbon squiggle, diagonally. */
  ribbonLocations: [0, 0.3, 0.55, 0.8, 1] as const,
  /** Short accents — the tab indicator and the avatar ring. */
  short: [colors.teal, colors.yellow, colors.coral] as const,
} as const;

/** Status pill tones, background and text. Every pair passes 4.5:1. */
export const pillTones = {
  sub: { bg: '#FFE7E4', fg: '#A8322A' },
  soon: { bg: '#FFF3C4', fg: '#6E5200' },
  you: { bg: '#EEEAFF', fg: '#4A3AC0' },
  hosting: { bg: '#FFEBDC', fg: '#8A4300' },
  neutral: { bg: '#EEF0F4', fg: '#4A5163' },
  info: { bg: '#E3F5F2', fg: '#0F6B60' },
  /** The league chip and its LEAGUE label. */
  league: { bg: '#EEEAFF', fg: '#5A48DB' },
  /** Draw tables / Reshuffle, and nothing else. */
  draw: { bg: '#E6EDB0', fg: '#3F4800' },
} as const;

export type PillTone = keyof typeof pillTones;

/** Avatar fallbacks when a member has no photo: [ground, initials]. Picked by hash of the id. */
export const avatarPalette: readonly (readonly [string, string])[] = [
  [colors.teal, '#0B3B35'],
  [colors.yellow, '#5A4300'],
  [colors.violet, '#FFFFFF'],
  [colors.ink, '#FFFFFF'],
  [colors.orange, '#5A2A00'],
];

/**
 * The edge colour under a date tile.
 *
 * Leagues already store one (`leagues.color`, constrained to the `LeagueColors`
 * keys), so §8's hash fallback is not needed — but an unknown key still has to
 * land somewhere, and a single match has no league at all. Both get teal, which
 * is what the handoff specifies for a single match.
 */
export function leagueEdge(color: string | null | undefined): string {
  if (!color) return colors.teal;
  return LeagueColors[color as keyof typeof LeagueColors] ?? colors.teal;
}

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/**
 * The type scale. `letterSpacing` is in px, since RN has no `em`: px = em × size.
 *
 * Weight is chosen with `fontFamily` and never with `fontWeight` — setting both
 * makes Android synthesize a faux bold on top of a face that already has one.
 */
export const text = {
  /** Screen H1. */
  display: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 39, letterSpacing: -0.68 },
  /** H1 for a long name, such as a league title. */
  displaySm: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 35, letterSpacing: -0.6 },
  /** UPPERCASE, in `link`. */
  eyebrow: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 1.44 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  /** The venue on the Browse hero card. */
  heroCardTitle: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 24 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  /** UPPERCASE. */
  pill: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.44 },
  button: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  buttonSm: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  tab: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  tabActive: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const layout = {
  /** Side padding of every screen. */
  screenGutter: 20,
  /** Vertical gap between blocks. */
  sectionGap: 20,
  /** Added to the safe-area inset for the top of the content. */
  headerTopPad: 12,
  minTouch: 44,
  /** Plus the bottom safe-area inset. */
  tabBarHeight: 62,
} as const;

export const radius = {
  card: 24,
  /** The empty-state card. */
  cardLg: 28,
  /** Wells inside a card. */
  inset: 16,
  /** A date tile. */
  tile: 12,
  /** A stat tile. */
  tileLg: 14,
  iconChip: 16,
  pill: 999,
} as const;

/**
 * Card lift. The handoff's CSS is
 * `0 1px 2px rgba(20,26,46,.04), 0 10px 28px rgba(20,26,46,.08)`.
 *
 * Each role is spelled three ways because no single one works everywhere:
 * `shadowOffset`/`shadowOpacity`/`shadowRadius` on iOS, `elevation` on Android,
 * and `boxShadow` on web — react-native-web 0.21 drops the legacy props on the
 * floor, keeping only `shadowColor`, which renders as nothing at all. That is
 * the same trap `CardShadow` in `theme.ts` documents; it is handled here per
 * platform so callers can just spread `shadow.card`.
 */
export const shadow: Record<'card' | 'raised' | 'glow' | 'segment', ViewStyle> = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: colors.ink, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 10 } },
    web: { boxShadow: '0px 1px 2px rgba(20, 26, 46, 0.04), 0px 10px 28px rgba(20, 26, 46, 0.08)' },
    default: { elevation: 3 },
  })!,
  /** The app mark and the profile avatar: `0 2px 8px rgba(20,26,46,.10)`. */
  raised: Platform.select<ViewStyle>({
    ios: { shadowColor: colors.ink, shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    web: { boxShadow: '0px 2px 8px rgba(20, 26, 46, 0.10)' },
    default: { elevation: 2 },
  })!,
  /** The header Propose button only: `0 6px 16px rgba(255,125,114,.25)`. */
  glow: Platform.select<ViewStyle>({
    ios: { shadowColor: colors.coral, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } },
    web: { boxShadow: '0px 6px 16px rgba(255, 125, 114, 0.25)' },
    default: { elevation: 4 },
  })!,
  /** The selected segment's thumb: `0 1px 4px rgba(20,26,46,.12)`. */
  segment: Platform.select<ViewStyle>({
    ios: { shadowColor: colors.ink, shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    web: { boxShadow: '0px 1px 4px rgba(20, 26, 46, 0.12)' },
    default: { elevation: 1 },
  })!,
};

export const motion = {
  /** Press feedback. */
  fast: 150,
  /** The switch thumb and the segment thumb. */
  base: 200,
  /** The optional ribbon draw-on. */
  ribbonDraw: 900,
} as const;
