// Sends the notices that the triggers in 20260901140000 and 20260909120000 queued
// up: somebody dropped out, a pick-up table filled up, or a full one lost a player.
//
// Still called notify-dropouts. The name is narrower than the job now, and renaming
// it would mean re-pointing the Vault secret the cron drain reads and redeploying
// under a second name — a rename of a background job is not worth an outage window.
//
// Runs on Deno, not React Native — excluded from the app's tsconfig and eslint
// for the same reason as places-autocomplete.
//
// The outbox is drained rather than pushed: a trigger that called Resend inline
// would put a third party inside the member's transaction, and the drop-out has
// to save whether or not the mail goes out. Everything here is therefore
// retryable, and nothing here can fail the thing it is reporting on.
import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const ResendUrl = 'https://api.resend.com/emails';

/** Enough to clear a normal evening's drop-outs, small enough to finish inside the timeout. */
const BatchSize = 50;

/** Matches `attempts < 5` in the pending_notifications view. Five failures is a dead address. */
const MaxAttempts = 5;

const AppOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://tschusters-team-mahjong.expo.app';

type Pending = {
  id: string;
  kind: 'dropout' | 'match_full' | 'match_reopened';
  recipient_name: string | null;
  recipient_email: string;
  subject_name: string | null;
  league_name: string | null;
  date_time: string;
  location: string;
  location_detail: string | null;
  session_id: string | null;
  going: number | null;
  expected_tables: number | null;
  host_name: string | null;
  unsubscribe_token: string | null;
  time_zone: string | null;
};

/**
 * Which switch on the profile screen each notice belongs to.
 *
 * Unsubscribing from a "seat opened up" mail also silences league drop-out mail,
 * and that is the intent rather than an accident of grouping: from the reader's
 * side both are "somebody can't make it", and offering to stop only half of that
 * would send them straight back here next week. Kept beside `wants_notice` in
 * 20260909130000, which has to make the same mapping.
 */
const SwitchFor: Record<Pending['kind'], string> = {
  dropout: 'someone_drops_out',
  match_reopened: 'someone_drops_out',
  match_full: 'game_is_on',
};

/**
 * Where somebody goes to turn these off. Always reachable, because it is a screen
 * in the app rather than anything that has to be deployed separately.
 */
const SettingsUrl = `${AppOrigin.replace(/\/$/, '')}/profile`;

/**
 * The one-click endpoint — only if one is actually deployed.
 *
 * Deliberately not defaulted to `${SUPABASE_URL}/functions/v1/unsubscribe`, which
 * is where it would live: a `List-Unsubscribe` header pointing at a function that
 * has not been deployed is worse than no header at all. The mail client draws the
 * Unsubscribe button, the reader presses it, and nothing happens — and the
 * providers that reward the header for existing are the same ones that punish it
 * for not working.
 *
 * So the header appears when this is set, and the footer link to the profile
 * screen appears either way. Deploying the `unsubscribe` function and setting this
 * turns one-click on with no other change.
 */
const UnsubscribeBase = Deno.env.get('UNSUBSCRIBE_BASE');

function oneClickUrl(row: Pending) {
  if (!UnsubscribeBase || !row.unsubscribe_token) return null;
  return `${UnsubscribeBase}?t=${row.unsubscribe_token}&k=${SwitchFor[row.kind] ?? 'someone_drops_out'}`;
}

/**
 * The fallback zone, for a venue that never told us its own.
 *
 * Without a zone the sender formats in its own, and a Deno function runs in UTC —
 * so a 7pm game went out as "12:00 AM UTC" to everybody invited to it. Survivable
 * in a drop-out notice, where the time is context; not survivable in a mail whose
 * entire job is to tell four people when to turn up.
 *
 * A fallback rather than the answer. Venues picked from the Places suggestions
 * carry their own zone on the row, which is right wherever the league is; this
 * covers the rest — a venue typed by hand, and every row that predates the column.
 * It is a guess about where the service is used, and it is kept in the one place a
 * guess belongs.
 *
 * Unset, this falls back to the sender's own zone rather than guessing further.
 */
const AppTimeZone = Deno.env.get('APP_TIMEZONE') ?? undefined;

