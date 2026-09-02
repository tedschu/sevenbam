// Sends the drop-out notices that the triggers in 20260901140000 queued up.
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
};

/**
 * "Saturday 12 September, 7:00 pm" — the same shape the app writes on a card, so
 * the mail and the screen agree about what the evening is called.
 *
 * Fixed to the league's own wording rather than the reader's locale: everybody
 * receiving this is going to the same room on the same night.
 */
function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
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

function compose(row: Pending) {
  const who = row.subject_name ?? 'Someone';
  const where = row.league_name ? ` in ${row.league_name}` : '';
  const advice = subsAdvice(row);

  const subject = row.league_name
    ? `${who} can't make ${row.league_name} on ${formatWhen(row.date_time)}`
    : `${who} can't make your game on ${formatWhen(row.date_time)}`;

  const lines = [
    `Hi${row.recipient_name ? ` ${row.recipient_name}` : ''},`,
    '',
    `${who} has said they can't make the game${where} on ${formatWhen(row.date_time)} at ${venueOf(row)}.`,
    ...(advice ? ['', advice] : []),
    '',
    AppOrigin,
  ];

  return { subject, text: lines.join('\n') };
}

async function send(apiKey: string, from: string, row: Pending) {
  const { subject, text } = compose(row);

  const response = await fetch(ResendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [row.recipient_email], subject, text }),
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
