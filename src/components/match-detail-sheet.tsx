import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Avatar as OldAvatar, EmptySeat } from '@/components/avatar';
import { ContactRows } from '@/components/contact-rows';
import { EmailGroupButton } from '@/components/email-group-button';
import { Button } from '@/components/kit/controls';
import { LeagueDot } from '@/components/kit/layout';
import { Sheet, SheetFooter, SheetHeader, SheetSection } from '@/components/kit/sheet';
import { colors, leagueEdge, text } from '@/constants/design';
import { fetchMatchHostContact, fetchMatchPlayerEmails, type Contact } from '@/lib/contact';
import { formatMiles } from '@/lib/geo';
import { canMap, openMap } from '@/lib/maps';
import { formatFullWhen, formatWhen, isSeated, SEATS_PER_MATCH, type Match } from '@/lib/matches';

/** The roster, in full, with the seats nobody has taken shown as seats. */
function Roster({
  match,
  userId,
  calendarSent,
  onAddToCalendar,
}: {
  match: Match;
  userId: string;
  calendarSent?: boolean;
  onAddToCalendar?: () => void;
}) {
  const empty = Math.max(0, SEATS_PER_MATCH - match.players.length);

  return (
    <View style={{ gap: 14, marginTop: 4 }}>
      {match.players.map((player) => (
        <View key={player.player_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <OldAvatar person={player.profile ?? { name: null }} size={36} ring={colors.white} />
          <Text
            style={[text.bodyStrong, { color: colors.ink, flex: 1 }]}
            numberOfLines={1}>
            {player.profile?.name ?? 'Unnamed member'}
            {player.player_id === userId ? ' (you)' : ''}
          </Text>
          {player.player_id === match.host_id ? (
            <Text style={[text.pill, { color: colors.link }]}>HOST</Text>
          ) : null}

          {/* On the member's own row, where taking a seat just put their name —
              rather than at the foot of the sheet, where it read as one more grey
              glyph in a row of controls and was missed. */}
          {player.player_id === userId && onAddToCalendar ? (
            <Button
              variant="soft"
              size="xs"
              icon="calendar"
              label={calendarSent ? 'Sent' : 'Calendar'}
              onPress={onAddToCalendar}
            />
          ) : null}
        </View>
      ))}

      {/* Rings rather than a "2 seats left" line, so the shape of the table is the
          thing you read. The count is in the section heading for anyone who wants
          it as a number. */}
      {Array.from({ length: empty }, (_, seat) => (
        <View key={`open-${seat}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <EmptySeat size={36} ring={colors.white} />
          <Text style={[text.body, { color: colors.inkMuted, flex: 1 }]}>Open seat</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Everything about one match, opened by tapping its card.
 *
 * This replaced a sheet that showed only the roster. That sheet answered the one
 * question a card had no room for, but a card has no room for most of them: the
 * street address was truncated to a line, the notes to two, and there was nowhere
 * at all to put a way of getting directions. So the card is now a summary that
 * opens the full thing, and the seats are one section of it rather than its point.
 *
 * It reads its match from props on every render rather than snapshotting it, so
 * joining or leaving from the footer updates the sheet in place once the screen
 * reloads instead of showing the seats as they were when it opened.
 */
export function MatchDetailSheet({
  match,
  userId,
  distance,
  visible,
  onClose,
  onEdit,
  action,
  calendarSent,
  onAddToCalendar,
}: {
  match: Match;
  userId: string;
  /** Miles from the member's town, when Browse worked one out. */
  distance?: number | null;
  visible: boolean;
  onClose: () => void;
  /** Whether this member has already sent this match to their calendar. */
  calendarSent?: boolean;
  /**
   * Puts the match in the member's calendar, drawn on their own roster row. Given
   * only when they hold a seat — there is nothing to diary about a table you have
   * not joined — so its absence is what hides the control.
   */
  onAddToCalendar?: () => void;
  /**
   * Hands off to the edit sheet. Given only by screens that own one, and only
   * shown to the host — so a member reading a match they joined sees no control
   * they are not allowed to use.
   */
  onEdit?: () => void;
  /** The screen's seat control, so joining does not mean closing this first. */
  action?: ReactNode;
}) {
  const isHost = match.host_id === userId;
  const isOver = match.status === 'canceled' || match.status === 'completed';
  const canEdit = isHost && !isOver && Boolean(onEdit);
  const taken = match.players.length;

  /**
   * The host's contact details, for someone at the table.
   *
   * Fetched when the sheet opens rather than with the list: it is one extra round
   * trip per sheet opened, against one per card in a list of thirty, and nobody
   * needs a host's email until they are reading their match. The database refuses
   * anyone who is not seated, so the `isSeated` test here only avoids a call that
   * would come back empty.
   */
  const [contact, setContact] = useState<Contact | null>(null);
  const entitled = isHost || isSeated(match, userId);

  useEffect(() => {
    if (!visible || !entitled) return;

    let active = true;
    fetchMatchHostContact(match.id).then((found) => {
      if (active) setContact(found);
    });

    return () => {
      active = false;
    };
  }, [entitled, match.id, visible]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={match.location}
        onClose={onClose}
        eyebrow={
          match.league ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <LeagueDot color={leagueEdge(match.league.color)} />
              <Text style={[text.meta, { color: colors.inkMuted }]}>
                {match.league.name}
                {match.table_number ? ` · Table ${match.table_number}` : ''}
              </Text>
            </View>
          ) : (
            <Text style={[text.meta, { color: colors.inkMuted }]}>Pick-up match</Text>
          )
        }
      />

      {/* Said once, plainly, rather than left to a pill — the card's pills are not
          in view from inside the sheet. */}
      {match.status === 'canceled' ? (
        <Text style={[text.bodyStrong, { color: colors.danger }]}>
          This match was called off by the host.
        </Text>
      ) : null}
      {match.status === 'completed' ? (
        <Text style={[text.bodyStrong, { color: colors.inkMuted }]}>
          Played. Scores are on the Leaderboard.
        </Text>
      ) : null}

      <SheetSection title="When">
        <Text style={[text.bodyStrong, { color: colors.ink }]}>{formatFullWhen(match.date_time)}</Text>
      </SheetSection>

      <SheetSection title="Where">
        <Text style={[text.bodyStrong, { color: colors.ink }]}>{match.location}</Text>
        {/* The whole address, unwrapped. On a card this is one truncated line,
            which is exactly what somebody about to drive there does not need. */}
        {match.location_detail ? (
          <Text style={[text.meta, { color: colors.inkMuted }]}>{match.location_detail}</Text>
        ) : (
          <Text style={[text.meta, { color: colors.inkMuted }]}>
            No street address given — ask the host if you need one.
          </Text>
        )}
        {typeof distance === 'number' ? (
          <Text style={[text.meta, { color: colors.link }]}>{formatMiles(distance)}</Text>
        ) : null}

        {/* Offered only when there is a real address to open. See canMap: a link is
            worse than no link when all it can search for is a venue somebody named
            themselves. */}
        {canMap(match) ? (
          <MapLink onPress={() => openMap(match)} style={{ marginTop: 8 }} />
        ) : null}
      </SheetSection>

      <SheetSection title={`Players · ${taken} of ${SEATS_PER_MATCH} seats taken`}>
        <Roster
          match={match}
          userId={userId}
          calendarSent={calendarSent}
          onAddToCalendar={onAddToCalendar}
        />

        {/*
          Writing to the table, for the host — placed here rather than in the footer
          because it belongs to the list of people it reaches.

          Hidden while the host is alone: pressing it would only report that nobody
          has joined, which the roster above already says in rings.
        */}
        {isHost && taken > 1 ? (
          <View style={{ marginTop: 14 }}>
            <EmailGroupButton
              label="Email players"
              gather={() => fetchMatchPlayerEmails(match.id)}
              subject={`Mahjong at ${match.location} · ${formatWhen(match.date_time)}`}
              // The details are prefilled below a blank line, so the host writes
              // their update at the top of a message that already says which match
              // it is about. Recipients go in BCC — see openGroupEmail.
              body={[
                '',
                '',
                '—',
                formatFullWhen(match.date_time),
                match.location,
                match.location_detail ?? '',
              ]
                .filter((line, index) => index < 3 || line.length > 0)
                .join('\n')}
            />
          </View>
        ) : null}
      </SheetSection>

      {/* `entitled` is re-tested here rather than by clearing the state, so that
          someone who leaves the match stops seeing the details even though the
          fetched copy is still in hand. Clearing in the effect body would be a
          synchronous setState, which cascades a render. */}
      {entitled && contact && (contact.email || contact.phone) ? (
        <SheetSection title={isHost ? 'What players see' : 'Reach the host'}>
          <Text style={[text.meta, { color: colors.inkMuted }]}>
            {isHost
              ? 'Everyone seated at this match can see these, so they can reach you.'
              : `${contact.name ?? 'The host'} is running this match.`}
          </Text>
          <ContactRows contact={contact} />
        </SheetSection>
      ) : null}

      <SheetSection title="Tiles">
        <Text style={[text.meta, { color: colors.inkMuted }]}>
          {match.supplies_provided
            ? 'The host is providing tiles and racks.'
            : 'Nobody has said they are bringing tiles — check with the host.'}
        </Text>
      </SheetSection>

      {match.notes ? (
        <SheetSection title="From the host">
          <Text style={[text.meta, { color: colors.inkMuted }]}>{match.notes}</Text>
        </SheetSection>
      ) : null}

      {/* Only what this member can actually do. The host gets Edit, which is where
          cancelling and deleting live; everyone else gets whichever seat control the
          screen passed in, or nothing — and with nothing, no footer rule either. */}
      {action || canEdit ? (
        <SheetFooter>
          {action}
          {canEdit ? <Button variant="dark" icon="pencil" label="Edit match" onPress={onEdit!} /> : null}
        </SheetFooter>
      ) : null}
    </Sheet>
  );
}

/**
 * The directions link. Outlined rather than filled: it leaves the app, and the
 * things worth filling in a sheet are the ones that act on what you are reading.
 */
export function MapLink({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: React.ComponentProps<typeof View>['style'];
}) {
  return (
    <View style={style}>
      <Button
        variant="outline"
        size="sm"
        icon="pin"
        label="Open in Google Maps"
        onPress={onPress}
      />
    </View>
  );
}
