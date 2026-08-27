import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { Avatar, EmptySeat } from '@/components/avatar';
import { ChangeNoticePrompt } from '@/components/change-notice-prompt';
import { ContactRows } from '@/components/contact-rows';
import { EmailGroupButton } from '@/components/email-group-button';
import { Icon } from '@/components/icon';
import { PlaceAutocompleteInput } from '@/components/place-autocomplete-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, LeagueColors, OnAccent, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createSeason,
  createSessions,
  deleteLeague,
  deleteSession,
  drawSession,
  fetchLeagueFootprint,
  fetchLeagueMembers,
  fetchSeasons,
  fetchSessions,
  fetchSessionTables,
  hasUnseenRoleChange,
  inviteUrlFor,
  leaveLeague,
  acknowledgeRoleChange,
  setLeagueArchived,
  setLeagueRole,
  updateLeagueVisibility,
  updateSession,
  type LeagueFootprint,
  type LeagueMember,
  type LeagueRole,
  type LeagueSession,
  type MyLeague,
  type SessionTable,
  type Season,
} from '@/lib/leagues';
import {
  EmptyAttendance,
  fetchSessionAttendance,
  openSessionToSubs,
  setAttendance,
  type Availability,
  type SessionAttendance,
} from '@/lib/attendance';
import { changeNotice, changesBetween, type Change } from '@/lib/change-notice';
import {
  fetchLeagueMemberEmails,
  fetchLeagueOrganizerContact,
  fetchMyContact,
  fetchMyEmail,
  openGroupEmail,
  type Contact,
  type Recipient,
} from '@/lib/contact';
import { type Coordinates } from '@/lib/geo';
import { formatTimeOfDay, formatWhen, parseTimeOfDay, SEATS_PER_MATCH } from '@/lib/matches';
import { fetchPlaceLocation } from '@/lib/places';
import {
  describeMonthly,
  expandDates,
  Frequencies,
  formatDateOnly,
  MaxOccurrences,
  type Frequency,
} from '@/lib/recurrence';

