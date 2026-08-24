import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar, EmptySeat } from '@/components/avatar';
import { QuietButton } from '@/components/button';
import { ContactRows } from '@/components/contact-rows';
import { EmailGroupButton } from '@/components/email-group-button';
import { Icon } from '@/components/icon';
import { Sheet, SheetFooter, SheetSection, SheetTitle } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { LeagueColors, Radius, Spacing, type LeagueColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const theme = useTheme();
  const empty = Math.max(0, SEATS_PER_MATCH - match.players.length);

  return (
    <View style={styles.roster}>
      {match.players.map((player) => (
        <View key={player.player_id} style={styles.rosterRow}>
          <Avatar person={player.profile ?? { name: null }} size={36} ring={theme.rule} />
          <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.rosterName}>
            {player.profile?.name ?? 'Unnamed member'}
            {player.player_id === userId ? ' (you)' : ''}
          </ThemedText>
          {player.player_id === match.host_id ? (
            <ThemedText type="label" style={{ color: theme.accentWarmInk }}>
              Host
            </ThemedText>
          ) : null}

          {/* On the member's own row, where taking a seat just put their name —
              rather than at the foot of the sheet, where it read as one more grey
              glyph in a row of controls and was missed. Same icons and same states
              as My Matches, so the calendar is one recognisable thing everywhere. */}
          {player.player_id === userId && onAddToCalendar ? (
            <QuietButton
              icon={calendarSent ? 'calendarCheck' : 'calendarPlus'}
              label={calendarSent ? 'Already sent to calendar — send again' : 'Add to calendar'}
              onPress={onAddToCalendar}
              tone={calendarSent ? 'done' : 'accent'}
            />
          ) : null}
        </View>
      ))}

      {/* Rings rather than a "2 seats left" line, so the shape of the table is the
          thing you read. The count is in the section heading for anyone who wants
          it as a number. */}
      {Array.from({ length: empty }, (_, seat) => (
        <View key={`open-${seat}`} style={styles.rosterRow}>
          <EmptySeat size={36} ring={theme.rule} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.rosterName}>
            Open seat
          </ThemedText>
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
  const theme = useTheme();
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
      <SheetTitle
        title={match.location}
        onClose={onClose}
        eyebrow={
          match.league ? (
            <View style={styles.leagueTag}>
              <View
                style={[
                  styles.leagueDot,
                  {
                    backgroundColor:
                      LeagueColors[match.league.color as LeagueColor] ?? theme.accent,
                  },
                ]}
              />
              <ThemedText type="label" themeColor="textSecondary">
                {match.league.name}
                {match.table_number ? ` · Table ${match.table_number}` : ''}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="label" themeColor="textSecondary">
              Pick-up match
            </ThemedText>
          )
        }
      />

      {/* Said once, plainly, rather than left to the edge bar's colour — the bar is
          not in view from inside the sheet. */}
      {match.status === 'canceled' ? (
        <ThemedText type="smallBold" style={{ color: theme.danger }}>
          This match was called off by the host.
        </ThemedText>
      ) : null}
      {match.status === 'completed' ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          Played. Scores are on the Leaderboard.
        </ThemedText>
      ) : null}

      <SheetSection title="When">
        <ThemedText type="defaultSemiBold">{formatFullWhen(match.date_time)}</ThemedText>
      </SheetSection>

      <SheetSection title="Where">
        <ThemedText type="defaultSemiBold">{match.location}</ThemedText>
        {/* The whole address, unwrapped. On a card this is one truncated line,
            which is exactly what somebody about to drive there does not need. */}
        {match.location_detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {match.location_detail}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No street address given — ask the host if you need one.
          </ThemedText>
        )}
        {typeof distance === 'number' ? (
          <ThemedText type="small" style={{ color: theme.accentInk }}>
            {formatMiles(distance)}
          </ThemedText>
        ) : null}

        {/* Offered only when there is a real address to open. See canMap: a link is
            worse than no link when all it can search for is a venue somebody named
            themselves. */}
        {canMap(match) ? <MapLink onPress={() => openMap(match)} /> : null}
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
          <View style={styles.emailPlayers}>
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
          <ThemedText type="small" themeColor="textSecondary">
            {isHost
              ? 'Everyone seated at this match can see these, so they can reach you.'
              : `${contact.name ?? 'The host'} is running this match.`}
          </ThemedText>
          <ContactRows contact={contact} />
        </SheetSection>
      ) : null}

      <SheetSection title="Tiles">
        <ThemedText type="small" themeColor="textSecondary">
          {match.supplies_provided
            ? 'The host is providing tiles and racks.'
            : 'Nobody has said they are bringing tiles — check with the host.'}
        </ThemedText>
      </SheetSection>

      {match.notes ? (
        <SheetSection title="From the host">
          <ThemedText type="small" themeColor="textSecondary">
            {match.notes}
          </ThemedText>
        </SheetSection>
      ) : null}

      {/* Only what this member can actually do. The host gets Edit, which is where
          cancelling and deleting live; everyone else gets whichever seat control the
          screen passed in, or nothing — and with nothing, no footer rule either. */}
      {action || canEdit ? (
        <SheetFooter>
          {action}
          {canEdit ? (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.editButton,
                { backgroundColor: theme.accentButton },
                pressed && styles.pressed,
              ]}>
              <Icon name="pencil" color={theme.onAccentButton} size={16} />
              <ThemedText type="smallBold" style={{ color: theme.onAccentButton }}>
                Edit match
              </ThemedText>
            </Pressable>
          ) : null}
        </SheetFooter>
      ) : null}
    </Sheet>
  );
}

/**
 * The directions link. Outlined rather than filled: it leaves the app, and the
 * things worth filling in a sheet are the ones that act on what you are reading.
 */
export function MapLink({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel="Open this venue in Google Maps"
      style={({ pressed }) => [
        styles.mapLink,
        { borderColor: theme.rule },
        pressed && styles.pressed,
      ]}>
      <Icon name="pin" color={theme.accentInk} size={16} />
      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
        Open in Google Maps
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  leagueTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  leagueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    marginTop: Spacing.two,
    minHeight: 40,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.pill,
  },
  roster: {
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  emailPlayers: {
    marginTop: Spacing.three,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rosterName: {
    flex: 1,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 40,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
  },
  pressed: {
    opacity: 0.7,
  },
});
