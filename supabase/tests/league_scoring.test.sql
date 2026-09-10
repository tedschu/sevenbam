-- Who may record a card, and what the standings say about it afterwards.
--
-- Runs against the local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/league_scoring.test.sql
--
-- One transaction, rolled back at the end; each scenario a DO block that raises on
-- the first thing that is not true. Fixtures are duplicated from the other test
-- files on purpose — see the note at the top of match_notices.test.sql.

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

-- A league of `p_member_count`, one meetup, already in the past so the app would
-- be offering the scores button. Returns the session id.
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
  values (v_season, 1, now() - interval '2 hours', 'The Beer Cellar')
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

create function pg_temp.tables_of(p_session uuid) returns setof uuid
language sql as $$
  select id from public.matches where session_id = p_session order by table_number;
$$;

-- A complete card for one table, every seat a different number so a mixed-up
-- write shows up as the wrong person's total rather than as nothing at all.
create function pg_temp.card(p_match uuid, p_from integer) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object(
    'match_id', p_match,
    'player_id', seat.player_id,
    'score', p_from + seat.n))
  from (
    select mp.player_id, (row_number() over (order by mp.player_id))::int * 10 as n
    from public.match_players mp where mp.match_id = p_match
  ) seat;
$$;

-- The same, with `match_id` stripped — the shape enter_match_scores takes.
create function pg_temp.plain_card(p_match uuid, p_from integer) returns jsonb
language sql as $$
  select jsonb_agg(entry - 'match_id')
  from jsonb_array_elements(pg_temp.card(p_match, p_from)) as entry;
$$;

create function pg_temp.drawn(p_session uuid) returns void
language plpgsql as $$
begin
  perform pg_temp.act_as(pg_temp.organizer_of(p_session));
  perform public.draw_league_session(p_session);
end $$;

-- Scenarios ------------------------------------------------------------------

-- 1. The organizer can record a table they are not sitting at. This is the whole
--    point: the host of a drawn table is whoever the shuffle dealt first.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_table uuid;
begin
  perform pg_temp.drawn(v_session);
  select t into v_table from pg_temp.tables_of(v_session) t limit 1;

  if exists (select 1 from public.matches where id = v_table and host_id = v_org) then
    -- The organizer happened to be dealt this table; use the other one, so the
    -- test is always about somebody else's table.
    select t into v_table from pg_temp.tables_of(v_session) t offset 1 limit 1;
  end if;

  perform pg_temp.act_as(v_org);
  perform public.enter_match_scores(v_table, pg_temp.plain_card(v_table, 0));

  if (select status from public.matches where id = v_table) <> 'completed' then
    raise exception '1: the table was not completed';
  end if;
  if exists (select 1 from public.match_players where match_id = v_table and score is null) then
    raise exception '1: a seat was left unscored';
  end if;

  raise notice '1 PASS  an organizer can score a table they do not host';
end $$;

-- 2. An ordinary member still cannot. Widening this to organizers must not have
--    widened it to everybody.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_table uuid;
  v_member uuid;
begin
  perform pg_temp.drawn(v_session);
  select t into v_table from pg_temp.tables_of(v_session) t limit 1;

  select mp.player_id into v_member
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where mp.match_id = v_table and mp.player_id <> m.host_id
  limit 1;

  perform pg_temp.act_as(v_member);
  begin
    perform public.enter_match_scores(v_table, pg_temp.plain_card(v_table, 0));
    raise exception '2: an ordinary member scored a table';
  exception when others then
    if sqlerrm not like 'Only the host or a league organizer%' then raise; end if;
  end;

  raise notice '2 PASS  an ordinary member still cannot score';
end $$;

-- 3. The table's own host keeps the right they already had, league or not.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_table uuid;
  v_host uuid;
begin
  perform pg_temp.drawn(v_session);
  select t into v_table from pg_temp.tables_of(v_session) t limit 1;
  select host_id into v_host from public.matches where id = v_table;

  perform pg_temp.act_as(v_host);
  perform public.enter_match_scores(v_table, pg_temp.plain_card(v_table, 0));

  if (select status from public.matches where id = v_table) <> 'completed' then
    raise exception '3: the host could not score their own table';
  end if;

  raise notice '3 PASS  the table host can still score their own table';
end $$;

-- 4. The whole meetup in one call, which is the shape the evening actually has.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_payload jsonb := '[]'::jsonb;
  v_table uuid;
  v_written integer;
