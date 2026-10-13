import { useState } from 'react';

import { PublicLeagueSheet } from '@/components/public-league-sheet';
import { LeagueRowCard } from '@/components/kit/cards';
import { Button } from '@/components/kit/controls';
import { formatMiles } from '@/lib/geo';
import type { PublicLeague } from '@/lib/leagues';
import { formatWhen, timingNote } from '@/lib/matches';

/**
 * A public league offered in Browse.
 *
 * Sits in the same list as the tables and reads as another thing you can join,
 * which the redesign says with a violet trophy chip and a LEAGUE label rather
 * than with the coloured left edge the old card shared with match cards — the
 * new cards have no edges at all.
 */
export function LeagueCard({
  league,
  distance,
  now,
  busy,
  onJoin,
}: {
  league: PublicLeague;
  /** Miles to the next meetup, when both ends have coordinates. */
  distance?: number | null;
  /** The instant the list was classified against; see the note on MatchCard. */
  now?: number;
  busy: boolean;
  onJoin: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const full = league.seats_left !== null && league.seats_left <= 0;
  /**
   * A league has no date of its own — it is a season of them — so the closest
   * thing to "about to happen" is that its next meetup is.
   */
  const note = now === undefined ? null : timingNote(league.next_meetup, league.created_at, now);

  /**
   * What qualifies the LEAGUE label. One slot, so the facts are ranked: being in
   * it outranks how full it is, and either outranks how soon it meets.
   *
   * A null `seats_left` means the organizer set no cap, which is not the same as
   * knowing how many are free — so it says nothing rather than a number it does
   * not have.
   */
  const standing = league.is_member
    ? "You're in"
    : full
      ? 'Full'
      : league.seats_left !== null
        ? `${league.seats_left} ${league.seats_left === 1 ? 'seat' : 'seats'} left`
        : null;
  const timing = note === 'soon' ? 'Meets soon' : note === 'new' ? 'Just added' : null;
  const status = [timing, standing].filter(Boolean).join(' · ') || undefined;

  const meta = [
    `${league.member_count} ${league.member_count === 1 ? 'member' : 'members'}`,
    league.next_meetup
      ? `Next ${formatWhen(league.next_meetup)}${league.next_location ? ` · ${league.next_location}` : ''}`
      : 'No meetups scheduled yet',
    typeof distance === 'number' ? formatMiles(distance) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <LeagueRowCard
        name={league.name}
        status={status}
        meta={meta}
        muted={full}
        onPress={() => setShowDetail(true)}
        /* Nothing to press once you are in or once it is full. Joining is the one
           action here; the seats you play are dealt by the league's draw later. */
        action={
          league.is_member || full ? null : (
            <Button variant="outline" size="md" label="Join league" onPress={onJoin} busy={busy} />
          )
        }
      />

      <PublicLeagueSheet
        league={league}
        distance={distance}
        visible={showDetail}
        busy={busy}
        onClose={() => setShowDetail(false)}
        onJoin={() => {
          setShowDetail(false);
          onJoin();
        }}
      />
    </>
  );
}
