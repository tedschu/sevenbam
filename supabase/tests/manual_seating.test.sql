-- Rearranging a meetup's tables by hand.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/manual_seating.test.sql
--
-- One transaction, rolled back at the end. Fixtures duplicated by the same
-- convention as the other test files.

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

create function pg_temp.mk_league(p_member_count integer) returns uuid
language plpgsql as $$
declare
  v_league uuid;
  v_season uuid;
  v_session uuid;
  i integer;
begin
  insert into public.leagues (name, created_by) values ('Test League', pg_temp.mk_user('Organizer'))
  returning id into v_league;

  for i in 2..p_member_count loop
    insert into public.league_members (league_id, profile_id, role)
    values (v_league, pg_temp.mk_user('Member ' || i), 'member');
  end loop;

  insert into public.seasons (league_id, name) values (v_league, 'Season 1')
  returning id into v_season;

  insert into public.league_sessions (season_id, sequence, date_time, location)
  values (v_season, 1, now() + interval '7 days', 'The Beer Cellar')
  returning id into v_session;

  return v_session;
end $$;

create function pg_temp.organizer_of(p_session uuid) returns uuid
language sql as $$
  select lm.profile_id
  from public.league_sessions ls
  join public.seasons s on s.id = ls.season_id
  join public.league_members lm on lm.league_id = s.league_id and lm.role = 'organizer'
  where ls.id = p_session limit 1;
$$;

create function pg_temp.drawn(p_session uuid) returns void
language plpgsql as $$
begin
  perform pg_temp.act_as(pg_temp.organizer_of(p_session));
  perform public.draw_league_session(p_session);
end $$;

/* The current seating, as the editor would send it back: an array of tables,
   each an array of player ids, ordered by table number. */
create function pg_temp.seating(p_session uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(t.players order by t.table_number), '[]'::jsonb)
  from (
    select m.table_number,
           jsonb_agg(to_jsonb(mp.player_id::text) order by mp.player_id) as players
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
    where m.session_id = p_session
    group by m.id, m.table_number
  ) t;
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

create function pg_temp.table_of(p_session uuid, p_player uuid) returns integer
language sql as $$
  select m.table_number
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  where m.session_id = p_session and mp.player_id = p_player;
$$;

-- Scenarios ------------------------------------------------------------------

-- 1. Two players swap tables, and nothing else moves — including the match ids,
--    which is what keeps everybody else's table where it already was in their
--    My Matches.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_seating jsonb;
  v_a uuid;
  v_b uuid;
  v_ids uuid[];
  v_after uuid[];
begin
  perform pg_temp.drawn(v_session);
  v_ids := array(select id from public.matches where session_id = v_session order by table_number);

  v_seating := pg_temp.seating(v_session);
  v_a := ((v_seating -> 0) ->> 0)::uuid;
  v_b := ((v_seating -> 1) ->> 0)::uuid;

  -- Swap the first player of each table.
  v_seating := jsonb_set(v_seating, '{0,0}', to_jsonb(v_b::text));
  v_seating := jsonb_set(v_seating, '{1,0}', to_jsonb(v_a::text));

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.set_session_seating(v_session, v_seating);

  if pg_temp.table_of(v_session, v_a) <> 2 then
    raise exception '1: the first player did not move';
  end if;
  if pg_temp.table_of(v_session, v_b) <> 1 then
    raise exception '1: the second player did not move';
  end if;

  v_after := array(select id from public.matches where session_id = v_session order by table_number);
  if v_after <> v_ids then
    raise exception '1: the tables were rebuilt rather than re-seated';
  end if;

  raise notice '1 PASS  two players swap and the tables keep their identity';
end $$;

-- 2. The host follows the seating. Leave the old one in place and a table ends up
--    scored by somebody who moved away from it.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_seating jsonb;
  v_match uuid;
  v_first uuid;
