import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar, EmptySeat } from '@/components/avatar';
import { ChangeNoticePrompt } from '@/components/change-notice-prompt';
import { ContactRows } from '@/components/contact-rows';
import { EmailGroupButton } from '@/components/email-group-button';
import { CardHeading, type PillSpec } from '@/components/kit/cards';
import {
  Button,
  GradientButton,
  IconButton,
  Pill,
  TextLink,
  Toggle,
} from '@/components/kit/controls';
import { FilterChip } from '@/components/kit/filters';
import { Icon as KitIcon } from '@/components/kit/icons';
import {
  Card,
  InfoNote,
  InsetWell,
  LeagueDot,
  ScreenScaffold,
  SectionHeader,
  TitleBlock,
} from '@/components/kit/layout';
import { StatTile } from '@/components/kit/tiles';
import {
  colors as designColors,
  pillTones as designPillTones,
  radius as designRadius,
  text as designText,
} from '@/constants/design';
import { PlaceAutocompleteInput } from '@/components/place-autocomplete-input';
import { ScoreEntrySheet } from '@/components/score-entry-sheet';
import { TablePlacement } from '@/components/table-placement';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LeagueColors, OnAccent, Radius, Spacing } from '@/constants/theme';
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
  setSessionSeating,
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
import {
  enterSessionScores,
  formatTimeOfDay,
  formatWhen,
  parseTimeOfDay,
  SEATS_PER_MATCH,
} from '@/lib/matches';
import { fetchPlaceDetails } from '@/lib/places';
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
 * A season's meetups and this member's availability for them.
 *
 * The two are read together everywhere, because a meetup row shows the answer
 * beside the date. Reading one without the other is not a partial screen, it is
 * a wrong one: with no attendance loaded every meetup falls back to the default,
 * and the default is Going — so a member who said they could not make it comes
 * back to the league and finds the row saying they are coming. It saved; the
 * screen simply never asked. They answer again, and the second answer is as
 * invisible as the first.
 */