/**
 * The zone to read this row's clock in, if it is one this runtime knows.
 *
 * Validated rather than trusted. The value is a string on a row, and an unknown
 * zone makes `toLocaleString` throw — which would fail the send, burn an attempt,
 * and do it again on every retry until the notice was abandoned. A mail with the
 * time in the wrong zone is a bad evening; a mail that never arrives is silence.
 */
function zoneOf(row: Pending) {
  for (const candidate of [row.time_zone, AppTimeZone]) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return candidate;
    } catch {
      console.error(`[notify-dropouts] ignoring unknown time zone ${candidate}`);
    }
  }
  return undefined;
}

/**
 * "Saturday, September 12 at 7:00 PM CDT" — the same shape the app writes on a
 * card, so the mail and the screen agree about what the evening is called.
 *
 * Fixed to the league's own wording rather than the reader's locale: everybody
 * receiving this is going to the same room on the same night.
 */
function formatWhen(iso: string, zone: string | undefined) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    // Always said out loud. The zone is the venue's, not the reader's, and a time
    // with no zone beside it is the thing that got this wrong in the first place.
    timeZoneName: 'short',
    timeZone: zone,
  });
}

/**
 * The same evening, without the clock — for subject lines only.
 *
 * A subject carrying the full timestamp runs past where every mail client stops
 * drawing it, so the useful half ("your game is on") gets cut. The time is in the
 * first line of the body and again under "When", which is where somebody looks for
 * it anyway.
 */
function formatDay(iso: string, zone: string | undefined) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  });
}

function venueOf(row: Pending) {
  return row.location_detail ? `${row.location}, ${row.location_detail}` : row.location;
}

/**
 * The advice, and the reason this mail is worth sending at all.
 *
 * Only offered for a meetup, and only when the tables are actually short. A
 * league that drops from twelve to eleven still deals three full tables and does
 * not need a stranger; telling it to find one anyway is how a useful notice
 * becomes one people filter.
 */
function subsAdvice(row: Pending) {
  if (!row.session_id || row.going === null || row.expected_tables === null) return '';

  const seats = row.expected_tables * 4 - row.going;
  if (seats <= 0) return '';

  return (
    `That leaves ${row.going} ${row.going === 1 ? 'person' : 'people'} across ` +
    `${row.expected_tables} ${row.expected_tables === 1 ? 'table' : 'tables'} — ` +
    `${seats} empty ${seats === 1 ? 'chair' : 'chairs'}. ` +
    `You can open the meetup to subs from the league screen, which offers the short ` +
    `tables to people outside the league.`
  );
}

/** "Hi Sarah," — or just "Hi," for somebody who has not set a name yet. */
function greeting(row: Pending) {
  return `Hi${row.recipient_name ? ` ${row.recipient_name}` : ''},`;
}

/** Who the notice is about, for the common case of a profile with no name on it. */
function subjectOf(row: Pending) {
  return row.subject_name ?? 'Someone';
}

function composeDropout(row: Pending) {
  const who = subjectOf(row);
  const where = row.league_name ? ` in ${row.league_name}` : '';
  const advice = subsAdvice(row);

  const subject = row.league_name
    ? `${who} can't make ${row.league_name} on ${formatWhen(row.date_time, zoneOf(row))}`
    : `${who} can't make your game on ${formatWhen(row.date_time, zoneOf(row))}`;

  const lines = [
    greeting(row),
    '',
    `${who} has said they can't make the game${where} on ${formatWhen(row.date_time, zoneOf(row))} at ${venueOf(row)}.`,
    ...(advice ? ['', advice] : []),
    '',
    AppOrigin,
  ];

  return { subject, text: lines.join('\n') };
}

/**
 * The table filled up.
 *
 * Goes to all four, the player who took the last seat included — they are the one
 * person who could work it out for themselves, and they are also the one most
 * likely to be reading it on a phone in a queue somewhere, so the confirmation is
 * worth as much to them as to anybody.
 *
 * Deliberately repeats the date, time and venue rather than linking to them. This
 * arrives days or weeks before the game, and the thing people go looking for in
 * an old mail is where and when, not a button.
 */