begin
  perform pg_temp.drawn(v_session);
  v_seating := pg_temp.seating(v_session);

  -- Put the last player of table 1 at its front.
  v_seating := jsonb_set(
    v_seating, '{0}',
    jsonb_build_array((v_seating -> 0) -> -1) ||
    (select jsonb_agg(e) from jsonb_array_elements(v_seating -> 0) with ordinality x(e, n)
     where n < jsonb_array_length(v_seating -> 0)));

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.set_session_seating(v_session, v_seating);

  select id, host_id into v_match, v_first
  from public.matches where session_id = v_session and table_number = 1;

  if v_first <> ((v_seating -> 0) ->> 0)::uuid then
    raise exception '2: the host did not follow the seating';
  end if;
  if not exists (
    select 1 from public.match_players where match_id = v_match and player_id = v_first
  ) then
    raise exception '2: the host is not sitting at their own table';
  end if;

  raise notice '2 PASS  the first player at a table hosts it';
end $$;

-- 3. Emptying a table removes it, and the survivors are renumbered so there is no
--    gap where table 2 used to be.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_seating jsonb;
  v_tables integer;
begin
  perform pg_temp.drawn(v_session);
  v_seating := pg_temp.seating(v_session);

  -- Everybody onto two tables of four... which is what a redraw of eight gives, so
  -- instead collapse to one table of four and drop the rest.
  v_seating := jsonb_build_array(v_seating -> 0);

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  v_tables := public.set_session_seating(v_session, v_seating);

  if v_tables <> 1 then
    raise exception '3: expected one table, got %', v_tables;
  end if;
  if (select count(*) from public.matches where session_id = v_session) <> 1 then
    raise exception '3: the emptied table was left behind';
  end if;
  if (select table_number from public.matches where session_id = v_session) <> 1 then
    raise exception '3: the surviving table was not renumbered';
  end if;

  raise notice '3 PASS  an emptied table is removed and the rest renumbered';
end $$;

-- 4. A table can be added, and the players spread across it.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_seating jsonb;
  v_moved uuid;
begin
  perform pg_temp.drawn(v_session);
  v_seating := pg_temp.seating(v_session);
  v_moved := ((v_seating -> 0) ->> 0)::uuid;

  -- Pull one player off table 1 onto a table of their own.
  v_seating := jsonb_set(
    v_seating, '{0}',
    (select jsonb_agg(e) from jsonb_array_elements(v_seating -> 0) with ordinality x(e, n) where n > 1));
  v_seating := v_seating || jsonb_build_array(jsonb_build_array(to_jsonb(v_moved::text)));

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.set_session_seating(v_session, v_seating);

  if (select count(*) from public.matches where session_id = v_session) <> 3 then
    raise exception '4: the new table was not created';
  end if;
  if pg_temp.table_of(v_session, v_moved) <> 3 then
    raise exception '4: the moved player is not at the new table';
  end if;
  if pg_temp.table_sizes(v_session) <> array[4, 3, 1] then
    raise exception '4: sizes came out as %', pg_temp.table_sizes(v_session)::text;
  end if;

  raise notice '4 PASS  a table can be added and a player moved onto it';
end $$;

-- 5. The refusals. Each one is a thing a broken editor could send, and each has to
--    leave the seating exactly as it was.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_seating jsonb;
  v_before jsonb;
  v_org uuid;
  v_member uuid;
  v_stranger uuid := pg_temp.mk_user('Stranger');