/** Local wall-clock date, matching the match sheet's field. */
function localDateISO(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function todayISO() {
  return localDateISO(new Date());
}

function toTimestamp(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  const clock = parseTimeOfDay(time);
  if (!clock) return null;

  const [year, month, day] = date.trim().split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const at = new Date(year, month - 1, day, clock.hour, clock.minute);
  if (at.getMonth() !== month - 1 || at.getDate() !== day) return null;

  return at.toISOString();
}

/**
 * Everything about one league: who is in it, the link that adds people, and the
 * season's meetups with the draw that seats everyone.
 */
export function LeagueDetail({
  league,
  userId,
  onBack,
  onChanged,
}: {
  league: MyLeague;
  userId: string;
  onBack: () => void;
  /** Called when membership changes, so the list behind this can refresh. */
  onChanged: () => void;
}) {
  const theme = useTheme();
  /**
   * The league's own colour. A fill only — bars, filled buttons, a chosen chip's
   * border. Never type: four of the six league colours are pastels sitting between
   * 1.4:1 and 2.5:1 on white, which had "ORGANIZER" and "+ NEW SEASON" rendering
   * as pale yellow on white. Labels use `accentInk`; the league's identity is
   * carried by the shapes around them.
   */
  const tint = LeagueColors[league.color] ?? theme.accent;
  const isOrganizer = league.role === 'organizer';
  /**
   * An admin in global view reading a league they do not belong to. Not a role —
   * see LeagueRelation — and deliberately not folded into `isOrganizer`, because
   * the two answer different questions: whether controls appear, and whether the
   * screen may claim this account is in the league.
   */
  const isViewer = league.role === 'viewer';
  /**
   * An archived league is read-only: no new seasons, no new meetups, no draws, and
   * nobody joining through either door. Everything already in it stays visible,
   * which is the point of archiving rather than deleting.
   */
  const isArchived = league.archived_at !== null;
  /** Organizers may act on the league itself; members may only leave it. */
  const canRun = isOrganizer && !isArchived;

  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<LeagueSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Local so the notice goes the instant it is answered. See showRoleNotice. */
  const [roleNoticeDismissed, setRoleNoticeDismissed] = useState(false);

  const [isPublic, setIsPublic] = useState(league.is_public);
  const [maxMembers, setMaxMembers] = useState(
    league.max_members === null ? '' : String(league.max_members)
  );

  const [isAddingSession, setIsAddingSession] = useState(false);
  const [sessionDate, setSessionDate] = useState(todayISO());
  const [sessionTime, setSessionTime] = useState('7:00 pm');
  /**
   * How often the meetup repeats, and when it stops. A league that meets every
   * Tuesday should not have to add its season one Tuesday at a time.
   *
   * The pattern is expanded into ordinary meetups at the moment it is submitted —
   * there is no series to belong to afterwards. See lib/recurrence.
   */
  const [sessionRepeat, setSessionRepeat] = useState<Frequency>('once');
  const [sessionUntil, setSessionUntil] = useState('');
  /**
   * The meetup being edited, which reuses the fields above rather than keeping a
   * second copy of them. One form, two jobs: the difference is only that a repeat
   * makes no sense for a meetup that already exists.
   */
  const [editingSession, setEditingSession] = useState<LeagueSession | null>(null);
  /** Set between saving a moved meetup and answering the offer to announce it. */
  const [changes, setChanges] = useState<Change[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  /**
   * Availability for the meetups on screen, keyed by meetup. Loaded alongside them
   * rather than folded into `fetchSessions`, because the counts come from a view
   * over the whole roster and "what did I say" is one row of another table.
   */
  const [attendance, setAttendance_] = useState<Record<string, SessionAttendance>>({});
  /**
   * The instant "has this meetup been and gone" is measured against. Captured when
   * the screen loads rather than read while rendering, which the React compiler
   * refuses outright — the same reason `loadedAt` exists on My Matches.
   */
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  /**
   * The meetup whose seating is open, and the tables themselves.
   *
   * One at a time. A season of expanded meetups is a wall of faces nobody is
   * reading, and the question this answers — who is at which table — is always
   * about one evening.
   */
  const [openSeating, setOpenSeating] = useState<string | null>(null);
  const [tables, setTables] = useState<SessionTable[]>([]);
  const [sessionDetail, setSessionDetail] = useState<string | null>(null);
  const [sessionVenue, setSessionVenue] = useState('');
  /**
   * The meetup's position, resolved when a suggestion is picked. This is what
   * Browse measures a public league's distance against, so a league that wants to
   * be findable wants its meetups picked from the list rather than typed.
   */
  const [sessionAt, setSessionAt] = useState<Coordinates | null>(null);

  /**
   * What deleting would destroy. Read for organizers only, and only so the
   * confirmation can state counts instead of gesturing at "all data" — which is
   * the difference between a warning somebody reads and one they click past.
   */
  const [footprint, setFootprint] = useState<LeagueFootprint | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  /**
   * How to reach the organizer. Only members get an answer — this whole screen is
   * members-only, so in practice it is always available; the check lives in the
   * database rather than here because that is where it has to hold.
   */
  const [organizer, setOrganizer] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    try {
      const [roster, found] = await Promise.all([
        fetchLeagueMembers(league.id),
        fetchSeasons(league.id),
      ]);
      setMembers(roster);
      setSeasons(found);
      setLoadedAt(Date.now());

      // Default to the season being played rather than the newest, which may
      // already be finished.
      const active = found.find((season) => season.status === 'active') ?? found[0] ?? null;
      setSeasonId((current) => current ?? active?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this league.');
    }

    // Never throws, and deliberately after the block above: neither of these is
    // worth failing the screen over. The footprint only decides what the delete
    // confirmation is allowed to say, and a missing contact card is a missing
    // card rather than a broken league.
    setOrganizer(await fetchLeagueOrganizerContact(league.id));

    if (isOrganizer) {
      setFootprint(await fetchLeagueFootprint(league.id).catch(() => null));
    }
  }, [isOrganizer, league.id]);

  /**
   * What the screen is showing, kept in refs so the focus effect below can read
   * the current values without listing them as dependencies. Naming them there
   * would re-arm the effect — and re-run the whole load — every time somebody
   * merely opened a seating panel.
   */
  const openSeatingRef = useRef(openSeating);
  const seasonIdRef = useRef(seasonId);

  useEffect(() => {
    openSeatingRef.current = openSeating;
  }, [openSeating]);

  useEffect(() => {
    seasonIdRef.current = seasonId;
  }, [seasonId]);

  /**
   * Re-reads the league whenever the screen is returned to.
   *
   * This screen used to load once and then never again, which made it the only
   * one in the app that could sit indefinitely on data somebody else had already
   * replaced. A member who expanded a meetup's seating and left it open kept that
   * snapshot for as long as the screen stayed mounted: an organizer could redraw
   * the tables from their own phone and the member would go on being shown the
   * draw they were no longer in, with no way to tell and nothing to press.
   *
   * The seating is refreshed alongside the rest rather than left to be reopened,
   * because it is the part most likely to have moved and the part whose staleness
   * is least visible — a roster that is a week out of date looks like a roster.
   *
   * Focus, not an interval. The tables change a handful of times a season, and
   * anybody who has navigated back to this screen is about to read it.
   */
  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        await load();
        if (!active) return;
        setIsLoading(false);

        // Both of these are quiet on failure for the same reason as `load`'s own
        // tail: what is already on screen is better than replacing a league with
        // an error because one of two follow-up reads did not land.
        const season = seasonIdRef.current;
        if (season) {
          try {
            const found = await fetchSessions(season);
            if (active) setSessions(found);
          } catch {
            // Keep the meetups already shown.
          }
        }

        const open = openSeatingRef.current;
        if (open) {
          try {
            const fresh = await fetchSessionTables(open);
            if (active) setTables(fresh);
          } catch {
            // Keep the seating already shown.
          }
        }
      })();

      return () => {
        active = false;
      };
    }, [load])
  );

  useEffect(() => {
    let active = true;

    (async () => {
      if (!seasonId) {
        if (active) setSessions([]);
        return;
      }

      try {
        const found = await fetchSessions(seasonId);
        if (active) setSessions(found);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load meetups.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [seasonId]);

  const reloadSessions = useCallback(async () => {
    if (!seasonId) return;
    const found = await fetchSessions(seasonId);
    setSessions(found);
    // Never fatal: a league screen without its counts is still a league screen,
    // and the meetups themselves have already arrived.
    setAttendance_(
      await fetchSessionAttendance(
        found.map((session) => session.id),
        userId
      ).catch(() => ({}))
    );
  }, [seasonId, userId]);

  /**
   * Answer for a meetup. After a draw this also gives the seat up, which is the
   * whole point — a table still showing four people is how an organizer fails to
   * notice they are short.
   */
  const answer = async (session: LeagueSession, status: Availability) => {
    setBusy(`rsvp-${session.id}`);
    try {
      await setAttendance(session.id, status);
      await reloadSessions();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Re-reads the open seating panel, if it is the one that just changed.
   *
   * Everything that rearranges a meetup goes through here. `reloadSessions`
   * refreshes the summary above the panel — the table count, the subs flag — and
   * used to be the only thing a redraw called, so the summary would say "3 tables
   * drawn" over a panel still showing the draw that had just been replaced. The
   * seats are held in their own state and nothing was refilling it.
   *
   * That is not a cosmetic staleness: an organizer shuffles precisely because the
   * seating is wrong, and the screen answered by showing them the arrangement
   * they had just discarded, with the players they were trying to move still
   * sitting where they were.
   */
  const refreshSeating = async (sessionId: string) => {
    if (openSeating !== sessionId) return;
    setTables(await fetchSessionTables(sessionId));
  };

  /**
   * Show the seating for a meetup, or put it away.
   *
   * Reloaded on every open rather than cached: a draw, a redraw and somebody
   * dropping out all change it, and stale faces would be worse than a moment's
   * wait — this is the screen an organizer checks precisely because they think
   * something has moved.
   */
  const toggleSeating = async (session: LeagueSession) => {
    if (openSeating === session.id) {
      setOpenSeating(null);
      setTables([]);
      return;
    }

    setBusy(`seating-${session.id}`);
    try {
      setTables(await fetchSessionTables(session.id));
      setOpenSeating(session.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the tables.');
    } finally {
      setBusy(null);
    }
  };

  const toggleSubs = async (session: LeagueSession) => {
    setBusy(`subs-${session.id}`);
    try {
      await openSessionToSubs(session.id, session.subs_open === 0);
      await reloadSessions();
      await refreshSeating(session.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change that.');
    } finally {
      setBusy(null);
    }
  };

  const copyInvite = async () => {
    await Clipboard.setStringAsync(inviteUrlFor(league));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addSeason = async () => {
    setBusy('season');
    try {
      const name = `Season ${seasons.length + 1}`;
      const id = await createSeason(league.id, name);
      setSeasons([{ id, name, status: 'active' }, ...seasons]);
      setSeasonId(id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add a season.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * What the form would create if it were submitted now — one date for a one-off,
   * the whole run for a repeat.
   *
   * Computed during render rather than on submit so the form can say how many
   * meetups the button is about to make. Pure: it reads the three fields and does
   * calendar arithmetic, with no clock of its own.
   */
  const plan = expandDates(sessionDate, sessionUntil, sessionRepeat);

  const addSession = async () => {
    if (!seasonId) return;

    // Every date the pattern lands on. A one-off is the same code path with a
    // single date in it, so there is no second way to add a meetup to get wrong.
    const stamps = plan.dates
      .map((date) => toTimestamp(date, sessionTime))
      .filter((stamp): stamp is string => stamp !== null);

    if (stamps.length === 0 || stamps.length !== plan.dates.length) {
      setError(
        sessionRepeat === 'once'
          ? 'Give the meetup a date and a time like 6:30 pm.'
          : 'Give the run a first date, a time like 6:30 pm, and an end date on or after the first.'
      );
      return;
    }
    if (sessionVenue.trim().length === 0) {
      setError('Give the meetup a venue.');
      return;
    }

    /**
     * Carries on past the highest number already used rather than counting the
     * rows. `league_sessions` is unique on `(season_id, sequence)`, so a season
     * whose second meetup was deleted would otherwise hand the next one a number
     * that is still taken and have the whole insert refused.
     */
    const nextSequence =
      sessions.reduce((highest, session) => Math.max(highest, session.sequence), 0) + 1;

    setBusy('session');
    try {
      await createSessions(
        seasonId,
        stamps.map((at, index) => ({
          sequence: nextSequence + index,
          date_time: at,
          // One venue for the whole run, which is what a league schedule
          // overwhelmingly is. Moving one week to a different room is then an
          // edit to that meetup rather than a reason not to use this.
          location: sessionVenue.trim(),
          location_detail: sessionDetail,
          latitude: sessionAt?.latitude ?? null,
          longitude: sessionAt?.longitude ?? null,
        }))
      );
      setIsAddingSession(false);
      setSessionVenue('');
      setSessionDetail(null);
      setSessionAt(null);
      setSessionRepeat('once');
      setSessionUntil('');
      await reloadSessions();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add those meetups.');
    } finally {
      setBusy(null);
    }
  };

  const draw = async (session: LeagueSession) => {
    setBusy(session.id);
    try {
      await drawSession(session.id);
      await reloadSessions();
      await refreshSeating(session.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not draw the tables.');
    } finally {
      setBusy(null);
    }
  };

  /** Opens the form on an existing meetup, with its own details in the fields. */
  const startEditing = (session: LeagueSession) => {
    const at = new Date(session.date_time);

    setEditingSession(session);
    setIsAddingSession(false);
    setSessionDate(localDateISO(at));
    setSessionTime(formatTimeOfDay(at));
    setSessionVenue(session.location);
    setSessionDetail(session.location_detail);
    // Cleared rather than carried over: the sheet has no coordinates for a venue
    // it did not just look up, and stale ones would put the meetup in the wrong
    // town. Re-picking the venue from the suggestions restores them.
    setSessionAt(null);
    setSessionRepeat('once');
    setError(null);
  };

  const stopEditing = () => {
    setEditingSession(null);
    setSessionVenue('');
    setSessionDetail(null);
    setSessionAt(null);
  };

  const saveSession = async () => {
    if (!editingSession) return;

    const at = toTimestamp(sessionDate, sessionTime);
    if (!at || sessionVenue.trim().length === 0) {
      setError('Give the meetup a date, a time like 6:30 pm, and a venue.');
      return;
    }

    const after = {
      date_time: at,
      location: sessionVenue.trim(),
      location_detail: sessionDetail,
      latitude: sessionAt?.latitude ?? null,
      longitude: sessionAt?.longitude ?? null,
    };

    setBusy('session');
    try {
      await updateSession(editingSession.id, after);
      const moved = changesBetween(editingSession, after);

      stopEditing();
      await reloadSessions();
      setError(null);

      // Only a change of when or where is worth interrupting anybody about; see
      // the same rule on the match sheet.
      if (moved.length > 0) {
        setChanges(moved);
        setRecipients((await fetchLeagueMemberEmails(league.id)).filter((who) => who.email));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change that meetup.');
    } finally {
      setBusy(null);
    }
  };

  const sendSessionNotice = async () => {
    const at = toTimestamp(sessionDate, sessionTime);
    if (!at) return;

    setBusy('notice');
    const { subject, body } = changeNotice({
      title: `${league.name} · ${sessionVenue.trim() || 'meetup'}`,
      changes,
      after: {
        date_time: at,
        location: sessionVenue.trim(),
        location_detail: sessionDetail,
      },
      where: 'My Matches',
      from: await fetchMyContact(),
    });

    const { omitted } = await openGroupEmail({
      self: await fetchMyEmail(),
      recipients,
      subject,
      body,
    });

    setBusy(null);
    if (omitted > 0) {
      setError(
        `${omitted} ${omitted === 1 ? 'address' : 'addresses'} did not fit in one message — tell them directly.`
      );
      return;
    }
    dismissNotice();
  };

  const dismissNotice = () => {
    setChanges([]);
    setRecipients([]);
  };

  const removeSession = async (session: LeagueSession) => {
    setBusy(session.id);
    try {
      await deleteSession(session.id);
      await reloadSessions();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove that meetup.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Writes both fields together, because they are one decision: a cap is
   * meaningless while the league is invite-only, and publishing without one is a
   * different offer than publishing with one.
   *
   * Optimistic on the switch so it does not lag a tap, and reverted if the write
   * fails — leaving a switch showing "open" on a league that is not would be worse
   * than a flicker.
   */
  const saveVisibility = async (nextPublic: boolean, nextMax: string) => {
    const previous = { isPublic, maxMembers };
    setIsPublic(nextPublic);
    setMaxMembers(nextMax);
    setBusy('visibility');

    try {
      await updateLeagueVisibility(league.id, {
        is_public: nextPublic,
        max_members: nextPublic && nextMax ? Number(nextMax) : null,
      });
      onChanged();
      setError(null);
    } catch (cause) {
      setIsPublic(previous.isPublic);
      setMaxMembers(previous.maxMembers);
      setError(cause instanceof Error ? cause.message : 'Could not change who can join.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Hands the league to another member, or takes it back.
   *
   * `onChanged` on every path, not only when it was your own row: the parent
   * holds this league's `role` and the screen's own controls are drawn from it,
   * so stepping down has to leave the list behind refreshed rather than showing a
   * league you no longer run as one you do.
   */
  const changeRole = async (member: LeagueMember, role: LeagueRole) => {
    setBusy(`role-${member.profile_id}`);
    try {
      await setLeagueRole(league.id, member.profile_id, role);
      await load();
      onChanged();
      setError(null);
    } catch (cause) {
      // The trigger's refusal is written for a person to read, so it is shown as
      // it comes rather than flattened into "could not change the role".
      setError(cause instanceof Error ? cause.message : 'Could not change that role.');
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    setBusy('leave');
    try {
      await leaveLeague(league.id, userId);
      onChanged();
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not leave this league.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Archive, or bring back. Stays on the screen either way rather than returning
   * to the list, because the state it just changed is stated at the top of this
   * one — going back would make the result invisible.
   */
  const toggleArchive = async () => {
    setBusy('archive');
    try {
      await setLeagueArchived(league.id, !isArchived);
      onChanged();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive this league.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await deleteLeague(league.id);
      onChanged();
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this league.');
      setIsConfirmingDelete(false);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Deleting is offered only while nothing has been played.
   *
   * The same rule as a host deleting a match: once there is a record other people
   * are in, it stops being one person's to erase, and archiving keeps the
   * standings intact. Until the footprint has loaded the answer is "no", because
   * offering an irreversible action on unknown data is the one mistake here that
   * cannot be undone.
   */
  const canDelete = isOrganizer && footprint !== null && footprint.played === 0;

  /**
   * Who runs the league, which decides whether stepping down is on offer. Counted
   * from the roster rather than tracked separately so it cannot disagree with the
   * rows the buttons are drawn on.
   */
  const organizers = members.filter((member) => member.role === 'organizer');

  /**
   * Hidden the moment it is dismissed rather than after the write comes back, so
   * the button does not sit there looking unpressed while a round trip finishes.
   * The server's answer only decides whether it stays gone next time.
   */
  const showRoleNotice = hasUnseenRoleChange(league) && !roleNoticeDismissed;

  const dismissRoleNotice = async () => {
    setRoleNoticeDismissed(true);
    try {
      await acknowledgeRoleChange(league.id);
      onChanged();
    } catch {
      // Swallowed on purpose. Failing to record that a notice was read is not
      // something to interrupt somebody with; the worst case is seeing it once
      // more, which is a good deal better than an error about a dismissed banner.
    }
  };

  /** Availability for one meetup, with zeroes until it has loaded. */
  const here = (session: LeagueSession) => attendance[session.id] ?? EmptyAttendance;

  /**
   * A meetup that has been and gone. Answering for last Tuesday is not a thing
   * anybody needs to do, and the row says so by simply not offering it.
   */
  const isPast = (session: LeagueSession) => new Date(session.date_time) < new Date(loadedAt);

  /**
   * The soonest meetup still to come, for prefilling a message to the members —
   * a change of plan is the commonest thing an organizer writes about. Drawn from
   * the season on screen, which is the one they are looking at.
   */
  const nextSession =
    sessions.find((session) => new Date(session.date_time) >= new Date()) ?? null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ThemedText type="label" themeColor="textSecondary">
          ← All leagues
        </ThemedText>
      </Pressable>

      <View style={styles.titleRow}>
        <View style={[styles.titleBar, { backgroundColor: tint }]} />
        <View style={styles.titleText}>
          <ThemedText type="title">{league.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {members.length} {members.length === 1 ? 'member' : 'members'} ·{' '}
            {isOrganizer
              ? 'You organize this'
              : isViewer
                ? 'Not a member — viewing'
                : 'You are a member'}
          </ThemedText>
        </View>
      </View>

      {/* Stated once, at the top, before anything below it looks broken for no
          apparent reason. */}
      {isArchived ? (
        <ThemedView
          type="backgroundSelected"
          style={[styles.notice, { borderColor: theme.accentWarm }]}>
          <Icon name="archive" color={theme.accentWarmInk} size={18} />
          <ThemedText type="small" style={[styles.noticeText, { color: theme.accentWarmInk }]}>
            Archived. The standings and every table played are still here, but the
            league is not listed anywhere, its invite link no longer works, and no
            new meetups can be added.
          </ThemedText>
        </ThemedView>
      ) : null}

      {/* What changed under them while they were away.

          Above the league rather than on Browse with the profile prompt: the news
          is about this league specifically, and it is only actionable next to the
          controls it just granted or took away. Dismissed explicitly rather than
          on sight — being handed a league is worth an acknowledgement, and a
          notice that clears itself as the screen scrolls past has not been read.
      */}
      {showRoleNotice ? (
        <ThemedView
          type="backgroundSelected"
          style={[styles.notice, { borderColor: theme.accentWarm }]}>
          {/* The group versus one of its members, which is the change itself. */}
          <Icon name={isOrganizer ? 'people' : 'person'} color={theme.accentWarmInk} size={18} />
          <View style={styles.noticeBody}>
            <ThemedText type="smallBold" style={{ color: theme.accentWarmInk }}>
              {isOrganizer
                ? `You now organize ${league.name}`
                : `You are no longer an organizer of ${league.name}`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isOrganizer
                ? 'You can move meetups, draw the tables, edit the league and make other members organizers. Whoever else organizes it still can too.'
                : 'You can still see everything and play. Changing meetups and drawing tables is back to the other organizers.'}
            </ThemedText>
          </View>
          <Pressable
            onPress={dismissRoleNotice}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this notice"
            style={({ pressed }) => [
              styles.roleButton,
              { borderColor: theme.accentWarm },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="label" style={{ color: theme.accentWarmInk }}>
              Got it
            </ThemedText>
          </Pressable>
        </ThemedView>
      ) : null}

      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}

      {isLoading ? <ActivityIndicator style={styles.centered} /> : null}

      {/* Invite link. Anyone with it can join, which is the whole mechanism —
          there is no separate approval step, by design.

          Hidden from a viewer. Everything else on this screen is something to
          read, but this is a capability: the link admits whoever opens it, so
          handing a Copy button to somebody with no standing in the league is
          offering them a way to change it after all. Reading a league should not
          come with the power to fill it. */}
      {isViewer ? null : (
      <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
        <ThemedText type="label" themeColor="textSecondary">
          Invite link
        </ThemedText>
        <ThemedText type="small" numberOfLines={1} style={styles.link}>
          {inviteUrlFor(league)}
        </ThemedText>
        <View style={styles.cardActions}>
          <Pressable
            onPress={copyInvite}
            disabled={isArchived}
            style={({ pressed }) => pressed && styles.pressed}>
            <View
              style={[
                styles.primaryButton,
                { backgroundColor: tint },
                isArchived && styles.disabled,
              ]}>
              <ThemedText type="label" style={styles.primaryLabel}>
                {copied ? 'Copied' : 'Copy link'}
              </ThemedText>
            </View>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {isArchived
            ? 'This link stops working while the league is archived. Unarchive it to let people join again.'
            : 'Anyone who opens this link and signs in joins the league.'}
        </ThemedText>
      </ThemedView>
      )}

      {/* Discoverability, organizers only. A member should not be able to publish
          a group they do not run. The database agrees — the update policy on
          leagues is organizer-only — so this is the UI matching the rule rather
          than the rule itself. */}
      {isOrganizer ? (
        <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <ThemedText type="label" themeColor="textSecondary">
                Open to join
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isArchived
                  ? 'Archived leagues are never listed, whichever way this is set. The setting is kept for when you bring it back.'
                  : isPublic
                    ? 'Listed in Browse for anyone signed in, until it is full.'
                    : 'Invite-only. Only people with the link above can join.'}
              </ThemedText>
            </View>
            <Switch
              value={isPublic}
              onValueChange={(next) => saveVisibility(next, maxMembers)}
              disabled={busy === 'visibility' || isArchived}
              trackColor={{ true: theme.accent, false: theme.rule }}
            />
          </View>

          {isPublic ? (
            <View style={styles.field}>
              <ThemedText type="label" themeColor="textSecondary">
                Member limit
              </ThemedText>
              <TextInput
                value={maxMembers}
                onChangeText={(next) => setMaxMembers(next.replace(/[^0-9]/g, ''))}
                // Saved on blur rather than per keystroke, so typing "12" does not
                // briefly publish a league capped at 1.
                onBlur={() => saveVisibility(isPublic, maxMembers)}
                placeholder="No limit"
                keyboardType="number-pad"
                placeholderTextColor={theme.placeholder}
                style={[styles.input, { color: theme.text, borderColor: theme.rule }]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {members.length} of {maxMembers || '∞'} taken. Blank means no limit.
              </ThemedText>
            </View>
          ) : null}
        </ThemedView>
      ) : null}

      <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
        <ThemedText type="label" themeColor="textSecondary">
          Members
        </ThemedText>
        {members.map((member) => {
          const theyOrganize = member.role === 'organizer';
          const isYou = member.profile_id === userId;
          /**
           * The last organizer keeps the role whatever the button says, because
           * the trigger refuses it — so the control is not drawn at all rather
           * than offered and then rejected. The note under the roster explains
           * the absence, which a missing button cannot do by itself.
           */
          const canChangeRole = canRun && (!theyOrganize || organizers.length > 1);

          return (
            <View key={member.profile_id} style={styles.memberRow}>
              <Avatar person={member.profile ?? { name: null }} size={32} ring={theme.rule} />
              <ThemedText type="default" numberOfLines={1} style={styles.memberName}>
                {member.profile?.name ?? 'Unnamed member'}
                {isYou ? ' (you)' : ''}
              </ThemedText>
              {theyOrganize ? (
                <ThemedText type="label" style={{ color: theme.accentInk }}>
                  Organizer
                </ThemedText>
              ) : null}

              {busy === `role-${member.profile_id}` ? (
                <ActivityIndicator />
              ) : canChangeRole ? (
                <Pressable
                  onPress={() => changeRole(member, theyOrganize ? 'member' : 'organizer')}
                  accessibilityRole="button"
                  // Spelled out rather than left to the button's two words, which
                  // read as an instruction with no object when a screen reader
                  // reaches them out of the row's context.
                  accessibilityLabel={
                    theyOrganize
                      ? isYou
                        ? 'Step down as organizer of this league'
                        : `Make ${member.profile?.name ?? 'this member'} a member again`
                      : `Make ${member.profile?.name ?? 'this member'} an organizer`
                  }
                  style={({ pressed }) => [
                    styles.roleButton,
                    { borderColor: theme.rule },
                    pressed && styles.pressed,
                  ]}>
                  {/* "Make member" rather than "Remove": next to a name, on a row
                      that an organizer can also delete people from, "remove" reads
                      as throwing them out of the league altogether. */}
                  <ThemedText type="label" themeColor="textSecondary">
                    {theyOrganize ? (isYou ? 'Step down' : 'Make member') : 'Make organizer'}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {/* Why the only organizer has no Step down button. Without this the
            control is simply missing on your own row, which reads as a bug. */}
        {canRun && organizers.length === 1 && isOrganizer ? (
          <ThemedText type="small" themeColor="textSecondary">
            You are the only organizer. Make someone else an organizer before you step down.
          </ThemedText>
        ) : null}

        {/* Writing to the league, for whoever runs it. Under the roster it reaches,
            and still offered on an archived league: telling members a season has
            been wound up is exactly when it is wanted. */}
        {isOrganizer && members.length > 1 ? (
          <View style={styles.emailMembers}>
            <EmailGroupButton
              label="Email members"
              gather={() => fetchLeagueMemberEmails(league.id)}
              subject={`${league.name} · update`}
              // The next meetup, when there is one, so the commonest message — a
              // change of plan — starts from the thing being changed.
              body={[
                '',
                '',
                '—',
                league.name,
                nextSession
                  ? `Next meetup: ${formatWhen(nextSession.date_time)} · ${nextSession.location}`
                  : '',
              ]
                .filter((line, index) => index < 3 || line.length > 0)
                .join('\n')}
            />
          </View>
        ) : null}

        {/* The organizer's details, for members of this league only. Worded from
            the reader's side: an organizer looking at their own league should see
            what everyone else can see about them, not be told how to email
            themselves. */}
        {organizer && (organizer.email || organizer.phone) ? (
          <View style={[styles.contactBlock, { borderColor: theme.rule }]}>
            <ThemedText type="label" themeColor="textSecondary">
              {isOrganizer ? 'What members see' : `Reach ${organizer.name ?? 'the organizer'}`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isOrganizer
                ? 'Everyone in this league can see these, so they can reach you.'
                : 'Visible to members of this league.'}
            </ThemedText>
            <ContactRows contact={organizer} />
          </View>
        ) : null}
      </ThemedView>

      {/* Seasons. A league with none yet shows nothing to switch between, so the
          picker only appears once there is a choice to make. */}
      <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
        <View style={styles.cardHeader}>
          <ThemedText type="label" themeColor="textSecondary">
            Season
          </ThemedText>
          {canRun ? (
            <Pressable onPress={addSeason} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="label" style={{ color: theme.accentInk }}>
                {busy === 'season' ? 'Adding…' : '+ New season'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {seasons.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {isOrganizer
              ? 'Add a season, then add the meetups in it.'
              : 'No season has been set up yet.'}
          </ThemedText>
        ) : (
          <View style={styles.chips}>
            {seasons.map((season) => {
              const selected = season.id === seasonId;
              return (
                <Pressable
                  key={season.id}
                  onPress={() => setSeasonId(season.id)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={selected ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.chip, { borderColor: selected ? tint : theme.rule }]}>
                    <ThemedText type="label" themeColor={selected ? 'text' : 'textSecondary'}>
                      {season.name}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>
        )}
      </ThemedView>

      {seasonId ? (
        <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
          <View style={styles.cardHeader}>
            <ThemedText type="label" themeColor="textSecondary">
              Meetups
            </ThemedText>
            {canRun ? (
              <Pressable
                onPress={() => {
                  // Editing and adding are the same fields, so leaving one has to
                  // put the other back rather than opening both at once.
                  if (editingSession) stopEditing();
                  else setIsAddingSession((current) => !current);
                }}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="label" style={{ color: theme.accentInk }}>
                  {isAddingSession || editingSession ? 'Cancel' : '+ Add meetup'}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {/* The offer to announce a move, once one is saved. Above the list, where
              the thing it is talking about is. */}
          {changes.length > 0 ? (
            <ChangeNoticePrompt
              changes={changes}
              recipients={recipients.length}
              busy={busy === 'notice'}
              onSend={sendSessionNotice}
              onSkip={dismissNotice}
            />
          ) : null}

          {isAddingSession || editingSession ? (
            <View style={styles.newSession}>
              <View style={styles.pair}>
                <TextInput
                  value={sessionDate}
                  onChangeText={setSessionDate}
                  placeholder="2026-09-05"
                  placeholderTextColor={theme.placeholder}
                  style={[
                    styles.input,
                    styles.pairItem,
                    { color: theme.text, borderColor: theme.rule },
                  ]}
                />
                <TextInput
                  value={sessionTime}
                  onChangeText={setSessionTime}
                  placeholder="7:00 pm"
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  style={[
                    styles.input,
                    styles.pairItem,
                    { color: theme.text, borderColor: theme.rule },
                  ]}
                />
              </View>
              {/* Repeating, for a league that meets on a schedule rather than
                  whenever someone gets round to it. Chips rather than a picker:
                  four choices, and the whole form is already this shape.

                  Absent while editing: a meetup that already exists is one date,
                  and "repeat this one weekly" would mean something the save cannot
                  do. */}
              {editingSession ? null : (
              <View style={styles.chips}>
                {Frequencies.map((option) => {
                  const selected = option.value === sessionRepeat;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setSessionRepeat(option.value)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView
                        type={selected ? 'backgroundSelected' : 'backgroundElement'}
                        style={[styles.chip, { borderColor: selected ? tint : theme.rule }]}>
                        <ThemedText type="label" themeColor={selected ? 'text' : 'textSecondary'}>
                          {option.label}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  );
                })}
              </View>
              )}

              {editingSession || sessionRepeat === 'once' ? null : (
                <View style={styles.field}>
                  <ThemedText type="label" themeColor="textSecondary">
                    Repeat until
                  </ThemedText>
                  <TextInput
                    value={sessionUntil}
                    onChangeText={setSessionUntil}
                    placeholder="2026-12-19"
                    placeholderTextColor={theme.placeholder}
                    style={[styles.input, { color: theme.text, borderColor: theme.rule }]}
                  />
                  {/* Monthly is read off the date rather than asked about
                      separately, so it has to say which rule it inferred — "the
                      first Tuesday" and "the 5th" are the same date in September
                      and different ones in October. */}
                  {sessionRepeat === 'monthly' && describeMonthly(sessionDate) ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Repeats on {describeMonthly(sessionDate)}.
                    </ThemedText>
                  ) : null}

                  {/* Says what will happen before it happens, because the button
                      is about to create rows in bulk and the only way to undo
                      forty of them is one at a time. */}
                  <ThemedText type="small" themeColor="textSecondary">
                    {plan.dates.length === 0
                      ? 'Add an end date on or after the first meetup.'
                      : `${plan.dates.length} ${
                          plan.dates.length === 1 ? 'meetup' : 'meetups'
                        }, ${formatDateOnly(plan.dates[0])} to ${formatDateOnly(
                          plan.dates[plan.dates.length - 1]
                        )}, all at the same time and venue.`}
                    {plan.capped ? ` Stops at ${MaxOccurrences} — run it again to carry on.` : ''}
                    {plan.skipped > 0
                      ? ` ${plan.skipped} ${
                          plan.skipped === 1 ? 'month has' : 'months have'
                        } no such day and ${plan.skipped === 1 ? 'is' : 'are'} skipped.`
                      : ''}
                  </ThemedText>
                </View>
              )}

              {/* Autocompleted rather than typed, so the meetup carries a
                  position — which is how far away Browse says this league is. */}
              <PlaceAutocompleteInput
                label="Venue"
                value={sessionVenue}
                onChangeText={(next) => {
                  setSessionVenue(next);
                  setSessionDetail(null);
                  setSessionAt(null);
                }}
                onSelectPlace={(suggestion) => {
                  setSessionVenue(suggestion.mainText);
                  setSessionDetail(suggestion.secondaryText);
                  setSessionAt(null);
                  fetchPlaceLocation(suggestion.placeId).then(setSessionAt);
                }}
                placeholder="Where everyone meets"
                kind="venue"
              />
              {/* Said before the button, not after it: an organizer moving a
                  meetup that has been drawn is moving other people's evening, and
                  that is worth knowing while deciding rather than afterwards. */}
              {editingSession && editingSession.tables > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {editingSession.tables} drawn{' '}
                  {editingSession.tables === 1 ? 'table moves' : 'tables move'} with it.
                  {editingSession.played
                    ? ' Tables already played keep the details they were played under.'
                    : ''}
                </ThemedText>
              ) : null}

              <Pressable
                onPress={editingSession ? saveSession : addSession}
                style={({ pressed }) => pressed && styles.pressed}>
                <View style={[styles.primaryButton, { backgroundColor: tint }]}>
                  <ThemedText type="label" style={styles.primaryLabel}>
                    {busy === 'session'
                      ? 'Saving…'
                      : editingSession
                        ? 'Save meetup'
                        : plan.dates.length > 1
                          ? `Add ${plan.dates.length} meetups`
                          : 'Add meetup'}
                  </ThemedText>
                </View>
              </Pressable>
            </View>
          ) : null}

          {sessions.length === 0 && !isAddingSession ? (
            <ThemedText type="small" themeColor="textSecondary">
              No meetups in this season yet.
            </ThemedText>
          ) : null}

          {sessions.map((session) => (
            <View key={session.id} style={[styles.sessionRow, { borderColor: theme.rule }]}>
              <View style={styles.sessionText}>
                <ThemedText type="defaultSemiBold">
                  {session.sequence}. {session.location}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatWhen(session.date_time)}
                </ThemedText>
                {session.tables === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Not drawn — {here(session).expected_tables}{' '}
                    {here(session).expected_tables === 1 ? 'table' : 'tables'} from who is coming
                  </ThemedText>
                ) : (
                  /* The line saying how many tables there are is the thing
                     somebody is looking at when they wonder who is at them, so it
                     is the control rather than a separate button competing with
                     the three already in this row. */
                  <Pressable
                    onPress={() => toggleSeating(session)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      openSeating === session.id ? 'Hide the tables' : 'Show who is at each table'
                    }
                    style={({ pressed }) => [styles.seatingToggle, pressed && styles.pressed]}>
                    <ThemedText type="small" style={{ color: theme.accentInk }}>
                      {session.tables} {session.tables === 1 ? 'table' : 'tables'} drawn
                      {session.played ? ' · played' : ''}
                    </ThemedText>
                    {busy === `seating-${session.id}` ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <View
                        style={openSeating === session.id ? styles.chevronOpen : undefined}>
                        <Icon name="chevronDown" color={theme.accentInk} size={14} />
                      </View>
                    )}
                  </Pressable>
                )}

                {openSeating === session.id ? (
                  <View style={styles.seating}>
                    {tables.map((table) => {
                      const empty = Math.max(0, SEATS_PER_MATCH - table.seats.length);
                      return (
                        <View
                          key={table.id}
                          style={[styles.table, { borderColor: theme.rule }]}>
                          <View style={styles.tableHeader}>
                            <ThemedText type="label" themeColor="textSecondary">
                              Table {table.table_number ?? '—'}
                            </ThemedText>
                            {/* The number that decides whether to look for a sub,
                                said plainly rather than left to be counted off
                                the faces below. */}
                            <ThemedText type="label" themeColor="textSecondary">
                              {table.seats.length}/{SEATS_PER_MATCH}
                            </ThemedText>
                            {table.needs_sub ? (
                              <ThemedText type="label" style={{ color: theme.accentWarmInk }}>
                                Open to subs
                              </ThemedText>
                            ) : null}
                            {table.status === 'completed' ? (
                              <ThemedText type="label" themeColor="textSecondary">
                                Played
                              </ThemedText>
                            ) : null}
                          </View>

                          {table.seats.map((seat) => (
                            <View key={seat.player_id} style={styles.seatRow}>
                              <Avatar
                                person={{ name: seat.name, avatar_url: seat.avatar_url }}
                                size={26}
                                ring={theme.rule}
                              />
                              <ThemedText type="small" numberOfLines={1} style={styles.seatName}>
                                {seat.name ?? 'Unnamed member'}
                                {seat.player_id === userId ? ' (you)' : ''}
                              </ThemedText>
                              {/* Whoever was dealt first, which is only who enters
                                  the scores — worth saying so nobody wonders. */}
                              {seat.player_id === table.host_id ? (
                                <ThemedText type="label" themeColor="textSecondary">
                                  Scores
                                </ThemedText>
                              ) : null}
                            </View>
                          ))}

                          {Array.from({ length: empty }, (_, seat) => (
                            <View key={`empty-${seat}`} style={styles.seatRow}>
                              <EmptySeat size={26} ring={theme.rule} />
                              <ThemedText type="small" themeColor="textSecondary">
                                Empty seat
                              </ThemedText>
                            </View>
                          ))}
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {/* Everyone in the league is in until they say otherwise, so this
                    is the roster minus the people who cannot make it. Organizers
                    only: a member answers for themselves rather than auditing the
                    roster. */}
                {isOrganizer ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {here(session).going} in
                    {here(session).not_going > 0 ? ` · ${here(session).not_going} out` : ''}
                  </ThemedText>
                ) : null}

                {session.subs_open > 0 ? (
                  <ThemedText type="label" style={{ color: theme.accentWarmInk }}>
                    {session.subs_open} {session.subs_open === 1 ? 'table' : 'tables'} open to subs
                  </ThemedText>
                ) : null}

                {/* Everybody answers, including the organizer — they play too.
                    Going is the default and stays unmarked until it is chosen, so
                    the row does not claim an answer nobody gave. */}
                {isPast(session) ? null : (
                  <View style={styles.rsvpRow}>
                    {busy === `rsvp-${session.id}` ? (
                      <ActivityIndicator />
                    ) : (
                      (['in', 'out'] as const).map((choice) => {
                        // See the same control on My Matches: going is shown as
                        // chosen until it is taken back.
                        const chosen = (here(session).mine ?? 'in') === choice;
                        const tone =
                          choice === 'in'
                            ? { fill: theme.going, ink: OnAccent }
                            : { fill: theme.danger, ink: theme.onAccentButton };
                        return (
                          <Pressable
                            key={choice}
                            onPress={() => answer(session, choice)}
                            style={({ pressed }) => pressed && styles.pressed}>
                            <ThemedView
                              type="backgroundElement"
                              style={[
                                styles.rsvpChip,
                                {
                                  borderColor: chosen ? tone.fill : theme.rule,
                                  backgroundColor: chosen ? tone.fill : undefined,
                                },
                              ]}>
                              <Icon
                                name={choice === 'in' ? 'check' : 'close'}
                                size={14}
                                color={chosen ? tone.ink : theme.textSecondary}
                              />
                              <ThemedText
                                type="label"
                                style={chosen ? { color: tone.ink } : undefined}
                                themeColor={chosen ? undefined : 'textSecondary'}>
                                {choice === 'in' ? 'Going' : "Can't make it"}
                              </ThemedText>
                            </ThemedView>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                )}
              </View>

              {canRun ? (
                <View style={styles.sessionActions}>
                  {busy === session.id ? (
                    <ActivityIndicator />
                  ) : (
                    <>
                      {/* Redrawing is allowed until a table has been played, which
                          the database enforces rather than this button. */}
                      <Pressable
                        onPress={() => draw(session)}
                        disabled={session.played}
                        accessibilityLabel={session.tables === 0 ? 'Draw tables' : 'Redraw tables'}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <View
                          style={[
                            styles.iconButton,
                            { backgroundColor: tint, borderColor: tint },
                            session.played && styles.disabled,
                          ]}>
                          <Icon name="shuffle" color={OnAccent} size={18} />
                        </View>
                      </Pressable>

                      {/* Offered whether or not the tables are drawn, because the
                          draw is exactly when moving it matters — the details are
                          already copied onto four matches by then. */}
                      <Pressable
                        onPress={() => startEditing(session)}
                        accessibilityLabel="Edit meetup"
                        style={({ pressed }) => pressed && styles.pressed}>
                        <ThemedView
                          type="backgroundElement"
                          style={[styles.iconButton, { borderColor: theme.rule }]}>
                          <Icon name="pencil" color={theme.textSecondary} size={18} />
                        </ThemedView>
                      </Pressable>

                      {/* Offered once there is a drawn table with an empty chair.
                          Before the draw there is nothing to open, and the fix for
                          being short beforehand is simply to draw fewer tables. */}
                      {session.tables > 0 && !session.played ? (
                        <Pressable
                          onPress={() => toggleSubs(session)}
                          accessibilityLabel={
                            session.subs_open > 0 ? 'Stop asking for subs' : 'Ask for subs'
                          }
                          style={({ pressed }) => pressed && styles.pressed}>
                          <ThemedView
                            type={session.subs_open > 0 ? 'backgroundSelected' : 'backgroundElement'}
                            style={[
                              styles.iconButton,
                              { borderColor: session.subs_open > 0 ? theme.accentWarm : theme.rule },
                            ]}>
                            <Icon
                              name="people"
                              color={session.subs_open > 0 ? theme.accentWarmInk : theme.textSecondary}
                              size={18}
                            />
                          </ThemedView>
                        </Pressable>
                      ) : null}

                      {session.tables === 0 ? (
                        <Pressable
                          onPress={() => removeSession(session)}
                          accessibilityLabel="Remove meetup"
                          style={({ pressed }) => pressed && styles.pressed}>
                          <ThemedView
                            type="backgroundElement"
                            style={[styles.iconButton, { borderColor: theme.rule }]}>
                            <Icon name="trash" color={theme.textSecondary} size={18} />
                          </ThemedView>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
            </View>
          ))}

          {/* The controls above are glyphs on 34px buttons, which is fine for the
              pencil and the bin and no use at all for the other two: nobody has
              ever seen a "draw the tables" icon before, and an organizer who does
              not press it never gets a season. So the legend shows the same mark
              beside what it does, rather than describing it in words that leave
              the reader matching prose to pictures. Organizers only — these are
              the only buttons a member cannot press. */}
          {canRun && sessions.length > 0 ? (
            <View style={styles.legend}>
              <View style={styles.legendRow}>
                <ThemedView
                  type="backgroundElement"
                  style={[styles.iconButton, { backgroundColor: tint, borderColor: tint }]}>
                  <Icon name="shuffle" color={OnAccent} size={18} />
                </ThemedView>
                <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
                  <ThemedText type="smallBold">Draw the tables.</ThemedText> Shuffles
                  everyone who is coming into tables of four and puts each table into
                  their My Matches. Press it again to reshuffle — until a table has
                  been played, after which it is refused so scores cannot be erased.
                </ThemedText>
              </View>

              <View style={styles.legendRow}>
                <ThemedView
                  type="backgroundElement"
                  style={[styles.iconButton, { borderColor: theme.rule }]}>
                  <Icon name="people" color={theme.textSecondary} size={18} />
                </ThemedView>
                <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
                  <ThemedText type="smallBold">Ask for subs.</ThemedText> Offers the
                  empty seats at this meetup&apos;s short tables to people outside the
                  league, who find them in Browse. Press it again to stop.
                </ThemedText>
              </View>
            </View>
          ) : null}
        </ThemedView>
      ) : null}

      {/* Winding the league up, organizers only.
          Archiving leads because it is the reversible one, and because it is
          almost always what "I'm done with this league" actually means. */}
      {isOrganizer ? (
        <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
          <ThemedText type="label" themeColor="textSecondary">
            Wind it up
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            {isArchived
              ? 'Bring the league back and it is listed and joinable again exactly as it was.'
              : 'Archiving keeps every season, table and score, and stops the league taking anyone new. You can undo it.'}
          </ThemedText>

          <View style={styles.cardActions}>
            <Pressable
              onPress={toggleArchive}
              disabled={busy === 'archive'}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type="backgroundElement"
                style={[styles.wideButton, { borderColor: theme.rule }]}>
                <Icon name="archive" color={theme.textSecondary} size={18} />
                <ThemedText type="label" themeColor="textSecondary">
                  {busy === 'archive'
                    ? 'Saving…'
                    : isArchived
                      ? 'Unarchive league'
                      : 'Archive league'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>

          {/* Deleting, when there is nothing played to lose. Two steps, and the
              second one counts what goes rather than warning in the abstract. */}
          <View style={[styles.removal, { borderColor: theme.rule }]}>
            {canDelete ? (
              isConfirmingDelete ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    This erases the league for all {members.length}{' '}
                    {members.length === 1 ? 'member' : 'members'}
                    {footprint && footprint.seasons > 0
                      ? `, along with ${footprint.seasons} ${
                          footprint.seasons === 1 ? 'season' : 'seasons'
                        }`
                      : ''}
                    {footprint && footprint.tables > 0
                      ? ` and ${footprint.tables} drawn ${
                          footprint.tables === 1 ? 'table' : 'tables'
                        }`
                      : ''}
                    . It cannot be undone. Matches somebody tagged with this league
                    stay, as pick-up games.
                  </ThemedText>
                  <View style={styles.removalActions}>
                    <Pressable
                      onPress={() => setIsConfirmingDelete(false)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedText type="label" themeColor="textSecondary">
                        Keep it
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={remove}
                      disabled={busy === 'delete'}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedText type="label" style={{ color: theme.danger }}>
                        {busy === 'delete' ? 'Deleting…' : 'Yes, delete this league'}
                      </ThemedText>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  onPress={() => setIsConfirmingDelete(true)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="label" style={{ color: theme.danger }}>
                    Delete league
                  </ThemedText>
                </Pressable>
              )
            ) : (
              // Not offered rather than offered-and-refused, and it says why.
              // Deleting here would cascade through the sessions and take the
              // recorded scores with them — see deleteLeague.
              <ThemedText type="small" themeColor="textSecondary">
                {footprint === null
                  ? 'Checking what this league holds…'
                  : `${footprint.played} ${
                      footprint.played === 1 ? 'table has' : 'tables have'
                    } been played, so this league can no longer be deleted — the scores are part of everyone's standings. Archive it instead.`}
              </ThemedText>
            )}
          </View>
        </ThemedView>
      ) : null}

      {/* Not offered to a viewer, who has nothing to leave. The delete policy
          would refuse it anyway, but an admin reading a league they are not in
          should not be shown a red button that claims otherwise. */}
      {league.role === 'viewer' ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.destructive}>
          You are not a member of this league. You are seeing it because global
          view is on.
        </ThemedText>
      ) : (
        <Pressable onPress={leave} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="label" style={[styles.destructive, { color: theme.danger }]}>
            {busy === 'leave' ? 'Leaving…' : 'Leave this league'}
          </ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  back: {
    minHeight: 32,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  /** The league's colour, stated once at the top so the tint below reads as its. */
  titleBar: {
    width: 6,
    alignSelf: 'stretch',
    minHeight: 44,
    borderRadius: 3,
  },
  titleText: {
    flex: 1,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    boxShadow: CardShadow,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  /** The archived banner: an outlined highlight rather than a card, so it reads as a state and not another section. */
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
  noticeText: {
    flex: 1,
  },
  /** Two lines rather than the archived notice's one, so they need spacing. */
  noticeBody: {
    flex: 1,
    gap: Spacing.one,
  },
  emailMembers: {
    marginTop: Spacing.two,
  },
  /** Ruled off from the roster above it: it is about one member, not all of them. */
  contactBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    marginTop: Spacing.one,
    gap: Spacing.half,
  },
  /** A labelled outline button, for an action that is neither primary nor destructive. */
  wideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    minHeight: 40,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /**
   * Outlined and quiet, sitting at the end of a member's row. Handing the league
   * over is consequential but rare, so it should be findable without competing
   * with the meetup controls above — the same reasoning as the map link.
   */
  roleButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    minHeight: 32,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
  },
  /** Separates the irreversible action from the reversible one above it. */
  removal: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    marginTop: Spacing.one,
    gap: Spacing.two,
  },
  removalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    minHeight: 44,
  },
  link: {
    fontFamily: 'monospace',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 40,
  },
  memberName: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  newSession: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  pair: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pairItem: {
    flex: 1,
  },
  input: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sessionText: {
    flex: 1,
  },
  /** Ruled off from the meetups, because it explains them rather than being one. */
  legend: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  legendText: {
    flexShrink: 1,
  },
  seatingToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 28,
  },
  /** The chevron points up once its section is open. */
  chevronOpen: {
    transform: [{ rotate: '180deg' }],
  },
  seating: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  table: {
    padding: Spacing.two,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 30,
  },
  seatName: {
    flexShrink: 1,
  },
  rsvpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
    minHeight: 34,
  },
  rsvpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    minHeight: 30,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sessionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  toggleText: {
    flex: 1,
    gap: Spacing.half,
  },
  field: {
    gap: Spacing.one,
  },
  primaryButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  primaryLabel: {
    color: OnAccent,
  },
  disabled: {
    opacity: 0.4,
  },
  destructive: {
    minHeight: 40,
    textAlignVertical: 'center',
  },
  centered: {
    marginTop: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
});
