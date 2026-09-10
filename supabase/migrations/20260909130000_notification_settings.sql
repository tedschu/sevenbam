-- Letting people turn the mail off.
--
-- Until now there was nothing to turn off — one notice, to one organizer, about a
-- league they run. The pick-up notices in 20260909120000 change what this is:
-- strangers who claimed a chair in Browse now get mail from us about a table they
-- may barely remember joining, and four of them get it at once. That is the point
-- at which "there is no way to stop it" stops being a small gap.
--
-- It is also the law in most of the places this runs. An unsubscribe that works
-- without signing in is not a courtesy; it is the price of sending at all, and
-- Gmail will judge us on whether the header is there long before a regulator does.
--
-- Two switches rather than one per notice kind. What people want to decide is
-- "tell me when a game I am in comes together" and "tell me when it falls apart",
-- and a settings screen with a row for every message we might ever send is how a
-- preference page becomes something nobody reads. `wants_notice` below is where
-- the mapping from kind to switch lives, so a new kind is a line there rather than
-- a column here and a checkbox on the profile screen.
create table public.notification_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,

  -- A pick-up table you are at reached four players.
  game_is_on boolean not null default true,

  -- Somebody can't make a game you are at: the league drop-out notice, and the
  -- pick-up "a seat opened up" notice. One switch, because from the reader's side
  -- they are the same piece of news.
  someone_drops_out boolean not null default true,

  -- What makes a one-click unsubscribe possible.
  --
  -- The link in a mail has to work in whatever browser the mail was opened in,
  -- with nobody signed in — and for Gmail's one-click it is not even a browser,
  -- it is Google's own server POSTing on the reader's behalf. So the link carries
  -- its own authority. A uuid rather than the profile id, because a profile id
  -- appears in ordinary API responses and this must not be guessable from one:
  -- anybody holding it can silence somebody else's mail.
  unsubscribe_token uuid not null default gen_random_uuid(),

  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- The unsubscribe endpoint's only lookup, and it runs unauthenticated. Unique so
-- a token can never address two people.
create unique index notification_settings_token_idx
  on public.notification_settings (unsubscribe_token);

alter table public.notification_settings enable row level security;

-- Your own switches, and nobody else's. Deliberately not "viewable by everyone"
-- like profiles: the token in this row is a credential, and whether somebody has
-- muted us is nobody's business but theirs.
create policy "Members read their own notification settings."
  on public.notification_settings for select
  using (profile_id = (select auth.uid()));

create policy "Members change their own notification settings."
  on public.notification_settings for update
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Nothing in `public` is exposed to the Data API by default — see the note in
-- 20260805033929 — so RLS only decides which rows a member reaches once these say
-- which operations reach RLS at all.
--
-- Read and update, and nothing else, on purpose. The row is created by the trigger
-- below and must keep existing: a member who could delete theirs would invalidate
-- the unsubscribe links in every mail already sitting in their inbox, and a member
-- who could insert one could choose their own token.
grant select on public.notification_settings to authenticated;

-- Column-scoped, so the two switches are the only thing a member can write. The
-- token is theirs to hold and not theirs to choose: rotating it silently breaks
-- every unsubscribe link already in their inbox, and `profile_id` is the row's
-- identity.
grant update (game_is_on, someone_drops_out) on public.notification_settings to authenticated;

-- Signed out, this is not readable at all. The row holds a credential, and an
-- unsubscribe link does not need to read it — `unsubscribe_by_token` does the
-- lookup as its owner.
revoke all on public.notification_settings from anon;