begin
  perform pg_temp.drawn(v_session);
  v_org := pg_temp.organizer_of(v_session);
  v_seating := pg_temp.seating(v_session);
  v_before := v_seating;

  -- An ordinary member.
  select mp.player_id into v_member
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  where m.session_id = v_session and mp.player_id <> v_org
  limit 1;

  perform pg_temp.act_as(v_member);
  begin
    perform public.set_session_seating(v_session, v_seating);
    raise exception '5: an ordinary member rearranged the tables';
  exception when others then
    if sqlerrm not like 'Only a league organizer%' then raise; end if;
  end;

  perform pg_temp.act_as(v_org);

  -- The same person twice.
  begin
    perform public.set_session_seating(
      v_session, jsonb_set(v_seating, '{1,0}', (v_seating -> 0) -> 0));
    raise exception '5: somebody was seated at two tables';
  exception when others then
    if sqlerrm not like 'Somebody is seated at two tables%' then raise; end if;
  end;

  -- Five at a table.
  begin
    perform public.set_session_seating(
      v_session,
      jsonb_build_array((v_seating -> 0) || (v_seating -> 1)));
    raise exception '5: a table of eight was accepted';
  exception when others then
    if sqlerrm not like 'A table seats%' then raise; end if;
  end;

  -- Somebody who is neither a member nor already playing.
  begin
    perform public.set_session_seating(
      v_session, jsonb_set(v_seating, '{0,0}', to_jsonb(v_stranger::text)));
    raise exception '5: a stranger was seated';
  exception when others then
    if sqlerrm not like 'Somebody in this seating is not in the league%' then raise; end if;
  end;

  -- Nothing at all.
  begin
    perform public.set_session_seating(v_session, '[]'::jsonb);
    raise exception '5: an empty meetup was accepted';
  exception when others then
    if sqlerrm not like 'A meetup needs at least one table%' then raise; end if;
  end;

  if pg_temp.seating(v_session) <> v_before then
    raise exception '5: a refused arrangement still changed the seating';
  end if;

  raise notice '5 PASS  every refusal leaves the seating exactly as it was';
end $$;

-- 6. A sub keeps their chair. They are not on the roster by definition, and an
--    organizer tidying the tables must not have to choose between rearranging the
--    room and keeping the stranger who came to fill a seat.
do $$
declare
  v_session uuid := pg_temp.mk_league(6);
  v_org uuid;
  v_sub uuid := pg_temp.mk_user('Sub');
  v_match uuid;
  v_seating jsonb;
begin
  perform pg_temp.drawn(v_session);
  v_org := pg_temp.organizer_of(v_session);

  perform pg_temp.act_as(v_org);
  perform public.open_session_to_subs(v_session, true);

  select m.id into v_match
  from public.matches m
  where m.session_id = v_session and m.needs_sub
    and (select count(*) from public.match_players mp where mp.match_id = m.id)
        < public.match_seat_limit()
  limit 1;

  perform pg_temp.act_as(v_sub);
  insert into public.match_players (match_id, player_id) values (v_match, v_sub);

  perform pg_temp.act_as(v_org);
  v_seating := pg_temp.seating(v_session);
  perform public.set_session_seating(v_session, v_seating);

  if pg_temp.table_of(v_session, v_sub) is null then
    raise exception '6: the sub lost their seat';
  end if;

  raise notice '6 PASS  a sub can be re-seated like anybody else';
end $$;

-- 7. Not once a table has been played. The four scores on a scored table belong to
--    the four people who were sitting at it.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_org uuid;
  v_match uuid;
  v_seating jsonb;
begin
  perform pg_temp.drawn(v_session);
  v_org := pg_temp.organizer_of(v_session);
  v_seating := pg_temp.seating(v_session);

  select id into v_match from public.matches where session_id = v_session limit 1;

  perform pg_temp.act_as(v_org);
  perform public.enter_match_scores(
    v_match,
    (select jsonb_agg(jsonb_build_object('player_id', mp.player_id, 'score', 25))
     from public.match_players mp where mp.match_id = v_match));

  begin
    perform public.set_session_seating(v_session, v_seating);
    raise exception '7: a played meetup was rearranged';
  exception when others then
    if sqlerrm not like 'A table at this meetup has already been played%' then raise; end if;
  end;

  raise notice '7 PASS  a played meetup cannot be rearranged';
end $$;

-- 8. Rearranging tells nobody. Clearing every seat and writing them back looks
--    exactly like eight people dropping out if the notice triggers are not
--    reading the situation correctly.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_seating jsonb;
  v_before integer;
begin
  perform pg_temp.drawn(v_session);
  v_seating := pg_temp.seating(v_session);
  select count(*) into v_before from public.notification_outbox;

  perform pg_temp.act_as(pg_temp.organizer_of(v_session));
  perform public.set_session_seating(v_session, v_seating);

  if (select count(*) from public.notification_outbox) <> v_before then
    raise exception '8: rearranging the tables sent notices';
  end if;

  raise notice '8 PASS  rearranging the tables notifies nobody';
end $$;

rollback;
