/**
 * The icon set the redesign draws with — `DESIGN_HANDOFF.md` §4.11 and the
 * per-button notes in §4.5.
 *
 * Stroke-only on a 24×24 box, round caps and joins, no fill, so one `strokeWidth`
 * distinguishes an idle tab from an active one without swapping assets. Separate
 * from `components/icon.tsx`, which renders SF Symbols through `expo-symbols`
 * and has no equivalent for several of these.
 */

import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const P = (d: string) => <Path d={d} />;

const Icons = {
  plus: [P('M12 5v14M5 12h14')],
  close: [P('M6 6l12 12M18 6L6 18')],
  /** Tab: Browse. */
  search: [<Circle key="c" cx={11} cy={11} r={7} />, P('M20 20l-4-4')],
  /** Tab: Matches. */
  calendar: [<Rect key="r" x={4} y={5} width={16} height={15} rx={3} />, P('M8 3v4M16 3v4M4 10h16')],
  /** Tab: Leagues. */
  trophy: [P('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z')],
  /** The same cup with handles, for the league card's chip. */
  trophyHandles: [
    P('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z'),
    P('M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3'),
  ],
  /** Tab: Leaderboard. */
  bars: [P('M6 20V11M12 20V5M18 20v-6')],
  /** Tab: Profile. */
  profile: [<Circle key="c" cx={12} cy={8} r={4} />, P('M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6')],
  chevronRight: [P('M9 6l6 6-6 6')],
  chevronDown: [P('M6 9l6 6 6-6')],
  chevronLeft: [P('M15 6l-6 6 6 6')],
  pin: [P('M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z'), <Circle key="c" cx={12} cy={9.5} r={2.5} />],
  sliders: [
    P('M4 7h10M18 7h2M4 17h4M12 17h8'),
    <Circle key="a" cx={16} cy={7} r={2} />,
    <Circle key="b" cx={10} cy={17} r={2} />,
  ],
  pencil: [P('M4 20h4L19 9l-4-4L4 16v4z')],
  scores: [<Rect key="r" x={4} y={4} width={16} height={16} rx={3} />, P('M4 10h16M10 10v10')],
  shuffle: [P('M16 4h4v4M4 20l16-16M20 16v4h-4M15 15l5 5M4 4l5 5')],
  users: [
    <Circle key="c" cx={9} cy={8} r={3.5} />,
    P('M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5'),
    P('M16 5.5a3 3 0 0 1 0 5.5M18 15c1.8.6 3 2.2 3.5 5'),
  ],
  mail: [<Rect key="r" x={3} y={5} width={18} height={14} rx={3} />, P('M4 7l8 6 8-6')],
  share: [P('M12 15V3M7 8l5-5 5 5'), P('M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7')],
  lock: [<Rect key="r" x={5} y={11} width={14} height={10} rx={2} />, P('M8 11V7a4 4 0 0 1 8 0v4')],
  info: [<Circle key="c" cx={12} cy={12} r={9} />, P('M12 11v5M12 8h.01')],
  archive: [
    <Rect key="r" x={3} y={4} width={18} height={5} rx={1.5} />,
    P('M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4'),
  ],
} as const;

export type IconName = keyof typeof Icons;

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round">
      {Icons[name].map((element, index) => React.cloneElement(element, { key: index }))}
    </Svg>
  );
}
