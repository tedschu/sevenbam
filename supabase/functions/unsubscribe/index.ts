// Turning the mail off, from inside the mail.
//
// Runs unauthenticated, which is the entire point: the person clicking has a mail
// client open, not the app, and asking them to sign in first is how an unsubscribe
// becomes a spam report. The token in the URL is the whole of the authorisation —
// see the note on `notification_settings.unsubscribe_token`.
//
// Two callers, and they want different things:
//
//   POST  Gmail and Yahoo, acting on the reader's behalf under RFC 8058. No human
//         sees the response, so it does the work and answers in one line.
//   GET   A person who clicked the footer link. This does *not* act — it renders a
//         page with a button that posts. Corporate link scanners fetch every URL
//         in an incoming message, and a GET that unsubscribed would quietly mute
//         people who never clicked anything.
import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

/** The two switches on `notification_settings`, and the only values the link may carry. */
const Switches: Record<string, string> = {
  game_is_on: 'emails telling you a game you are in has four players',
  someone_drops_out: 'emails telling you somebody has dropped out of a game you are in',
};

const AppOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://tschusters-team-mahjong.expo.app';

/**
 * Deliberately plain, and deliberately self-contained.
 *
 * This renders in whatever a mail client hands the link to, which is a browser
 * nobody chose and often one embedded in another app. No external stylesheet, no
 * script, no font — everything it needs is in the document.
 */
function page(title: string, body: string, action?: { token: string; setting: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; padding: 48px 24px; background: #f7f5f0; color: #1c1b18;
         font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 30rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 1rem; }
  button { font: inherit; font-weight: 600; padding: 0.7rem 1.25rem; border: 0;
           border-radius: 10px; background: #1f4e79; color: #fff; cursor: pointer; }
  a { color: #1f4e79; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  ${body}
  ${
    action
      ? `<form method="post">
      <input type="hidden" name="t" value="${action.token}">
      <input type="hidden" name="k" value="${action.setting}">
      <button type="submit">Yes, stop these emails</button>
    </form>`
      : ''
  }
  <p><a href="${AppOrigin}">Open Seven Bam</a></p>
</main>
</body>
</html>`;
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * The token and switch, from wherever this request happens to carry them.
 *
 * One-click posts `List-Unsubscribe=One-Click` as a form body and leaves the query
 * string on the URL, so the URL is the reliable half; the confirm form posts both
 * as fields. Reading both and preferring the body costs nothing and means neither
 * caller has a special case.
 */
async function paramsOf(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get('t') ?? '';
  let setting = url.searchParams.get('k') ?? '';

  if (request.method === 'POST') {
    try {
      const form = await request.formData();
      token = (form.get('t') as string) ?? token;
      setting = (form.get('k') as string) ?? setting;
    } catch {
      // One-click may post an empty or non-form body. The query string stands.
    }
  }

  return { token, setting };
}

Deno.serve(async (request) => {
  const { token, setting } = await paramsOf(request);
  const description = Switches[setting];

  // A malformed link is somebody's mail client having mangled the URL, so it says
  // what to do instead rather than showing a status code.
  if (!token || !description) {
    return html(
      page(
        'That link is not complete',
        `<p>The unsubscribe link seems to have been cut short somewhere between the
          email and here. You can turn these emails off under Email alerts on your
          profile.</p>`
      ),
      400
    );
  }

  if (request.method === 'GET') {
    return html(
      page(
        'Stop these emails?',
        `<p>This will stop ${description}.</p>
         <p>Everything else stays as it is, and you can turn it back on any time
          under Email alerts on your profile.</p>`,
        { token, setting }
      )
    );
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // The anon key, not the service role. `unsubscribe_by_token` is security definer
  // and does its own lookup, so this function needs no privilege of its own — and
  // an unauthenticated endpoint holding a key that bypasses RLS is a bad trade for
  // saving a line.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  const { data, error } = await supabase.rpc('unsubscribe_by_token', {
    p_token: token,
    p_switch: setting,
  });

  if (error) {
    console.error(`[unsubscribe] ${error.message}`);
    return html(
      page(
        'Something went wrong',
        `<p>We could not change your settings just now. Please try the link again,
          or turn these emails off under Email alerts on your profile.</p>`
      ),
      500
    );
  }

  // A token that matches nothing: an old link, or an account that has since been
  // closed. Not an error, and not worth alarming anybody about.
  if (data !== true) {
    return html(
      page(
        'That link has expired',
        `<p>We could not find the settings this link points at. If you are still
          getting emails you do not want, you can turn them off under Email alerts
          on your profile.</p>`
      )
    );
  }

  return html(
    page(
      'Done — you are unsubscribed',
      `<p>You will no longer get ${description}.</p>
       <p>You can turn it back on any time under Email alerts on your profile.</p>`
    )
  );
});