begin
  perform pg_temp.drawn(v_session);

  for v_table in select t from pg_temp.tables_of(v_session) t loop
    v_payload := v_payload || pg_temp.card(v_table, 0);
  end loop;

  perform pg_temp.act_as(v_org);
  v_written := public.enter_session_scores(v_session, v_payload);

  if v_written <> 2 then
    raise exception '4: expected two tables written, got %', v_written;
  end if;
  if exists (
    select 1 from public.matches where session_id = v_session and status <> 'completed'
  ) then
    raise exception '4: a table was left open';
  end if;

  raise notice '4 PASS  one call scores every table at a meetup';
end $$;

-- 5. Naming one table leaves the other exactly as it was. Three tables play and
--    the fourth goes to the pub; a week later one card is queried and re-entered.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_first uuid;
  v_second uuid;
begin
  perform pg_temp.drawn(v_session);
  select t into v_first from pg_temp.tables_of(v_session) t limit 1;
  select t into v_second from pg_temp.tables_of(v_session) t offset 1 limit 1;

  perform pg_temp.act_as(v_org);
  perform public.enter_session_scores(v_session, pg_temp.card(v_first, 0));

  if (select status from public.matches where id = v_first) <> 'completed' then
    raise exception '5: the named table was not scored';
  end if;
  if (select status from public.matches where id = v_second) = 'completed' then
    raise exception '5: an unnamed table was completed';
  end if;
  if exists (select 1 from public.match_players where match_id = v_second and score is not null) then
    raise exception '5: an unnamed table was scored';
  end if;

  raise notice '5 PASS  tables nobody named are left alone';
end $$;

-- 6. A table belonging to another meetup, and an incomplete card, are both
--    refused — and refusing takes the rest of the payload with it. A network
--    failure halfway through must not leave half a meetup counted.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_other uuid := pg_temp.mk_league(8);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_first uuid;
  v_stranger uuid;
begin
  perform pg_temp.drawn(v_session);
  perform pg_temp.drawn(v_other);
  select t into v_first from pg_temp.tables_of(v_session) t limit 1;
  select t into v_stranger from pg_temp.tables_of(v_other) t limit 1;

  perform pg_temp.act_as(v_org);

  begin
    perform public.enter_session_scores(
      v_session, pg_temp.card(v_first, 0) || pg_temp.card(v_stranger, 0));
    raise exception '6: another meetup''s table was accepted';
  exception when others then
    if sqlerrm not like 'That table is not part of this meetup%' then raise; end if;
  end;

  if exists (select 1 from public.match_players where match_id = v_first and score is not null) then
    raise exception '6: a rejected payload still wrote scores';
  end if;

  -- Half a card for a table that is named.
  begin
    perform public.enter_session_scores(
      v_session,
      (select jsonb_agg(entry) from jsonb_array_elements(pg_temp.card(v_first, 0)) with ordinality t(entry, n) where n <= 2));
    raise exception '6: an incomplete card was accepted';
  exception when others then
    if sqlerrm not like 'Expected % scores%' then raise; end if;
  end;

  raise notice '6 PASS  stray tables and half cards are refused, and write nothing';
end $$;

-- 7. A member of the league who runs nothing cannot score the meetup either, and
--    a table host may score their own through the meetup call.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_first uuid;
  v_second uuid;
  v_host uuid;
  v_member uuid;
begin
  perform pg_temp.drawn(v_session);
  select t into v_first from pg_temp.tables_of(v_session) t limit 1;
  select t into v_second from pg_temp.tables_of(v_session) t offset 1 limit 1;
  select host_id into v_host from public.matches where id = v_first;

  select mp.player_id into v_member
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where mp.match_id = v_second and mp.player_id <> m.host_id
  limit 1;

  perform pg_temp.act_as(v_member);
  begin
    perform public.enter_session_scores(v_session, pg_temp.card(v_second, 0));
    raise exception '7: an ordinary member scored a meetup table';
  exception when others then
    if sqlerrm not like 'Only an organizer or the table%' then raise; end if;
  end;

  perform pg_temp.act_as(v_host);
  perform public.enter_session_scores(v_session, pg_temp.card(v_first, 0));
  if (select status from public.matches where id = v_first) <> 'completed' then
    raise exception '7: a table host could not score their own table here';
  end if;

  -- ...and only their own.
  begin
    perform public.enter_session_scores(v_session, pg_temp.card(v_second, 0));
    raise exception '7: a table host scored somebody else''s table';
  exception when others then
    if sqlerrm not like 'Only an organizer or the table%' then raise; end if;
  end;

  raise notice '7 PASS  a table host scores their own table and no others';
