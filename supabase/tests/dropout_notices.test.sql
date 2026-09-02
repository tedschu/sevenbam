-- Who gets told when somebody drops out.
--
-- Runs against the local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/dropout_notices.test.sql
--
-- Everything happens inside one transaction that is rolled back at the end, so it
-- is safe to run repeatedly against a seeded database without disturbing it.
--
-- Each scenario is a DO block that raises on the first thing that is not true.
-- Not pgTAP: the project has no test dependency today, and adding one to write
-- twelve assertions would be the larger change.

\set ON_ERROR_STOP on
\timing off

begin;

-- Fixtures -------------------------------------------------------------------

-- A user, via auth.users so the on_auth_user_created trigger builds the profile
-- the same way a real sign-up does. The empty-string token columns are load
-- bearing; see the note in seed.sql.
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

-- A league with `p_member_count` members, the first of whom organizes it, and one
-- meetup ready to draw. Returns the session id; the members are readable back out
-- of league_members.
create function pg_temp.mk_league(p_member_count integer) returns uuid
language plpgsql as $$
declare
  v_league uuid;
  v_season uuid;
  v_session uuid;
  v_profile uuid;
  i integer;
begin
  v_profile := pg_temp.mk_user('Organizer');

  -- seat_league_creator_after_insert makes the creator the organizer, so there
  -- is deliberately no league_members insert for them here.
  insert into public.leagues (name, created_by) values ('Test League', v_profile)
  returning id into v_league;

  for i in 2..p_member_count loop
    v_profile := pg_temp.mk_user('Member ' || i);
    insert into public.league_members (league_id, profile_id, role)
    values (v_league, v_profile, 'member');
  end loop;

  insert into public.seasons (league_id, name) values (v_league, 'Season 1')
  returning id into v_season;

  insert into public.league_sessions (season_id, sequence, date_time, location)
  values (v_season, 1, now() + interval '7 days', 'The Church Hall')
  returning id into v_session;

  return v_session;
end $$;

-- Acting as somebody. draw_league_session and open_session_to_subs both gate on
-- auth.uid(), which reads the request setting; this is how PostgREST supplies it.
create function pg_temp.act_as(p_profile uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile)::text, true);
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

create function pg_temp.members_of(p_session uuid) returns setof uuid
language sql as $$
  select lm.profile_id
  from public.league_sessions ls
  join public.seasons s on s.id = ls.season_id
  join public.league_members lm on lm.league_id = s.league_id
  where ls.id = p_session
  -- Organizer first, deliberately. joined_at ties inside a single transaction, so
  -- ordering on it alone left the organizer at a random offset and any test
  -- reaching for "an ordinary member" picked them up now and then. With this,
  -- offset >= 1 is always somebody who does not run the league.
  order by (lm.role = 'organizer') desc, lm.profile_id;
$$;

-- Every seat at a meetup, table by table.
create function pg_temp.seated(p_session uuid) returns setof uuid
language sql as $$
  select mp.player_id
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  where m.session_id = p_session;
$$;

create function pg_temp.table_sizes(p_session uuid) returns integer[]
language sql as $$
  select coalesce(array_agg(n order by n desc), '{}'::integer[])
  from (
    select count(mp.*)::integer as n
    from public.matches m
    left join public.match_players mp on mp.match_id = m.id
    where m.session_id = p_session
    group by m.id
  ) s;
$$;

-- Seating a sub the way the app does: an ordinary insert into match_players, so
-- the capacity trigger, the one-seat-per-meetup trigger and the status sync all
-- run exactly as they would for a real Join.
create function pg_temp.seat_sub(p_session uuid, p_sub uuid) returns void
language plpgsql as $$
declare
  v_match uuid;
begin
  select m.id into v_match
  from public.matches m
  where m.session_id = p_session
    and m.needs_sub
    and (select count(*) from public.match_players mp where mp.match_id = m.id)
        < public.match_seat_limit()
  limit 1;

  if v_match is null then
    raise exception 'No table at this meetup is open to subs.';
  end if;

  insert into public.match_players (match_id, player_id) values (v_match, p_sub);
end $$;

create function pg_temp.notices(p_subject uuid) returns setof uuid
language sql as $$
  select recipient_id from public.notification_outbox where subject_id = p_subject;
$$;

-- Scenarios ------------------------------------------------------------------

-- 1. Declining a meetup tells the organizer, and does not tell the person who
--    declined.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_member uuid;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 2 limit 1;

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');

  if not exists (select 1 from pg_temp.notices(v_member) r where r = v_org) then
    raise exception '1: the organizer was not told';
  end if;
  if exists (select 1 from pg_temp.notices(v_member) r where r = v_member) then
    raise exception '1: the member was told about their own drop-out';
  end if;

  raise notice '1 PASS  declining a meetup tells the organizer, not the leaver';
end $$;