-- A row per profile, from the moment the profile exists.
--
-- Lazily creating it on first read was the alternative and is worse: the sender
-- needs the token at send time and reads through a view, which cannot insert. So
-- the row is there before anything wants it.
create or replace function public.seat_notification_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_settings (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return null;
end;
$$;

create trigger seat_notification_settings_after_profile
  after insert on public.profiles
  for each row execute function public.seat_notification_settings();

-- Everybody who signed up before this migration.
insert into public.notification_settings (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

-- Whether this person wants to hear about this.
--
-- Defaults to yes for a missing row rather than no. The row should always exist,
-- but if one is ever missing the failure that matters is silence — a member who
-- never learns their game fell apart and cannot tell why — not one mail more than
-- they wanted.
create or replace function public.wants_notice(p_profile uuid, p_kind text)
returns boolean
language sql
-- Reads a table whose RLS deliberately shows a member only their own row, and is
-- called from triggers running as whoever happened to press the button.
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (
      select case
        when p_kind = 'match_full' then ns.game_is_on
        when p_kind in ('dropout', 'match_reopened') then ns.someone_drops_out
        else true
      end
      from public.notification_settings ns
      where ns.profile_id = p_profile
    ),
    true
  );
$$;

-- Checked when the notice is queued, not when it is sent.
--
-- Filtering in `pending_notifications` was the obvious place and is a trap: the
-- row would stay in the outbox unsent forever, and `drain_notification_outbox`
-- wakes the sender whenever anything is unsent — so one muted member would have
-- the cron job calling the edge function every minute until the heat death of the
-- service. Not queueing it at all leaves nothing behind.
--
-- The cost is a window: somebody who unsubscribes in the minute between queueing
-- and sending still gets that one mail. The unsubscribe endpoint closes it by
-- clearing what is already queued.
create or replace function public.enqueue_match_notice(
  p_kind text,
  p_match uuid,
  p_subject uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_outbox (kind, recipient_id, subject_id, match_id)
  select p_kind, mp.player_id, p_subject, p_match
  from public.match_players mp
  join public.profiles p on p.id = mp.player_id
  where mp.match_id = p_match
    and p.deleted_at is null
    and public.wants_notice(mp.player_id, p_kind);
end;
$$;

-- The league drop-out notice honours the switch too.
--
-- Everything else is 20260901140000 verbatim, restated because a function body
-- cannot be edited in place. It was sending before there was anything to ask, and
-- leaving it as the one mail nobody can stop would make the setting a lie.
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
    and r.id <> p_subject
    and public.wants_notice(r.id, 'dropout');
end;
$$;

-- The sender gains the token it needs to build the link.
--
-- Appended at the end for the same reason `host_name` was: `create or replace
-- view` will not reorder or retype the columns already there. Everything above it
-- is 20260909120000 verbatim.
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
    tally.going,
    tally.expected_tables,
    host.name as host_name,
    settings.unsubscribe_token
  from public.notification_outbox n
  join public.profiles recipient on recipient.id = n.recipient_id
  join auth.users recipient_user on recipient_user.id = n.recipient_id
  join public.profiles subject on subject.id = n.subject_id
  left join public.notification_settings settings on settings.profile_id = n.recipient_id
  left join public.league_sessions ls on ls.id = n.session_id
  left join public.matches m on m.id = n.match_id
  left join public.profiles host on host.id = m.host_id
  left join public.seasons s on s.id = ls.season_id
  left join public.leagues l on l.id = coalesce(s.league_id, m.league_id)
  left join lateral (
    select
      (count(lm.profile_id) - count(*) filter (where sa.status = 'out'))::int as going,
      greatest(
        0,
        ceil((count(lm.profile_id) - count(*) filter (where sa.status = 'out'))::numeric
             / public.match_seat_limit())
      )::int as expected_tables
    from public.league_members lm
    join public.profiles p on p.id = lm.profile_id and p.deleted_at is null
    left join public.session_attendance sa
      on sa.session_id = n.session_id and sa.profile_id = lm.profile_id
    where lm.league_id = s.league_id
  ) tally on n.session_id is not null
  where n.sent_at is null
    and n.attempts < 5
    and recipient_user.email is not null;

revoke all on public.pending_notifications from anon, authenticated;
grant select on public.pending_notifications to service_role;

-- Acting on a link from an email, with nobody signed in.
--
-- `security definer` and a token argument rather than `auth.uid()`, because there
-- is no session here at all: the caller is the unsubscribe edge function running
-- as the anon key, or Gmail's server posting one-click on somebody's behalf. The
-- token is the whole of the authorisation, which is why it is a uuid nobody can
-- derive from a profile id.
--
-- Also clears what is already queued for that person and that switch. Without it
-- the last mail arrives a minute after they asked us to stop, which is the single
-- most annoying moment an unsubscribe can have. Deleting rather than marking
-- sent: an unsent notice that will never be sent is not a record of anything.
--
-- Returns whether the token matched, so the endpoint can tell somebody their link
-- has expired instead of showing them a page that lies.
create or replace function public.unsubscribe_by_token(p_token uuid, p_switch text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if p_switch not in ('game_is_on', 'someone_drops_out') then
    raise exception 'Unknown notification setting.';
  end if;

  update public.notification_settings
  set game_is_on = case when p_switch = 'game_is_on' then false else game_is_on end,
      someone_drops_out =
        case when p_switch = 'someone_drops_out' then false else someone_drops_out end,
      updated_at = timezone('utc'::text, now())
  where unsubscribe_token = p_token
  returning profile_id into v_profile;

  if v_profile is null then
    return false;
  end if;

  delete from public.notification_outbox
  where recipient_id = v_profile
    and sent_at is null
    and not public.wants_notice(v_profile, kind);

  return true;
end;
$$;

-- The endpoint runs unauthenticated; the token is what stands in for a session.
revoke all on function public.unsubscribe_by_token(uuid, text) from public;
grant execute on function public.unsubscribe_by_token(uuid, text) to anon, authenticated, service_role;

-- The sender clears its own rows the same way.
grant delete on public.notification_outbox to service_role;

comment on table public.notification_settings is
  'Per-member email switches, plus the token that makes a one-click unsubscribe work without a session.';

comment on function public.wants_notice(uuid, text) is
  'Whether a member still wants a given kind of notice. Checked when a notice is queued, never at send time — see the note in 20260909130000.';