end $$;

-- 8. Who to ask about a number. Stamped when it is written, and *not* re-stamped
--    when the same card is saved again — a line claiming somebody revised a score
--    they only looked at is worse than no line.
--
--    Compared seat by seat, because `clock_timestamp()` is evaluated per row: the
--    four seats of one card are stamped microseconds apart, and a check that read
--    one seat's stamp and compared it against the table would fail on the gap.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_table uuid;
  v_seat uuid;
  v_bystander uuid;
  v_stamp timestamptz;
  v_bystander_stamp timestamptz;
begin
  perform pg_temp.drawn(v_session);
  select t into v_table from pg_temp.tables_of(v_session) t limit 1;

  perform pg_temp.act_as(v_org);
  perform public.enter_session_scores(v_session, pg_temp.card(v_table, 0));

  if exists (
    select 1 from public.match_players
    where match_id = v_table and (score_updated_at is null or score_updated_by is null)
  ) then
    raise exception '8: a written score carries no stamp';
  end if;
  if exists (
    select 1 from public.match_players where match_id = v_table and score_updated_by <> v_org
  ) then
    raise exception '8: the stamp names somebody other than the writer';
  end if;

  select player_id into v_seat
  from public.match_players where match_id = v_table order by player_id limit 1;
  select player_id into v_bystander
  from public.match_players where match_id = v_table order by player_id desc limit 1;

  select score_updated_at into v_stamp
  from public.match_players where match_id = v_table and player_id = v_seat;
  select score_updated_at into v_bystander_stamp
  from public.match_players where match_id = v_table and player_id = v_bystander;

  -- The same numbers again.
  perform public.enter_session_scores(v_session, pg_temp.card(v_table, 0));

  if (select score_updated_at from public.match_players
      where match_id = v_table and player_id = v_seat) <> v_stamp then
    raise exception '8: saving an unchanged card re-dated it';
  end if;

  -- One number actually changes, and only that seat moves.
  perform public.enter_session_scores(
    v_session,
    (select jsonb_agg(
       case when (entry ->> 'player_id')::uuid = v_seat
         then jsonb_set(entry, '{score}', '999'::jsonb)
         else entry end)
     from jsonb_array_elements(pg_temp.card(v_table, 0)) as entry));

  if (select score_updated_at from public.match_players
      where match_id = v_table and player_id = v_seat) = v_stamp then
    raise exception '8: a changed score was not re-dated';
  end if;
  if (select score from public.match_players
      where match_id = v_table and player_id = v_seat) <> 999 then
    raise exception '8: the corrected number was not written';
  end if;
  if (select score_updated_at from public.match_players
      where match_id = v_table and player_id = v_bystander) <> v_bystander_stamp then
    raise exception '8: correcting one number re-dated the whole table';
  end if;

  raise notice '8 PASS  the stamp follows the number, not the save';
end $$;

-- 9. And the standings can say it. Both boards, because the same member reads
--    both and a line that shows on one looks broken on the other.
do $$
declare
  v_session uuid := pg_temp.mk_league(8);
  v_org uuid := pg_temp.organizer_of(v_session);
  v_league uuid;
  v_table uuid;
  v_player uuid;
  v_name text;
begin
  perform pg_temp.drawn(v_session);
  select t into v_table from pg_temp.tables_of(v_session) t limit 1;
  select league_id into v_league from public.matches where id = v_table;

  perform pg_temp.act_as(v_org);
  perform public.enter_session_scores(v_session, pg_temp.card(v_table, 0));

  select player_id into v_player from public.match_players where match_id = v_table limit 1;

  select score_updated_by_name into v_name
  from public.league_standings where league_id = v_league and player_id = v_player;
  if v_name <> 'Organizer' then
    raise exception '9: league standings said % scored it', coalesce(v_name, '<null>');
  end if;

  select score_updated_by_name into v_name
  from public.leaderboard where player_id = v_player;
  if v_name <> 'Organizer' then
    raise exception '9: the all-matches board said % scored it', coalesce(v_name, '<null>');
  end if;

  if (select score_updated_at from public.leaderboard where player_id = v_player) is null then
    raise exception '9: no date on the board';
  end if;

  raise notice '9 PASS  both boards say who last touched the number';
end $$;

rollback;