-- 2. Once, not twice. set_session_attendance writes the answer *and* releases the
--    seat, so both triggers see a league drop-out; the guard in
--    notice_match_dropout is what stops the second one.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_member uuid;
  v_count integer;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 2 limit 1;

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');

  select count(*) into v_count from pg_temp.notices(v_member) r where r = v_org;
  if v_count <> 1 then
    raise exception '2: the organizer was told % times, expected once', v_count;
  end if;

  raise notice '2 PASS  a drawn meetup drop-out notifies exactly once';
end $$;

-- 3. The host of the table actually left short is told as well, even though they
--    are an ordinary member.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_member uuid;
  v_host uuid;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  -- Somebody who is not hosting their own table, so "host" and "leaver" differ.
  select mp.player_id, m.host_id into v_member, v_host
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  where m.session_id = v_session
    and mp.player_id <> m.host_id
    and mp.player_id <> pg_temp.organizer_of(v_session)
  limit 1;

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');

  if not exists (select 1 from pg_temp.notices(v_member) r where r = v_host) then
    raise exception '3: the host of the short table was not told';
  end if;

  raise notice '3 PASS  the table host is told too';
end $$;

-- 4. A redraw is a mass delete of seats and must stay silent. Nobody dropped out;
--    the tables were reshuffled.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_before integer;
  v_after integer;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  select count(*) into v_before from public.notification_outbox;
  perform public.draw_league_session(v_session);
  select count(*) into v_after from public.notification_outbox;

  if v_after <> v_before then
    raise exception '4: a redraw queued % notices', v_after - v_before;
  end if;

  raise notice '4 PASS  a redraw notifies nobody';
end $$;

-- 5. Saying the same thing twice is not news. The UI lets a member press "can't
--    make it" again on a meetup they have already declined.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_member uuid;
  v_count integer;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 2 limit 1;

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');
  perform public.set_session_attendance(v_session, 'out');

  select count(*) into v_count from pg_temp.notices(v_member);
  if v_count <> 1 then
    raise exception '5: re-declining queued % notices, expected 1', v_count;
  end if;

  raise notice '5 PASS  re-declining does not notify again';
end $$;

-- 6. Coming back in, then dropping out again, is news both times.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_member uuid;
  v_count integer;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 2 limit 1;

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');
  perform public.set_session_attendance(v_session, 'in');
  perform public.set_session_attendance(v_session, 'out');

  select count(*) into v_count from pg_temp.notices(v_member);
  if v_count <> 2 then
    raise exception '6: expected 2 notices across two drop-outs, got %', v_count;
  end if;

  raise notice '6 PASS  changing your mind twice notifies twice';
end $$;

-- 7. The Browse case: a one-off match with no meetup behind it, where the only
--    person to tell is the host.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_guest uuid := pg_temp.mk_user('Guest');
  v_match uuid;
begin
  insert into public.matches (host_id, date_time, location, status)
  values (v_host, now() + interval '3 days', 'The Coffee House', 'open')
  returning id into v_match;

  insert into public.match_players (match_id, player_id) values (v_match, v_guest);
  delete from public.match_players where match_id = v_match and player_id = v_guest;

  if not exists (select 1 from pg_temp.notices(v_guest) r where r = v_host) then
    raise exception '7: the host of the one-off match was not told';
  end if;

  raise notice '7 PASS  leaving a one-off match tells its host';
end $$;

-- 8. The view the sender reads is joined correctly and carries the numbers the
--    mail needs to say "you are short" rather than just "somebody dropped out".
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_member uuid;
  v_row record;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 2 limit 1;

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');

  select * into v_row from public.pending_notifications
  where subject_name is not null and session_id = v_session limit 1;

  if v_row is null then
    raise exception '8: nothing pending for the sender to send';
  end if;
  if v_row.recipient_email is null or v_row.recipient_email = '' then
    raise exception '8: no address to send to';
  end if;
  if v_row.league_name is null then
    raise exception '8: the league name did not join through';
  end if;
  if v_row.going <> 5 then
    raise exception '8: expected 5 still going, got %', v_row.going;
  end if;
  if v_row.expected_tables <> 2 then
    raise exception '8: expected 2 tables, got %', v_row.expected_tables;
  end if;

  raise notice '8 PASS  the sender view carries names, address and counts';
end $$;

-- 9. Sent and exhausted notices leave the queue, so the drain does not resend
--    them for ever.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_member uuid;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 2 limit 1;
  perform pg_temp.act_as(v_member);
  perform public.set_session_attendance(v_session, 'out');

  update public.notification_outbox set sent_at = now() where subject_id = v_member;
  if exists (select 1 from public.pending_notifications where subject_name is not null
             and session_id = v_session) then
    raise exception '9: a sent notice is still pending';
  end if;

  update public.notification_outbox set sent_at = null, attempts = 5 where subject_id = v_member;
  if exists (select 1 from public.pending_notifications where session_id = v_session) then
    raise exception '9: a notice past its attempt limit is still pending';
  end if;

  raise notice '9 PASS  sent and exhausted notices leave the queue';
end $$;

rollback;