function composeMatchFull(row: Pending) {
  const host = row.host_name ? `Hosted by ${row.host_name}.` : '';

  const lines = [
    greeting(row),
    '',
    `Your mahjong game on ${formatWhen(row.date_time, zoneOf(row))} is on — all four seats are taken.`,
    '',
    `Where: ${venueOf(row)}`,
    `When: ${formatWhen(row.date_time, zoneOf(row))}`,
    ...(host ? [host] : []),
    '',
    AppOrigin,
  ];

  return {
    subject: `Four players — your game on ${formatDay(row.date_time, zoneOf(row))} is on`,
    text: lines.join('\n'),
  };
}

/**
 * The table lost its fourth.
 *
 * The point of this one is the last line. Everybody still coming can reach people
 * the host cannot, and a seat that reopens ten days out is nearly always fillable
 * — but only by somebody who has been told there is a seat. Without this the
 * match slides back into Browse and waits to be stumbled over.
 */
function composeMatchReopened(row: Pending) {
  const who = subjectOf(row);

  const lines = [
    greeting(row),
    '',
    `${who} can no longer make the game on ${formatWhen(row.date_time, zoneOf(row))} at ${venueOf(row)}, ` +
      `so there is a seat open again.`,
    '',
    `The match is back in Browse and anybody can claim the fourth chair. If you know ` +
      `someone who would like it, send them along — it is usually the fastest way to ` +
      `keep the evening.`,
    '',
    `Where: ${venueOf(row)}`,
    `When: ${formatWhen(row.date_time, zoneOf(row))}`,
    '',
    AppOrigin,
  ];

  return {
    subject: `A seat opened up in your game on ${formatDay(row.date_time, zoneOf(row))}`,
    text: lines.join('\n'),
  };
}

function compose(row: Pending) {
  switch (row.kind) {
    case 'match_full':
      return composeMatchFull(row);
    case 'match_reopened':
      return composeMatchReopened(row);
    default:
      return composeDropout(row);
  }
}

async function send(apiKey: string, from: string, row: Pending) {
  const { subject, text } = compose(row);
  const oneClick = oneClickUrl(row);

  // The visible link always points at the profile screen, which exists whatever
  // else is deployed. The header, when there is an endpoint behind it, is what
  // Gmail and Apple Mail turn into the Unsubscribe button beside the sender's
  // name — and increasingly what they weigh when deciding whether we belong in an
  // inbox at all.
  //
  // `List-Unsubscribe-Post` is the RFC 8058 opt-in: it promises the endpoint will
  // act on a POST with no confirmation step, which is why that endpoint refuses to
  // act on the GET that link scanners make.
  const body = `${text}\n\n--\nManage email settings: ${SettingsUrl}`;

  const response = await fetch(ResendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [row.recipient_email],
      subject,
      text: body,
      ...(oneClick
        ? {
            headers: {
              'List-Unsubscribe': `<${oneClick}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

Deno.serve(async () => {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM');

  // A missing key is a deploy that was never finished, not a transient fault, so
  // it fails loudly here instead of burning an attempt on every queued notice.
  if (!apiKey || !from) {
    return Response.json({ error: 'RESEND_API_KEY and RESEND_FROM must be set.' }, { status: 500 });
  }

  // The service role, because the outbox is deliberately unreadable to everyone
  // else — it holds who cancelled on whom across every league on the service.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase
    .from('pending_notifications')
    .select('*')
    .order('created_at')
    .limit(BatchSize);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Pending[];
  let sent = 0;
  let failed = 0;

  // One at a time, and each failure recorded against its own row. A batch that
  // gave up on the first bad address would leave the rest of the evening's
  // notices stuck behind it forever.
  for (const row of rows) {
    try {
      await send(apiKey, from, row);
      await supabase
        .from('notification_outbox')
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id);
      sent += 1;
    } catch (cause) {
      const attempts = row.attempts + 1;
      await supabase
        .from('notification_outbox')
        .update({ attempts, last_error: String(cause).slice(0, 500) })
        .eq('id', row.id);
      failed += 1;

      // Past the limit the view stops offering it, so this is the last word on
      // that notice and worth having in the logs.
      if (attempts >= MaxAttempts) {
        console.error(`[notify-dropouts] giving up on ${row.id}: ${cause}`);
      }
    }
  }

  return Response.json({ considered: rows.length, sent, failed });
});
