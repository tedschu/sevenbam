-- Draining the outbox, once a minute.
--
-- The triggers in 20260901140000 queue notices; something has to send them. That
-- something is the notify-dropouts function, and this is what calls it.
--
-- Scheduled rather than pushed from the trigger, which is the same decision the
-- outbox itself represents: a member saying "can't make it" must not wait on, or
-- fail because of, Resend. A minute late is invisible to an organizer deciding
-- whether to find a sub.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The URL and the service key live in Vault rather than in this file, because
-- this file is in git and one of them is a credential that bypasses RLS.
--
-- Set them once per environment, before the schedule below does anything useful:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-dropouts',
--                              'notify_dropouts_url');
--   select vault.create_secret('<service-role-key>', 'notify_dropouts_key');
--
-- A missing secret leaves the job doing nothing and saying so in the log, which
-- is the right failure: noisy in one place, harmless everywhere else.
create or replace function public.drain_notification_outbox()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  -- Nothing queued, nothing to wake up for. Checked first because this runs 1440
  -- times a day and is a no-op on almost all of them.
  if not exists (
    select 1 from public.notification_outbox
    where sent_at is null and attempts < 5
  ) then
    return;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'notify_dropouts_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'notify_dropouts_key';

  if v_url is null or v_key is null then
    raise warning 'drain_notification_outbox: notify_dropouts_url or notify_dropouts_key is not in the vault; notices are queuing up unsent.';
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately, so a slow
  -- or unreachable function costs this job nothing; anything it fails to send is
  -- still in the outbox for the next run.
  perform extensions.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.drain_notification_outbox() from public, anon, authenticated;

-- Unscheduled first so the migration can be re-run, and so changing the interval
-- later is an edit here rather than a manual cron surgery on a live database.
select cron.unschedule('drain-notification-outbox')
where exists (select 1 from cron.job where jobname = 'drain-notification-outbox');

select cron.schedule(
  'drain-notification-outbox',
  '* * * * *',
  $job$ select public.drain_notification_outbox(); $job$
);

comment on function public.drain_notification_outbox() is
  'Wakes the notify-dropouts edge function when the outbox is non-empty. Scheduled every minute by pg_cron; reads its URL and key from Vault.';
