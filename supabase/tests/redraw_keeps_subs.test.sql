-- What a redraw is supposed to do, written down so it stays done.
--
-- Runs against the local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/redraw_keeps_subs.test.sql
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

-- Scenarios ------------------------------------------------------------------

-- 1. The baseline the change must not disturb: six members, nobody out, dealt
--    round-robin into even tables.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_tables integer;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  v_tables := public.draw_league_session(v_session);

  if v_tables <> 2 then
    raise exception '1: expected 2 tables, got %', v_tables;
  end if;
  if pg_temp.table_sizes(v_session) <> array[3, 3] then
    raise exception '1: expected two tables of three, got %', pg_temp.table_sizes(v_session);
  end if;
  if (select count(*) from pg_temp.seated(v_session)) <> 6 then
    raise exception '1: expected 6 seats, got %', (select count(*) from pg_temp.seated(v_session));
  end if;

  raise notice '1 PASS  six members draw into two tables of three';
end $$;

-- 2. The reported bug. A sub takes a chair, the organizer shuffles, and the sub
--    is still seated afterwards.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_sub uuid := pg_temp.mk_user('Sub');
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_sub);

  if not exists (select 1 from pg_temp.seated(v_session) s where s = v_sub) then
    raise exception '2: the sub was not seated to begin with';
  end if;

  perform public.draw_league_session(v_session);

  if not exists (select 1 from pg_temp.seated(v_session) s where s = v_sub) then
    raise exception '2: the redraw dropped the sub';
  end if;
  if (select count(*) from pg_temp.seated(v_session)) <> 7 then
    raise exception '2: expected 7 seats after the redraw, got %',
      (select count(*) from pg_temp.seated(v_session));
  end if;

  raise notice '2 PASS  a redraw keeps a seated sub';
end $$;

-- 3. The invitation survives too. Before this change the recreated tables came
--    back at the column default and the meetup silently closed itself.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_open integer;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);

  perform public.draw_league_session(v_session);

  select count(*) into v_open
  from public.matches where session_id = v_session and needs_sub;

  if v_open <> 2 then
    raise exception '3: expected both short tables still open to subs, got %', v_open;
  end if;

  raise notice '3 PASS  a redraw leaves the meetup open to subs';
end $$;

-- 4. And it is only carried when it was set. A meetup nobody opened stays shut,
--    otherwise every draw would advertise itself on Browse.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.draw_league_session(v_session);

  if exists (select 1 from public.matches where session_id = v_session and needs_sub) then
    raise exception '4: a meetup nobody opened came back open';
  end if;

  raise notice '4 PASS  a meetup nobody opened stays closed across a redraw';
end $$;

-- 5. Closing it sticks, as well. "We are covered" must not be undone by the next
--    shuffle.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform public.open_session_to_subs(v_session, false);
  perform public.draw_league_session(v_session);

  if exists (select 1 from public.matches where session_id = v_session and needs_sub) then
    raise exception '5: a closed meetup reopened itself on redraw';
  end if;

  raise notice '5 PASS  closing the meetup to subs survives a redraw';
end $$;

-- 6. Members declining are not dealt, and the table count follows the people who
--    are actually coming.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_out uuid[];
  v_tables integer;
begin
  select array_agg(m) into v_out from (
    select m from pg_temp.members_of(v_session) m offset 4
  ) s;

  insert into public.session_attendance (session_id, profile_id, status)
  select v_session, unnest(v_out), 'out';

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  v_tables := public.draw_league_session(v_session);

  if v_tables <> 1 then
    raise exception '6: expected 1 table for the four remaining, got %', v_tables;
  end if;
  if exists (select 1 from pg_temp.seated(v_session) s where s = any(v_out)) then
    raise exception '6: somebody who said they were out was dealt a seat';
  end if;

  raise notice '6 PASS  members who decline are not dealt in';
end $$;

-- 7. The two together, which is the shape the report actually came from: people
--    drop out, the organizer opens the short table, a sub fills it, and the
--    organizer shuffles again.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_out uuid;
  v_sub uuid := pg_temp.mk_user('Sub');
  v_tables integer;
begin
  select m into v_out from pg_temp.members_of(v_session) m offset 5 limit 1;
  insert into public.session_attendance (session_id, profile_id, status)
  values (v_session, v_out, 'out');

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_sub);

  v_tables := public.draw_league_session(v_session);

  if v_tables <> 2 then
    raise exception '7: expected 2 tables for five members plus a sub, got %', v_tables;
  end if;
  if not exists (select 1 from pg_temp.seated(v_session) s where s = v_sub) then
    raise exception '7: the sub was dropped';
  end if;
  if exists (select 1 from pg_temp.seated(v_session) s where s = v_out) then
    raise exception '7: the member who declined came back';
  end if;
  if pg_temp.table_sizes(v_session) <> array[3, 3] then
    raise exception '7: expected two tables of three, got %', pg_temp.table_sizes(v_session);
  end if;

  raise notice '7 PASS  declines and a sub together deal into even tables';
end $$;

-- 8. A sub is counted into the table maths rather than squeezed in. Four members
--    plus a sub is five people, and five people do not fit at one table.
do $$
declare
  v_session uuid := pg_temp.mk_league(4);
  v_sub uuid := pg_temp.mk_user('Sub');
  v_out uuid;
  v_tables integer;
