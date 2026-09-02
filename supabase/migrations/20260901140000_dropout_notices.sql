-- Telling the organizer somebody dropped out.
--
-- Until now nothing did. A member hits "can't make it", `set_session_attendance`
-- quietly gives their seat up, and the only trace is a number on a screen nobody
-- has open. The organizer finds out on the night, which is exactly too late to
-- ask for a sub.
--
-- An outbox rather than an HTTP call from the trigger. The drop-out is the
-- member's transaction, and it must commit whether or not Resend is reachable;
-- a notice that fails to send is a bad evening, a drop-out that fails to save is
-- a corrupt one.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dropout')),

  -- Who hears about it, and who it is about.
  recipient_id uuid references public.profiles(id) on delete cascade not null,
  subject_id uuid references public.profiles(id) on delete cascade not null,

  -- What they dropped out of. Exactly one of these is set: a league meetup, or a
  -- one-off match with no meetup behind it.
  session_id uuid references public.league_sessions(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,

  created_at timestamptz not null default timezone('utc'::text, now()),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

-- The drain reads this every minute; without it that is a sequential scan of
-- every notice ever sent.
create index notification_outbox_unsent_idx
  on public.notification_outbox (created_at)
  where sent_at is null;

-- Nobody reads this table from the app. It holds who cancelled on whom across
-- every league on the service, and the only consumer is the sender running as
-- the service role, which bypasses RLS anyway.
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- Who to tell, for one dropped seat.
--
-- Organizers, because opening the meetup to subs is a thing only they can do, and
-- a league can have several since the handover change. Plus the host of the table
-- actually left short, who is usually a member rather than an organizer and is
-- the one who will notice a missing fourth.
--
-- The person dropping out never hears about their own drop-out, which is why
-- `subject` is excluded rather than left to be deduplicated later.
create or replace function public.enqueue_dropout(
  p_subject uuid,
  p_session uuid,
  p_match uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league uuid;
begin
  if p_session is not null then
    select s.league_id into v_league
    from public.league_sessions ls
    join public.seasons s on s.id = ls.season_id
    where ls.id = p_session;
  else
    select m.league_id into v_league from public.matches m where m.id = p_match;
  end if;

  insert into public.notification_outbox (kind, recipient_id, subject_id, session_id, match_id)
  select distinct 'dropout', r.id, p_subject, p_session, p_match
  from (
    select lm.profile_id as id
    from public.league_members lm
    join public.profiles p on p.id = lm.profile_id
    where lm.league_id = v_league
      and lm.role = 'organizer'
      and p.deleted_at is null

    union

    select m.host_id
    from public.matches m
    join public.profiles p on p.id = m.host_id
    where m.id = p_match
      and p.deleted_at is null
  ) r
  where r.id is not null
    and r.id <> p_subject;
end;
$$;

-- Saying no to a meetup.
--
-- Fires on the answer rather than on the seat, because the answer is the earlier
-- and better signal: somebody declining before the draw changes how many tables
-- get dealt, and there is no seat to watch yet. `set_session_attendance` writes
-- the answer before it releases the seat, so the table this member was sitting
-- at is still findable here.
--
-- Only on the transition into 'out'. Re-saving the same answer, which the UI
-- allows, is not news.
create or replace function public.notice_session_dropout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
begin
  if new.status <> 'out' then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.status = 'out' then
    return null;
  end if;

  select m.id into v_match
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  where m.session_id = new.session_id
    and mp.player_id = new.profile_id
  limit 1;

  perform public.enqueue_dropout(new.profile_id, new.session_id, v_match);
  return null;
end;
$$;

create trigger notice_session_dropout_after_answer
  after insert or update on public.session_attendance
  for each row execute function public.notice_session_dropout();

-- Leaving a table directly.
--
-- The Browse case: a one-off match somebody joined and can no longer make. It has
-- no meetup and no attendance row, so the trigger above never sees it.
--
-- The guard is the whole subtlety here. `set_session_attendance` gives the seat up
-- as part of answering, so a league drop-out arrives at *both* triggers — and it
-- has already written 'out' by the time this one runs, which is what makes the
-- check work. Without it every league drop-out mails twice.
--
-- A redraw is also a mass delete of seats, and must stay silent: nobody dropped
-- out, the tables were reshuffled. That falls out of the session check too, since
-- a redraw touches only seats belonging to a meetup and none of those players have
-- said they are out.
create or replace function public.notice_match_dropout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  select m.session_id into v_session
  from public.matches m where m.id = old.match_id;

  if v_session is not null then
    return null;
  end if;

  perform public.enqueue_dropout(old.player_id, null, old.match_id);
  return null;
end;
$$;

create trigger notice_match_dropout_after_leave
  after delete on public.match_players
  for each row execute function public.notice_match_dropout();

-- What the sender needs, in one read, already joined.
--
-- A view rather than the function assembling it from five tables in TypeScript:
-- the shape of a league is a SQL problem, and the sender's job is Resend's API.
create or replace view public.pending_notifications
with (security_invoker = off) as
  select
    n.id,
    n.kind,
    n.created_at,
    n.attempts,
    recipient.name as recipient_name,
    recipient_user.email as recipient_email,
    subject.name as subject_name,
    l.name as league_name,
    coalesce(ls.date_time, m.date_time) as date_time,
    coalesce(ls.location, m.location) as location,
    coalesce(ls.location_detail, m.location_detail) as location_detail,
    n.session_id,
    -- What a draw would produce now, so the mail can say "you are down to two
    -- tables" rather than leaving the organizer to work it out.
    sas.going,
    sas.expected_tables
  from public.notification_outbox n
  join public.profiles recipient on recipient.id = n.recipient_id
  join auth.users recipient_user on recipient_user.id = n.recipient_id
  join public.profiles subject on subject.id = n.subject_id
  left join public.league_sessions ls on ls.id = n.session_id
  left join public.matches m on m.id = n.match_id
  left join public.seasons s on s.id = ls.season_id
  left join public.leagues l on l.id = coalesce(s.league_id, m.league_id)
  left join public.session_attendance_summary sas on sas.session_id = n.session_id
  where n.sent_at is null
    and n.attempts < 5
    and recipient_user.email is not null;

revoke all on public.pending_notifications from anon, authenticated;

comment on table public.notification_outbox is
  'Drop-out notices waiting to be sent. Written by triggers, drained by the notify-dropouts edge function.';
