import { Text, View } from 'react-native';

import { GradientButton } from '@/components/kit/controls';
import { LeagueDot } from '@/components/kit/layout';
import { MapLink } from '@/components/match-detail-sheet';
import { Sheet, SheetFooter, SheetHeader, SheetSection } from '@/components/kit/sheet';
import { colors, leagueEdge, text } from '@/constants/design';
import { formatMiles } from '@/lib/geo';
import type { PublicLeague } from '@/lib/leagues';
import { canMap, openMap } from '@/lib/maps';
import { formatFullWhen } from '@/lib/matches';

/**
 * A public league, opened from its card in Browse.
 *
 * Answers the question the card cannot: where the next meetup actually is, and what
 * joining a league gets you — which is not a seat, because league seats come from a
 * draw. Somebody about to commit to a season deserves to know that before they
 * press the button rather than after.
 *
 * There is no roster here, and that is not an omission. `league_members` is
 * readable only by members, so a league you have not joined genuinely cannot tell
 * you who is in it — the sheet says so instead of leaving a gap where a list should
 * be.
 */
export function PublicLeagueSheet({
  league,
  distance,
  visible,
  busy,
  onClose,
  onJoin,
}: {
  league: PublicLeague;
  /** Miles to the next meetup, when both ends have coordinates. */
  distance?: number | null;
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onJoin: () => void;
}) {
  const tint = leagueEdge(league.color);
  const full = league.seats_left !== null && league.seats_left <= 0;
  /** The next meetup shaped as somewhere mappable, which is all `openMap` wants. */
  const meetup = {
    location: league.next_location ?? '',
    location_detail: league.next_location_detail,
    latitude: league.next_latitude,
    longitude: league.next_longitude,
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={league.name}
        onClose={onClose}
        eyebrow={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <LeagueDot color={tint} />
            <Text style={[text.meta, { color: colors.link }]}>League</Text>
          </View>
        }
      />

      <SheetSection title="Members">
        <Text style={[text.bodyStrong, { color: colors.ink }]}>
          {league.member_count} {league.member_count === 1 ? 'member' : 'members'}
        </Text>
        {/* Null seats_left means the organizer set no cap, which is not the same as
            knowing how many are free — so it says that rather than a number it does
            not have. */}
        <Text style={[text.meta, { color: colors.inkMuted }]}>
          {league.seats_left === null
            ? 'No member limit set.'
            : full
              ? 'Full — no seats left.'
              : `${league.seats_left} ${league.seats_left === 1 ? 'seat' : 'seats'} left of ${
                  league.max_members
                }.`}
        </Text>
        {league.is_member ? (
          <Text style={[text.meta, { color: colors.link }]}>You are already in this league.</Text>
        ) : (
          <Text style={[text.meta, { color: colors.inkMuted }]}>Who is in it is visible to members.</Text>
        )}
      </SheetSection>

      <SheetSection title="Next meetup">
        {league.next_meetup ? (
          <>
            <Text style={[text.bodyStrong, { color: colors.ink }]}>
              {formatFullWhen(league.next_meetup)}
            </Text>
            {league.next_location ? (
              <Text style={[text.meta, { color: colors.inkMuted }]}>{league.next_location}</Text>
            ) : null}
            {league.next_location_detail ? (
              <Text style={[text.meta, { color: colors.inkMuted }]}>{league.next_location_detail}</Text>
            ) : null}
            {typeof distance === 'number' ? (
              <Text style={[text.meta, { color: colors.link }]}>{formatMiles(distance)}</Text>
            ) : null}
            {canMap(meetup) ? (
              <MapLink onPress={() => openMap(meetup)} style={{ marginTop: 8 }} />
            ) : null}
          </>
        ) : (
          <Text style={[text.meta, { color: colors.inkMuted }]}>
            Nothing on the calendar yet. The organizer sets the meetups, and they show
            up in My Matches once the tables are drawn.
          </Text>
        )}
      </SheetSection>

      {/* The part a card has no room for and nobody should have to infer. */}
      <SheetSection title="How a league works">
        <Text style={[text.meta, { color: colors.inkMuted }]}>
          Meetups are scheduled by the organizer, and the tables are drawn — you are
          seated with different people each time rather than picking a seat. Every
          table you play counts toward the league&apos;s own standings.
        </Text>
      </SheetSection>

      {league.is_member || full ? null : (
        <SheetFooter>
          <GradientButton label="Join league" onPress={onJoin} busy={busy} style={{ flex: 1 }} />
        </SheetFooter>
      )}
    </Sheet>
  );
}