begin
  -- One member out first, so the draw leaves a chair for the sub to take.
  select m into v_out from pg_temp.members_of(v_session) m offset 3 limit 1;
  insert into public.session_attendance (session_id, profile_id, status)
  values (v_session, v_out, 'out');

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_sub);

  -- Now they can make it after all.
  update public.session_attendance set status = 'in'
  where session_id = v_session and profile_id = v_out;

  v_tables := public.draw_league_session(v_session);

  if v_tables <> 2 then
    raise exception '8: expected 5 people to need 2 tables, got %', v_tables;
  end if;
  if pg_temp.table_sizes(v_session) <> array[3, 2] then
    raise exception '8: expected tables of 3 and 2, got %', pg_temp.table_sizes(v_session);
  end if;
  if (select count(*) from pg_temp.seated(v_session)) <> 5 then
    raise exception '8: expected 5 seats, got %', (select count(*) from pg_temp.seated(v_session));
  end if;

  raise notice '8 PASS  a sub is counted into the table maths, not squeezed in';
end $$;

-- 9. Nobody is seated twice, and every host is a league member rather than a sub.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_subs uuid[] := array[pg_temp.mk_user('Sub A'), pg_temp.mk_user('Sub B')];
  v_seated integer;
  v_distinct integer;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_subs[1]);
  perform pg_temp.seat_sub(v_session, v_subs[2]);

  perform public.draw_league_session(v_session);

  select count(*), count(distinct s) into v_seated, v_distinct
  from pg_temp.seated(v_session) s;

  if v_seated <> v_distinct then
    raise exception '9: somebody holds two seats at one meetup (% seats, % people)',
      v_seated, v_distinct;
  end if;
  if v_seated <> 8 then
    raise exception '9: expected 8 seats, got %', v_seated;
  end if;
  if exists (
    select 1 from public.matches m
    where m.session_id = v_session and m.host_id = any(v_subs)
  ) then
    raise exception '9: a sub was made host while members were available';
  end if;

  raise notice '9 PASS  no double seats, and members host';
end $$;

-- 10. A sub who has since joined the league is dealt as a member, once.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_sub uuid := pg_temp.mk_user('Sub');
  v_league uuid;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_sub);

  select s.league_id into v_league
  from public.league_sessions ls join public.seasons s on s.id = ls.season_id
  where ls.id = v_session;

  insert into public.league_members (league_id, profile_id) values (v_league, v_sub);

  perform public.draw_league_session(v_session);

  if (select count(*) from pg_temp.seated(v_session) s where s = v_sub) <> 1 then
    raise exception '10: the new member was seated % times',
      (select count(*) from pg_temp.seated(v_session) s where s = v_sub);
  end if;

  raise notice '10 PASS  a sub who joined the league is dealt once, as a member';
end $$;

-- 11. A sub who has closed their account is not dealt back in — the same rule
--     members already got, for the same reason: a seat nobody can score.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_sub uuid := pg_temp.mk_user('Sub');
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_sub);

  update public.profiles set deleted_at = now() where id = v_sub;

  perform public.draw_league_session(v_session);

  if exists (select 1 from pg_temp.seated(v_session) s where s = v_sub) then
    raise exception '11: a closed account was dealt back in as a sub';
  end if;

  raise notice '11 PASS  a sub with a closed account is not dealt back in';
end $$;

-- 12. The guards still guard. A played table refuses a redraw, and a meetup
--     where every member is out is not rescued by the presence of a sub — the
--     evening is off, and one table seating only a stranger is a worse answer.
--
--     Three members rather than four, so the drawn table has the empty chair a
--     sub needs; open_session_to_subs deliberately ignores a full one.
do $$
declare
  v_session uuid := pg_temp.mk_league(3);
  v_sub uuid := pg_temp.mk_user('Sub');
  v_played uuid;
  v_caught text;
begin
  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.draw_league_session(v_session);

  select id into v_played from public.matches where session_id = v_session limit 1;
  update public.matches set status = 'completed' where id = v_played;

  begin
    perform public.draw_league_session(v_session);
    raise exception '12: a played table did not stop the redraw';
  exception when others then
    v_caught := sqlerrm;
    if v_caught not like '%already been played%' then raise; end if;
  end;

  update public.matches set status = 'open' where id = v_played;

  -- Everybody out, with a sub still holding a chair.
  perform public.open_session_to_subs(v_session, true);
  perform pg_temp.seat_sub(v_session, v_sub);
  insert into public.session_attendance (session_id, profile_id, status)
  select v_session, m, 'out' from pg_temp.members_of(v_session) m;

  begin
    perform public.draw_league_session(v_session);
    raise exception '12: an all-out meetup drew tables anyway';
  exception when others then
    v_caught := sqlerrm;
    if v_caught not like '%cannot make this meetup%' then raise; end if;
  end;

  raise notice '12 PASS  played-table and all-out guards still hold';
end $$;

-- 13. Only an organizer can shuffle. Security definer plus a sub in the roster is
--     exactly the combination worth re-checking.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_member uuid;
  v_caught text;
begin
  select m into v_member from pg_temp.members_of(v_session) m offset 1 limit 1;
  perform pg_temp.act_as(v_member);

  begin
    perform public.draw_league_session(v_session);
    raise exception '13: an ordinary member drew the tables';
  exception when others then
    v_caught := sqlerrm;
    if v_caught not like '%Only a league organizer%' then raise; end if;
  end;

  raise notice '13 PASS  an ordinary member still cannot draw';
end $$;

rollback;