async function fetchSeasonMeetups(seasonId: string, userId: string) {
  const sessions = await fetchSessions(seasonId);
  // Never fatal: a league screen without its counts is still a league screen,
  // and the meetups themselves have already arrived.
  const attendance = await fetchSessionAttendance(
    sessions.map((session) => session.id),
    userId
  ).catch(() => ({}));

  return { sessions, attendance };
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
  /**
   * The meetup whose cards are being entered, and its tables.
   *
   * Held separately from `tables` above, which belongs to the expanded seating and
   * would be emptied by collapsing it mid-entry. Fetched when the button is
   * pressed rather than kept for every meetup on screen: a season is a dozen of
   * them and this is wanted for one at a time.
   */
  /**
   * The meetup whose tables are being rearranged by hand, if any.
   *
   * Kept as an id rather than a boolean so it cannot survive being opened on a
   * different meetup: the editor holds a draft of one meetup's seating, and a
   * flag would carry that draft onto the next one somebody expanded.
   */
  const [placing, setPlacing] = useState<string | null>(null);
  const [scoringSession, setScoringSession] = useState<LeagueSession | null>(null);
  const [scoringTables, setScoringTables] = useState<SessionTable[]>([]);
  const [sessionDetail, setSessionDetail] = useState<string | null>(null);
  const [sessionVenue, setSessionVenue] = useState('');
  /**
   * The meetup's position, resolved when a suggestion is picked. This is what
   * Browse measures a public league's distance against, so a league that wants to
   * be findable wants its meetups picked from the list rather than typed.
   */
  const [sessionAt, setSessionAt] = useState<Coordinates | null>(null);
  /**
   * The venue's own clock, resolved from the same lookup as the position.
   *
   * Copied onto every table by the draw, and read only when a meetup turns into
   * email: the league screen renders times in the reader's device zone, which is
   * right, but the notification sender runs in UTC and has no device to ask.
   */
  const [sessionZone, setSessionZone] = useState<string | null>(null);

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
  /** The season the meetups below belong to, for the summary tile. */
  const activeSeason = seasons.find((season) => season.id === seasonId) ?? null;

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
            const found = await fetchSeasonMeetups(season, userId);
            if (active) {
              setSessions(found.sessions);
              setAttendance_(found.attendance);
            }
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
    }, [load, userId])
  );

  useEffect(() => {
    let active = true;

    (async () => {
      if (!seasonId) {
        if (active) {
          setSessions([]);
          setAttendance_({});
        }
        return;
      }

      try {
        const found = await fetchSeasonMeetups(seasonId, userId);
        if (active) {
          setSessions(found.sessions);
          setAttendance_(found.attendance);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load meetups.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [seasonId, userId]);

  const reloadSessions = useCallback(async () => {
    if (!seasonId) return;
    const found = await fetchSeasonMeetups(seasonId, userId);
    setSessions(found.sessions);
    setAttendance_(found.attendance);
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
      // An open editor holds a draft of the seating that is about to disappear.
      setPlacing(null);
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

  /**
   * Open the card for a whole meetup.
   *
   * The tables are loaded here rather than assumed from the row, because the row
   * knows only how many there are. What the sheet needs is who is sitting at each
   * one and what is already recorded against them — and a card prefilled with the
   * existing numbers is the difference between correcting one score and retyping
   * sixteen.
   *
   * Empty tables are dropped. A drawn meetup can carry one if everybody at it
   * dropped out, and a table with no seats is a heading with nothing under it.
   */
  const openScoring = async (session: LeagueSession) => {
    setBusy(`scores-${session.id}`);
    try {
      const found = await fetchSessionTables(session.id);
      setScoringTables(found.filter((table) => table.seats.length > 0));
      setScoringSession(session);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the tables.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Write a hand-made arrangement, and show it back.
   *
   * Both reloads matter and neither is optional. `fetchSessionTables` is what the
   * seating on screen is drawn from, and without it the organizer saves, the
   * editor closes, and the old arrangement is still sitting there — which reads as
   * the save having failed. `reloadSessions` is for the row above it, where the
   * count of tables can have changed by one.
   *
   * Awaited before the editor closes, so it never shuts onto stale seating.
   */
  const saveSeating = async (session: LeagueSession, arrangement: string[][]) => {
    await setSessionSeating(session.id, arrangement);
    setTables(await fetchSessionTables(session.id));
    await reloadSessions();
    setPlacing(null);
    setError(null);
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

  /**
   * Hands the invite link to the platform's share sheet — the design's header
   * action. Falls back to the clipboard where there is no share sheet worth the
   * name, which is the browser: `navigator.share` exists on some of them and not
   * others, and a copied link is never the wrong outcome here.
   */
  const shareInvite = async () => {
    const url = inviteUrlFor(league);
    try {
      if (Platform.OS === 'web') {
        await copyInvite();
        return;
      }
      await Share.share({ message: url, url });
    } catch {
      // A dismissed share sheet throws on some platforms. Nothing to report.
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
          time_zone: sessionZone,
        }))
      );
      setIsAddingSession(false);
      setSessionVenue('');
      setSessionDetail(null);
      setSessionAt(null);
      setSessionZone(null);
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
    setSessionZone(null);
    setSessionRepeat('once');
    setError(null);
  };

  const stopEditing = () => {
    setEditingSession(null);
    setSessionVenue('');
    setSessionDetail(null);
    setSessionAt(null);
    setSessionZone(null);
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
      time_zone: sessionZone,
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
    <>
      {/* The ribbon is placed a little tighter than the tab screens', per the
          handoff's placement table — this screen leads with a back button rather
          than an app mark, so the curve has less to clear. */}
      <ScreenScaffold ribbon="compact" ribbonStyle={{ top: -30, right: -90 }}>
        {/* Back and share. The share sheet hands over the same invite link the
            card below copies, so the two cannot describe different leagues. */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton icon="chevronLeft" accessibilityLabel="All leagues" onPress={onBack} />
          <View style={{ flex: 1 }} />
          {isViewer ? null : (
            <IconButton icon="share" accessibilityLabel="Share the invite link" onPress={shareInvite} />
          )}
        </View>

        <TitleBlock
          leading={<LeagueDot color={tint} size={10} />}
          eyebrow={
            isOrganizer
              ? 'You organize this'
              : isViewer
                ? 'Not a member — viewing'
                : `${members.length} ${members.length === 1 ? 'member' : 'members'}`
          }
          title={league.name}
          small
        />

        {/* Members, meetups and the season, as the tile motif — and the only one
            that is pressable is the one that opens a picker. */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile value={members.length} label={members.length === 1 ? 'Member' : 'Members'} edgeColor={designColors.teal} />
          <StatTile value={sessions.length} label={sessions.length === 1 ? 'Meetup' : 'Meetups'} edgeColor={designColors.yellow} />
          <StatTile
            value={activeSeason ? activeSeason.name.replace(/^Season\s*/i, '') : '—'}
            label="Season"
            edgeColor={designColors.coral}
            /* Not pressable. The handoff has this tile open a season picker sheet,
               which does not exist yet — the seasons are chosen from the row of
               chips below, which is what the app has always had. A tile that
               looked tappable and did nothing would be worse than a plain one. */
            accessibilityLabel={activeSeason ? `Season ${activeSeason.name}` : 'Season'}
          />
        </View>

      {/* Stated once, at the top, before anything below it looks broken for no
          apparent reason. */}
      {isArchived ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            padding: 14,
            borderRadius: designRadius.card,
            backgroundColor: designColors.yellow,
          }}>
          <KitIcon name="archive" color={designColors.ink} size={18} />
          <Text style={[designText.meta, { color: designColors.ink, flex: 1 }]}>
            Archived. The standings and every table played are still here, but the
            league is not listed anywhere, its invite link no longer works, and no
            new meetups can be added.
          </Text>
        </View>
      ) : null}

      {/* What changed under them while they were away.

          Above the league rather than on Browse with the profile prompt: the news
          is about this league specifically, and it is only actionable next to the
          controls it just granted or took away. Dismissed explicitly rather than
          on sight — being handed a league is worth an acknowledgement, and a
          notice that clears itself as the screen scrolls past has not been read.
      */}
      {showRoleNotice ? (
        <View
          style={{
            gap: 10,
            padding: 14,
            borderRadius: designRadius.card,
            backgroundColor: designColors.yellow,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            {/* The group versus one of its members, which is the change itself. */}
            <KitIcon name={isOrganizer ? 'users' : 'profile'} color={designColors.ink} size={18} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[designText.bodyStrong, { color: designColors.ink }]}>
                {isOrganizer
                  ? `You now organize ${league.name}`
                  : `You are no longer an organizer of ${league.name}`}
              </Text>
              <ThemedText type="small" themeColor="textSecondary">
                {isOrganizer
                  ? 'You can move meetups, draw the tables, edit the league and make other members organizers. Whoever else organizes it still can too.'
                  : 'You can still see everything and play. Changing meetups and drawing tables is back to the other organizers.'}
              </ThemedText>
            </View>
          </View>
          <Button variant="soft" size="sm" label="Got it" onPress={dismissRoleNotice} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}

      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}

      {isLoading ? <ActivityIndicator style={styles.centered} /> : null}

      {/* Seasons. A league with none yet shows nothing to switch between, so the
          picker only appears once there is a choice to make. */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            {activeSeason ? (
              <>
                Showing <ThemedText type="smallBold">{activeSeason.name}</ThemedText>
              </>
            ) : isOrganizer ? (
              'Add a season, then add the meetups in it.'
            ) : (
              'No season has been set up yet.'
            )}
          </ThemedText>
          {canRun ? (
            <TextLink
              icon="plus"
              label={busy === 'season' ? 'Adding…' : 'New season'}
              onPress={addSeason}
            />
          ) : null}
        </View>

        {/* Only once there is a choice to make. The summary tile above names the
            season either way. */}
        {seasons.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {seasons.map((season) => (
              <FilterChip
                key={season.id}
                label={season.name}
                selected={season.id === seasonId}
                onPress={() => setSeasonId(season.id)}
              />
            ))}
          </View>
        ) : null}
      </View>

      {seasonId ? (
        <>
          <SectionHeader
            title="Meetups"
            action={
              canRun ? (
                <TextLink
                  icon={isAddingSession || editingSession ? undefined : 'plus'}
                  label={isAddingSession || editingSession ? 'Cancel' : 'Add meetup'}
                  onPress={() => {
                    // Editing and adding are the same fields, so leaving one has to
                    // put the other back rather than opening both at once.
                    if (editingSession) stopEditing();
                    else setIsAddingSession((current) => !current);
                  }}
                />
              ) : null
            }
          />

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
            <Card gap={16}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  value={sessionDate}
                  onChangeText={setSessionDate}
                  placeholder="2026-09-05"
                  placeholderTextColor={designColors.placeholder}
                  style={[formFieldInput, { flex: 1 }]}
                />
                <TextInput
                  value={sessionTime}
                  onChangeText={setSessionTime}
                  placeholder="7:00 pm"
                  placeholderTextColor={designColors.placeholder}
                  autoCapitalize="none"
                  style={[formFieldInput, { flex: 1 }]}
                />
              </View>
              {/* Repeating, for a league that meets on a schedule rather than
                  whenever someone gets round to it. Chips rather than a picker:
                  four choices, and the whole form is already this shape.

                  Absent while editing: a meetup that already exists is one date,
                  and "repeat this one weekly" would mean something the save cannot
                  do. */}
              {editingSession ? null : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {Frequencies.map((option) => (
                    <FilterChip
                      key={option.value}
                      label={option.label}
                      selected={option.value === sessionRepeat}
                      onPress={() => setSessionRepeat(option.value)}
                    />
                  ))}
                </View>
              )}

              {editingSession || sessionRepeat === 'once' ? null : (
                <View style={{ gap: 6 }}>
                  <Text style={formFieldLabel}>REPEAT UNTIL</Text>
                  <TextInput
                    value={sessionUntil}
                    onChangeText={setSessionUntil}
                    placeholder="2026-12-19"
                    placeholderTextColor={designColors.placeholder}
                    style={formFieldInput}
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
                  setSessionZone(null);
                }}
                onSelectPlace={(suggestion) => {
                  setSessionVenue(suggestion.mainText);
                  setSessionDetail(suggestion.secondaryText);
                  setSessionAt(null);
                  setSessionZone(null);
                  fetchPlaceDetails(suggestion.placeId).then((details) => {
                    setSessionAt(details.location);
                    setSessionZone(details.timeZone);
                  });
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

              <GradientButton
                size="md"
                label={
                  busy === 'session'
                    ? 'Saving…'
                    : editingSession
                      ? 'Save meetup'
                      : plan.dates.length > 1
                        ? `Add ${plan.dates.length} meetups`
                        : 'Add meetup'
                }
                busy={busy === 'session'}
                onPress={editingSession ? saveSession : addSession}
              />
            </Card>
          ) : null}

          {sessions.length === 0 && !isAddingSession ? (
            <ThemedText type="small" themeColor="textSecondary">
              No meetups in this season yet.
            </ThemedText>
          ) : null}

          {/* One card per meetup, newest first — the organizer's weekly job, and
              the reason this section leads the screen. */}
          {sessions.map((session, index) => {
            const drawn = session.tables > 0;
            const expected = here(session).expected_tables;
            /**
             * §8's second open question, answered from the data: a table is
             * `completed` once its card is entered, and `played` is true as soon
             * as any table is. So a meetup whose date has gone by with tables
             * drawn and nothing played is precisely the one still owed its
             * scores.
             */
            const pills: PillSpec[] = session.played
              ? [{ label: 'Played', tone: 'neutral' }]
              : isPast(session) && drawn
                ? [{ label: 'Scores needed', tone: 'sub' }]
                : [];
            const drawLabel = drawn ? 'Reshuffle' : 'Draw tables';
            /* Scores are offered from the hour of the meetup rather than the end
               of it: nobody knows when a night finishes, and an organizer typing
               the card while the tables are still packing up is the case to
               design for. */
            const canScore = canRun && isPast(session) && drawn;
            /* The note explaining Draw and Ask subs, on the first meetup that
               still has them rather than on every card. The handoff puts it under
               each one; repeated down a season of six meetups it becomes a wall,
               and it is the same two sentences every time. */
            const firstActionable =
              sessions.findIndex((other) => !other.played) === index && canRun;

            return (
              <Card key={session.id}>
                <CardHeading
                  date={new Date(session.date_time)}
                  edgeColor={tint}
                  pills={pills}
                  title={`${session.sequence} · ${session.location}`}
                  meta={[
                    formatWhen(session.date_time),
                    isOrganizer
                      ? `${here(session).going} in${
                          here(session).not_going > 0 ? ` · ${here(session).not_going} out` : ''
                        }`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  leagueColor={tint}
                />

                {/* The line saying how many tables there are is the thing somebody
                    is looking at when they wonder who is at them, so it is the
                    control rather than a separate button. */}
                {drawn ? (
                  <Pressable
                    onPress={() => toggleSeating(session)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: openSeating === session.id }}
                    accessibilityLabel={
                      openSeating === session.id ? 'Hide the tables' : 'Show who is at each table'
                    }
                    style={{
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: designColors.bg,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 14,
                    }}>
                    <ThemedText type="label" style={{ color: designColors.link }}>
                      {session.tables} {session.tables === 1 ? 'table' : 'tables'} drawn
                      {session.played ? ' · played' : ''}
                    </ThemedText>
                    {busy === `seating-${session.id}` ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <View style={openSeating === session.id ? styles.chevronOpen : undefined}>
                        <KitIcon name="chevronDown" size={18} color={designColors.link} strokeWidth={2} />
                      </View>
                    )}
                  </Pressable>
                ) : (
                  <InsetWell>
                    <ThemedText type="small" themeColor="textSecondary">
                      Not drawn — {expected} {expected === 1 ? 'table' : 'tables'} from who is
                      coming
                    </ThemedText>
                  </InsetWell>
                )}


                {/* Rearranging the tables, in place of the read-only seating.
                    Not beside it: two seating views on screen at once, one of
                    which responds to taps, is how somebody edits the wrong one.
                    Organizers only, and not once a table has been played — the
                    database refuses that too, but a button that exists and is
                    always refused is worse than one that is not there. */}
                {openSeating === session.id && placing === session.id ? (
                  <TablePlacement
                    key={`placing-${session.id}`}
                    tables={tables}
                    tint={tint}
                    onCancel={() => setPlacing(null)}
                    onSave={(arrangement) => saveSeating(session, arrangement)}
                  />
                ) : null}

                {openSeating === session.id && placing !== session.id ? (
                  <View style={{ gap: 10 }}>
                    {canRun && !session.played ? (
                      <TextLink
                        icon="pencil"
                        label="Edit table placement"
                        onPress={() => setPlacing(session.id)}
                      />
                    ) : null}
                    {tables.map((table) => {
                      const empty = Math.max(0, SEATS_PER_MATCH - table.seats.length);
                      return (
                        <View
                          key={table.id}
                          style={{
                            gap: 8,
                            padding: 12,
                            borderRadius: designRadius.card,
                            backgroundColor: designColors.bg,
                          }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <ThemedText type="label" themeColor="textSecondary">
                              Table {table.table_number ?? '—'}
                            </ThemedText>
                            {/* The number that decides whether to look for a sub,
                                said plainly rather than left to be counted off
                                the faces below. */}
                            <ThemedText type="label" themeColor="textSecondary">
                              {table.seats.length}/{SEATS_PER_MATCH}
                            </ThemedText>
                            {table.needs_sub ? <Pill label="Open to subs" tone="hosting" /> : null}
                            {table.status === 'completed' ? <Pill label="Played" tone="neutral" /> : null}
                          </View>

                          {table.seats.map((seat) => (
                            <View key={seat.player_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <Avatar
                                person={{ name: seat.name, avatar_url: seat.avatar_url }}
                                size={28}
                                ring={designColors.white}
                              />
                              <ThemedText
                                type="small"
                                numberOfLines={1}
                                style={{ flex: 1, color: designColors.ink }}>
                                {seat.name ?? 'Unnamed member'}
                                {seat.player_id === userId ? ' (you)' : ''}
                              </ThemedText>
                              {/* Whoever was dealt first, which is only who enters
                                  the scores — worth saying so nobody wonders. */}
                              {seat.player_id === table.host_id ? (
                                <Text style={[designText.pill, { color: designColors.inkMuted }]}>
                                  SCORES
                                </Text>
                              ) : null}
                            </View>
                          ))}

                          {Array.from({ length: empty }, (_, seat) => (
                            <View key={`empty-${seat}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <EmptySeat size={28} ring={designColors.white} />
                              <Text style={[designText.meta, { color: designColors.inkMuted }]}>
                                Empty seat
                              </Text>
                            </View>
                          ))}
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {session.subs_open > 0 ? (
                  <Pill
                    label={`${session.subs_open} ${
                      session.subs_open === 1 ? 'table' : 'tables'
                    } open to subs`}
                    tone="hosting"
                  />
                ) : null}

                {/* Everybody answers, including the organizer — they play too.
                    Going is the default and stays unmarked until it is chosen, so
                    the row does not claim an answer nobody gave. */}
                {isPast(session) ? null : busy === `rsvp-${session.id}` ? (
                  <ActivityIndicator />
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <FilterChip
                      label="Going"
                      selected={(here(session).mine ?? 'in') === 'in'}
                      selectedTone="info"
                      onPress={() => answer(session, 'in')}
                    />
                    <FilterChip
                      label="Can't make it"
                      selected={(here(session).mine ?? 'in') === 'out'}
                      selectedTone="sub"
                      onPress={() => answer(session, 'out')}
                    />
                  </View>
                )}

                {canScore ? (
                  session.played ? (
                    /* `played` is true once *any* table is recorded, so a meetup
                       with three cards in and one outstanding says "Edit scores" —
                       which is right: the sheet opens on the three that are filled
                       and the one that is not. */
                    <Button
                      variant="outline"
                      size="md"
                      icon="scores"
                      label="Edit scores"
                      busy={busy === `scores-${session.id}`}
                      onPress={() => openScoring(session)}
                    />
                  ) : (
                    <GradientButton
                      size="md"
                      icon="plus"
                      label="Add scores"
                      onPress={() => openScoring(session)}
                    />
                  )
                ) : null}

                {canRun ? (
                  busy === session.id ? (
                    <ActivityIndicator />
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {/* Redrawing is allowed until a table has been played, which
                          the database enforces rather than this button. Once it is
                          refused, the control says so with a padlock rather than
                          fading out, which read as broken. */}
                      {session.played ? (
                        <IconButton
                          size={48}
                          icon="shuffle"
                          tone="draw"
                          locked
                          accessibilityLabel="Reshuffle locked: a table has been played"
                        />
                      ) : (
                        <Button
                          variant="draw"
                          icon="shuffle"
                          label={drawLabel}
                          onPress={() => draw(session)}
                          style={{ flex: 1, paddingHorizontal: 0 }}
                        />
                      )}

                      {/* Offered once there is a drawn table with an empty chair.
                          Before the draw there is nothing to open, and the fix for
                          being short beforehand is simply to draw fewer tables. */}
                      {drawn && !session.played ? (
                        <Button
                          variant="plain"
                          icon="users"
                          label="Ask subs"
                          active={session.subs_open > 0}
                          onPress={() => toggleSubs(session)}
                          style={{ flex: 1, paddingHorizontal: 0 }}
                        />
                      ) : null}

                      {/* Offered whether or not the tables are drawn, because the
                          draw is exactly when moving it matters — the details are
                          already copied onto four matches by then. */}
                      <Button
                        variant="plain"
                        icon="pencil"
                        label="Edit"
                        onPress={() => startEditing(session)}
                        style={{ flex: 1, paddingHorizontal: 0 }}
                      />

                      {!drawn ? (
                        <IconButton
                          size={48}
                          icon="archive"
                          accessibilityLabel="Remove meetup"
                          onPress={() => removeSession(session)}
                        />
                      ) : null}
                    </View>
                  )
                ) : null}

                {firstActionable && !session.played ? (
                  <InfoNote
                    rows={[
                      {
                        icon: 'shuffle',
                        chipBg: designPillTones.draw.bg,
                        chipFg: designPillTones.draw.fg,
                        term: drawLabel,
                        body:
                          'deals everyone coming into tables of four and adds each table to their ' +
                          "My Matches. It locks once a table is played, so scores can't be erased.",
                      },
                      {
                        icon: 'users',
                        chipBg: designColors.white,
                        chipFg: designColors.ink,
                        chipBorder: true,
                        term: 'Ask subs',
                        body:
                          "lists this meetup's empty seats in Browse for players outside the " +
                          'league. Tap again to stop.',
                      },
                    ]}
                  />
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

        <SectionHeader title="Members" />
      <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
        {members.map((member, index) => {
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
            <View
              key={member.profile_id}
              style={[
                styles.memberRow,
                index > 0 && {
                  borderTopWidth: 1,
                  borderTopColor: designColors.divider,
                  paddingTop: 12,
                },
              ]}>
              <Avatar person={member.profile ?? { name: null }} size={40} ring={designColors.white} />
              <ThemedText type="default" numberOfLines={1} style={styles.memberName}>
                {member.profile?.name ?? 'Unnamed member'}
                {isYou ? ' (you)' : ''}
              </ThemedText>
              {theyOrganize ? <Pill label="Organizer" tone="info" /> : null}

              {busy === `role-${member.profile_id}` ? (
                <ActivityIndicator />
              ) : canChangeRole ? (
                <Button
                  variant="plain"
                  size="xs"
                  /* "Make member" rather than "Remove": next to a name, on a row
                     that an organizer can also delete people from, "remove" reads
                     as throwing them out of the league altogether. */
                  label={theyOrganize ? (isYou ? 'Step down' : 'Make member') : 'Make organizer'}
                  onPress={() => changeRole(member, theyOrganize ? 'member' : 'organizer')}
                />
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
      </ThemedView>

      {/* Its own card, per the handoff — a mail chip, the label, then the address,
          rather than a block tucked under the roster. */}
      {organizer && (organizer.email || organizer.phone) ? (
        <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: designPillTones.info.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <KitIcon name="mail" size={17} color={designPillTones.info.fg} />
            </View>
            <ThemedText
              type="label"
              style={{ color: designPillTones.info.fg, letterSpacing: 0.88 }}>
              {isOrganizer ? 'EMAIL' : (organizer.name ?? 'ORGANIZER').toUpperCase()}
            </ThemedText>
          </View>
          <ContactRows contact={organizer} />
          <ThemedText type="small" themeColor="textSecondary">
            {isOrganizer
              ? 'Everyone in this league can see this, so they can reach you.'
              : 'Visible to members of this league.'}
          </ThemedText>
        </ThemedView>
      ) : null}

        {/* Invite and access together: the link that admits people and the switch
            that decides whether they have to be handed one. */}
        {isViewer ? null : <SectionHeader title="Invite & access" />}
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
        {/* A field showing the link with a dark Copy button sitting inside it, so
            the thing being copied and the way to copy it are one control. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: designColors.bg,
            borderRadius: 999,
            paddingLeft: 14,
            paddingRight: 4,
            paddingVertical: 4,
          }}>
          <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>
            {inviteUrlFor(league)}
          </ThemedText>
          <Button
            variant="dark"
            label={copied ? 'Copied' : 'Copy link'}
            disabled={isArchived}
            onPress={copyInvite}
          />
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
          <Toggle
            value={isPublic}
            onValueChange={(next) => saveVisibility(next, maxMembers)}
            disabled={busy === 'visibility' || isArchived}
            label="Open to join"
            description={
              isArchived
                ? 'Archived leagues are never listed, whichever way this is set. The setting is kept for when it is unarchived.'
                : isPublic
                  ? 'Listed in Browse for anyone signed in, until it is full.'
                  : 'Invite-only. Only people with the link above can join.'
            }
          />

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

      {/* Winding the league up, organizers only.
          Archiving leads because it is the reversible one, and because it is
          almost always what "I'm done with this league" actually means. */}
      {isOrganizer ? (
        <>
          <SectionHeader title="Wind it up" />
          <ThemedView type="background" style={[styles.card, { borderColor: theme.rule }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: designColors.yellow,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <KitIcon name="archive" size={17} color={designColors.ink} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="smallBold">
                  {isArchived ? 'Unarchive league' : 'Archive league'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {isArchived
                    ? 'Bring the league back and it is listed and joinable again exactly as it was.'
                    : 'Keeps every season, table and score, and stops new people joining. You can undo it.'}
                </ThemedText>
              </View>
            </View>

            <Button
              variant="soft"
              size="md"
              label={
                busy === 'archive' ? 'Saving…' : isArchived ? 'Unarchive league' : 'Archive league'
              }
              busy={busy === 'archive'}
              onPress={toggleArchive}
            />

            {/* Deleting, when there is nothing played to lose. Two steps, and the
                second one counts what goes rather than warning in the abstract. */}
            <View style={{ borderTopWidth: 1, borderTopColor: designColors.divider, paddingTop: 14, gap: 10 }}>
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
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button
                        variant="soft"
                        size="md"
                        label="Keep it"
                        onPress={() => setIsConfirmingDelete(false)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        variant="danger"
                        size="md"
                        label={busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
                        busy={busy === 'delete'}
                        onPress={remove}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    label="Delete league"
                    onPress={() => setIsConfirmingDelete(true)}
                  />
                )
              ) : (
                // Not offered rather than offered-and-refused, and it says why.
                // Deleting here would cascade through the sessions and take the
                // recorded scores with them — see deleteLeague.
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <KitIcon name="lock" size={14} color={designColors.inkMuted} strokeWidth={2.2} />
                  <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                    {footprint === null
                      ? 'Checking what this league holds…'
                      : `Deleting is off: ${footprint.played} ${
                          footprint.played === 1 ? 'table has' : 'tables have'
                        } been played, and its scores are part of everyone's standings.`}
                  </ThemedText>
                </View>
              )}
            </View>
          </ThemedView>
        </>
      ) : null}

      {/* Not offered to a viewer, who has nothing to leave. The delete policy
          would refuse it anyway, but an admin reading a league they are not in
          should not be shown a red button that claims otherwise. */}
      {league.role === 'viewer' ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={[styles.destructive, { textAlign: 'center' }]}>
          You are not a member of this league. You are seeing it because global
          view is on.
        </ThemedText>
      ) : (
        <TextLink
          label={busy === 'leave' ? 'Leaving…' : 'Leave this league'}
          color={designColors.danger}
          onPress={leave}
          style={{ justifyContent: 'center' }}
        />
      )}
      </ScreenScaffold>

      {/* The same sheet My Matches opens, handed the whole meetup instead of one
          table. Keyed on the meetup so the drafts are rebuilt from what is
          recorded rather than kept from the last one that was opened. */}
      {scoringSession ? (
        <ScoreEntrySheet
          key={scoringSession.id}
          tables={scoringTables.map((table) => ({
            match_id: table.id,
            // Named even when there is one, unlike My Matches: at a meetup the
            // table number is how an organizer matches a paper card to a column of
            // names, and a meetup that drew one table this week drew three last.
            label: `Table ${table.table_number ?? '—'}`,
            seats: table.seats.map((seat) => ({
              player_id: seat.player_id,
              name: seat.name,
              score: seat.score,
            })),
          }))}
          subtitle={`${scoringSession.location} · ${formatWhen(scoringSession.date_time)}`}
          visible
          onClose={() => setScoringSession(null)}
          save={(entries) => enterSessionScores(scoringSession.id, entries).then(() => undefined)}
          onSaved={async () => {
            setScoringSession(null);
            // The meetup row shows whether it has been played, and the seating
            // shows which tables are done — both have just changed.
            await reloadSessions();
            await refreshSeating(scoringSession.id);
          }}
        />
      ) : null}
    </>
  );
}


/** The kit's filled-well field, shared with login.tsx and match-sheet.tsx. */
const formFieldInput = {
  ...designText.body,
  fontSize: 16,
  color: designColors.ink,
  backgroundColor: designColors.bg,
  borderWidth: 1,
  borderColor: designColors.track,
  borderRadius: designRadius.inset,
  paddingHorizontal: 14,
  height: 48,
};

const formFieldLabel = { ...designText.caption, color: designColors.inkMuted, letterSpacing: 0.6 };

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
  /**
   * The redesign's card: radius 24, no border, the deeper two-layer lift.
   * `components/kit/layout.tsx` draws the same surface for everything built on
   * the kit; this stays a stylesheet entry because the sections below are still
   * `ThemedView`s, and restyling in place is what let them move over without
   * re-pairing their tags.
   */
  card: {
    padding: 16,
    borderRadius: 24,
    borderWidth: 0,
    gap: 14,
    boxShadow: '0px 1px 2px rgba(20, 26, 46, 0.04), 0px 10px 28px rgba(20, 26, 46, 0.08)',
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
  /**
   * Wraps, deliberately. "12. The Beer Cellar Glen Ellyn" and a chip do not fit
   * across a phone, and letting the venue ellipsize to protect a button would hide
   * the one word that tells two meetups apart.
   */
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  sessionTitle: {
    flexShrink: 1,
  },
  scoresChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
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
