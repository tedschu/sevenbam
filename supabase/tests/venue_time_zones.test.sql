-- The venue's clock, from the venue to the email.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/venue_time_zones.test.sql
--
-- One transaction, rolled back at the end. Fixtures duplicated from the other
-- test files by the same convention — see the note in match_notices.test.sql.
--
-- What is being protected here is a chain with three links and no visible failure
-- mode: a zone that stops at the meetup and never reaches the tables, or reaches
-- the tables and never reaches the sender's view, produces mail with a confident
-- and wrong time on it. Nothing on any screen would look different.

\set ON_ERROR_STOP on
\timing off

begin;

-- Fixtures -------------------------------------------------------------------

create function pg_temp.mk_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    p_name || '.' || replace(v_id::text, '-', '') || '@test.local', '',
    now(), now(), now(), '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_name),
    '', '', '', '', '', ''
  );
  return v_id;
end $$;

create function pg_temp.act_as(p_profile uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile)::text, true);
end $$;

-- A league with one meetup at a venue that knows its own zone.
create function pg_temp.mk_league(p_zone text) returns uuid
language plpgsql as $$
declare
  v_league uuid;
  v_season uuid;
  v_session uuid;
  v_profile uuid;
  i integer;
begin
  v_profile := pg_temp.mk_user('Organizer');

  insert into public.leagues (name, created_by) values ('Test League', v_profile)
  returning id into v_league;

  for i in 2..6 loop
    insert into public.league_members (league_id, profile_id, role)
    values (v_league, pg_temp.mk_user('Member ' || i), 'member');
  end loop;

  insert into public.seasons (league_id, name) values (v_league, 'Season 1')
  returning id into v_season;

  insert into public.league_sessions (season_id, sequence, date_time, location, time_zone)
  values (v_season, 1, now() + interval '7 days', 'The Beer Cellar', p_zone)
  returning id into v_session;

  return v_session;
end $$;

create function pg_temp.organizer_of(p_session uuid) returns uuid
language sql as $$
  select lm.profile_id
  from public.league_sessions ls
  join public.seasons s on s.id = ls.season_id
  join public.league_members lm on lm.league_id = s.league_id and lm.role = 'organizer'
  where ls.id = p_session
  limit 1;
$$;

-- Scenarios ------------------------------------------------------------------

-- 1. The draw copies the zone onto every table it deals. Without this the meetup
--    knows what clock it runs on and the four matches players actually see do
--    not — and the notices are composed from the matches.
do $$
declare
  v_session uuid := pg_temp.mk_league('America/Chicago');
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  if exists (
    select 1 from public.matches
    where session_id = v_session and time_zone is distinct from 'America/Chicago'
  ) then
    raise exception '1: a drawn table did not inherit the meetup''s zone';
  end if;

  raise notice '1 PASS  the draw copies the venue zone onto every table';
end $$;

-- 2. Moving a meetup carries the zone with it, to the meetup and to the tables
--    still to be played. Moving a meetup is usually moving the venue, which is
--    the one edit that can change the answer.
do $$
declare
  v_session uuid := pg_temp.mk_league('America/Chicago');
  v_org uuid := pg_temp.organizer_of(v_session);
begin
  perform pg_temp.act_as(v_org);
  perform public.draw_league_session(v_session);

  perform public.update_league_session(
    v_session, now() + interval '8 days', 'The Brooklyn Strategist', 'Brooklyn',
    null, null, 'America/New_York');

  if (select time_zone from public.league_sessions where id = v_session)
     is distinct from 'America/New_York' then
    raise exception '2: the meetup kept its old zone';
  end if;
  if exists (
    select 1 from public.matches
    where session_id = v_session and time_zone is distinct from 'America/New_York'
  ) then
    raise exception '2: a table kept the old zone after the meetup moved';
  end if;

  raise notice '2 PASS  moving a meetup carries the zone to its tables';
end $$;

-- 3. A venue typed by hand has no zone, and that is not an error — it is the
--    case the sender's APP_TIMEZONE fallback exists for. What matters is that it
--    comes through as null rather than as something invented.
do $$
declare
  v_session uuid := pg_temp.mk_league(null);
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  if exists (
    select 1 from public.matches where session_id = v_session and time_zone is not null
  ) then
    raise exception '3: a table invented a zone the meetup never had';
  end if;

  raise notice '3 PASS  a hand-typed venue leaves the zone null';
end $$;

-- 4. And the sender can read it. This is the link that would fail silently: the
--    view is the only thing the edge function selects from, and a zone that stops
--    here produces mail with a confident, wrong time on it.
do $$
declare
  v_session uuid := pg_temp.mk_league('America/New_York');
  v_org uuid := pg_temp.organizer_of(v_session);
  v_member uuid;
  v_zone text;
begin
  perform pg_temp.act_as(v_org);
  perform public.draw_league_session(v_session);

  -- A drop-out is the cheapest way to put a real notice in the queue.
  select lm.profile_id into v_member
  from public.league_sessions ls
  join public.seasons s on s.id = ls.season_id
  join public.league_members lm on lm.league_id = s.league_id and lm.role = 'member'
  where ls.id = v_session
  limit 1;

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');

  select time_zone into v_zone
  from public.pending_notifications
  where session_id = v_session
  limit 1;

  if v_zone is distinct from 'America/New_York' then
    raise exception '4: the sender sees zone %', coalesce(v_zone, '<null>');
  end if;

  raise notice '4 PASS  the sender reads the venue zone off the queue';
end $$;

rollback;
