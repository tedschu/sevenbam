-- Who gets told when a pick-up table fills up, and when it comes apart again.
--
-- Runs against the local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/match_notices.test.sql
--
-- Same shape as dropout_notices.test.sql: one transaction, rolled back at the end,
-- each scenario a DO block that raises on the first thing that is not true. The
-- fixtures are deliberately duplicated rather than shared — a psql script has no
-- import, and a file of test helpers that both files must agree about is a worse
-- coupling than thirty repeated lines.

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

-- A match posted to Browse. `seat_host_after_match_insert` takes the host's chair,
-- so this comes back with one of four seats already filled.
create function pg_temp.mk_match(p_host uuid, p_when timestamptz default null)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.matches (host_id, date_time, location, location_detail)
  values (p_host, coalesce(p_when, now() + interval '10 days'),
          'The Church Hall', '12 Mill Lane')
  returning id into v_id;
  return v_id;
end $$;

-- Filling seats the way the app does: an ordinary insert, so the capacity trigger,
-- the status sync and the notice triggers all run exactly as they would for a real
-- Join. Returns the players it seated, in the order it seated them.
create function pg_temp.seat(p_match uuid, p_count integer)
returns uuid[]
language plpgsql as $$
declare
  v_players uuid[] := '{}';
  v_player uuid;
  i integer;
begin
  for i in 1..p_count loop
    v_player := pg_temp.mk_user('Player ' || i);
    insert into public.match_players (match_id, player_id) values (p_match, v_player);
    v_players := v_players || v_player;
  end loop;
  return v_players;
end $$;

create function pg_temp.notices(p_match uuid, p_kind text) returns setof uuid
language sql as $$
  select recipient_id from public.notification_outbox
  where match_id = p_match and kind = p_kind;
$$;

create function pg_temp.notice_count(p_match uuid, p_kind text) returns integer
language sql as $$
  select count(*)::integer from public.notification_outbox
  where match_id = p_match and kind = p_kind;
$$;

-- Scenarios ------------------------------------------------------------------

-- 1. The fourth seat tells all four, the player who took it included.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
begin
  v_players := pg_temp.seat(v_match, 3);

  if pg_temp.notice_count(v_match, 'match_full') <> 4 then
    raise exception '1: expected four notices, got %',
      pg_temp.notice_count(v_match, 'match_full');
  end if;

  if not exists (select 1 from pg_temp.notices(v_match, 'match_full') r where r = v_host) then
    raise exception '1: the host was not told';
  end if;

  -- v_players[3] took the last chair and is the subject of the notice; they are
  -- still one of the four people it goes to.
  if not exists (
    select 1 from pg_temp.notices(v_match, 'match_full') r where r = v_players[3]
  ) then
    raise exception '1: the player who filled the table was not told';
  end if;

  if not exists (
    select 1 from public.notification_outbox
    where match_id = v_match and kind = 'match_full' and subject_id = v_players[3]
  ) then
    raise exception '1: the notice does not name the player who filled the table';
  end if;

  raise notice '1 PASS  the fourth seat tells all four';
end $$;

-- 2. Three is not four. A table still short says nothing to anybody.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
begin
  perform pg_temp.seat(v_match, 2);

  if pg_temp.notice_count(v_match, 'match_full') <> 0 then
    raise exception '2: a table of three sent %',
      pg_temp.notice_count(v_match, 'match_full');
  end if;

  raise notice '2 PASS  a table of three tells nobody';
end $$;

-- 3. Losing the fourth tells the three still coming, and not the one who left.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
  v_leaver uuid;
begin
  v_players := pg_temp.seat(v_match, 3);
  v_leaver := v_players[1];

  delete from public.match_players where match_id = v_match and player_id = v_leaver;

  if pg_temp.notice_count(v_match, 'match_reopened') <> 3 then
    raise exception '3: expected three notices, got %',
      pg_temp.notice_count(v_match, 'match_reopened');
  end if;

  if exists (select 1 from pg_temp.notices(v_match, 'match_reopened') r where r = v_leaver) then
    raise exception '3: the player who left was told the seat they vacated is free';
  end if;

  if not exists (select 1 from pg_temp.notices(v_match, 'match_reopened') r where r = v_host) then
    raise exception '3: the host was not told';
  end if;

  raise notice '3 PASS  losing the fourth tells the three still coming';
end $$;

-- 4. Once, not twice. The reopen notice says everything the drop-out notice would
--    and adds what to do about it, so the host must not receive both.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
begin
  v_players := pg_temp.seat(v_match, 3);
  delete from public.match_players where match_id = v_match and player_id = v_players[1];

  if pg_temp.notice_count(v_match, 'dropout') <> 0 then
    raise exception '4: the host was also sent a drop-out notice';
  end if;

  raise notice '4 PASS  a reopened table does not also send a drop-out notice';
end $$;

-- 5. A table that was already short is not "reopened" — it never closed. The host
--    still hears about the withdrawal the way they always did.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
begin
  v_players := pg_temp.seat(v_match, 2);
  delete from public.match_players where match_id = v_match and player_id = v_players[1];

  if pg_temp.notice_count(v_match, 'match_reopened') <> 0 then
    raise exception '5: a table of three to two claimed to have reopened';
  end if;

  if not exists (select 1 from pg_temp.notices(v_match, 'dropout') r where r = v_host) then
    raise exception '5: the host was not told about the withdrawal';
  end if;

  raise notice '5 PASS  three to two still sends the host a drop-out notice';
end $$;

-- 6. Refilling says so again. The evening went off and came back on, and the
--    second piece of news is as worth having as the first.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
begin
  v_players := pg_temp.seat(v_match, 3);
  delete from public.match_players where match_id = v_match and player_id = v_players[1];
  perform pg_temp.seat(v_match, 1);

  if pg_temp.notice_count(v_match, 'match_full') <> 8 then
    raise exception '6: expected two rounds of four, got %',
      pg_temp.notice_count(v_match, 'match_full');
  end if;

  raise notice '6 PASS  a refilled table says the game is back on';
end $$;

-- 7. League tables are none of this. Their seats are dealt rather than claimed, so
--    a fourth arriving is not news, and everyone at one hears through the league.
do $$
declare
  v_host uuid := pg_temp.mk_user('Organizer');
  v_league uuid;
  v_match uuid;
  v_players uuid[];
begin
  insert into public.leagues (name, created_by) values ('Test League', v_host)
  returning id into v_league;

  insert into public.matches (host_id, date_time, location, league_id)
  values (v_host, now() + interval '10 days', 'The Church Hall', v_league)
  returning id into v_match;

  v_players := pg_temp.seat(v_match, 3);

  if pg_temp.notice_count(v_match, 'match_full') <> 0 then
    raise exception '7: a league table announced itself full';
  end if;

  delete from public.match_players where match_id = v_match and player_id = v_players[1];

  if pg_temp.notice_count(v_match, 'match_reopened') <> 0 then
    raise exception '7: a league table announced itself reopened';
  end if;

  raise notice '7 PASS  league tables send neither notice';
end $$;

-- 8. Nothing about a night that has already happened. This is the case account
--    deletion walks into — it sheds every future seat at once — and the guard that
--    stops it is the same one.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host, now() - interval '2 days');
  v_players uuid[];
begin
  v_players := pg_temp.seat(v_match, 3);

  if pg_temp.notice_count(v_match, 'match_full') <> 0 then
    raise exception '8: a match in the past announced itself full';
  end if;

  delete from public.match_players where match_id = v_match and player_id = v_players[1];

  if pg_temp.notice_count(v_match, 'match_reopened') <> 0 then
    raise exception '8: a match in the past announced itself reopened';
  end if;

  raise notice '8 PASS  a match in the past sends neither notice';
end $$;

-- 9. The sender can read what it needs in one go: who, where, when, and whose
--    table it is. The view is what the edge function actually selects from, and a
--    notice it cannot address is a notice that never leaves the queue.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_row record;
begin
  perform pg_temp.seat(v_match, 3);

  select * into v_row
  from public.pending_notifications
  where kind = 'match_full' and recipient_name = 'Host'
  limit 1;

  if v_row is null then
    raise exception '9: the notice is not visible to the sender';
  end if;
  if v_row.recipient_email is null then
    raise exception '9: no address to send to';
  end if;
  if v_row.host_name <> 'Host' then
    raise exception '9: host_name was %', coalesce(v_row.host_name, '<null>');
  end if;
  if v_row.location <> 'The Church Hall' or v_row.location_detail <> '12 Mill Lane' then
    raise exception '9: the venue did not come through';
  end if;
  if v_row.league_name is not null then
    raise exception '9: a pick-up game was labelled with a league';
  end if;

  raise notice '9 PASS  the sender reads who, where, when and whose table';
end $$;

-- Preferences and unsubscribing -----------------------------------------------

create function pg_temp.token_of(p_profile uuid) returns uuid
language sql as $$
  select unsubscribe_token from public.notification_settings where profile_id = p_profile;
$$;

-- 10. Every profile has somewhere to record an answer, from the moment it exists.
--     The sender reads the token through a join, so a profile without a row is a
--     mail with no unsubscribe link in it.
do $$
declare
  v_person uuid := pg_temp.mk_user('Newcomer');
  v_settings record;
begin
  select * into v_settings
  from public.notification_settings where profile_id = v_person;

  if v_settings is null then
    raise exception '10: a new profile has no notification settings';
  end if;
  if not v_settings.game_is_on or not v_settings.someone_drops_out then
    raise exception '10: a new profile starts opted out';
  end if;
  if v_settings.unsubscribe_token is null then
    raise exception '10: a new profile has no unsubscribe token';
  end if;

  raise notice '10 PASS  a new profile starts opted in, with a token';
end $$;

-- 11. Switching off "the game is on" leaves that person out of the mail and
--     nobody else. Checked at the queue rather than at the send, so there is
--     nothing left behind to wake the drain with.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
begin
  update public.notification_settings set game_is_on = false where profile_id = v_host;

  v_players := pg_temp.seat(v_match, 3);

  if exists (select 1 from pg_temp.notices(v_match, 'match_full') r where r = v_host) then
    raise exception '11: a member who switched it off was queued a notice anyway';
  end if;
  if pg_temp.notice_count(v_match, 'match_full') <> 3 then
    raise exception '11: expected the other three to be told, got %',
      pg_temp.notice_count(v_match, 'match_full');
  end if;

  raise notice '11 PASS  switching off game_is_on silences that member only';
end $$;

-- 12. One switch covers both ways of hearing that somebody cannot make it, which
--     is the grouping the profile screen offers and the thing the unsubscribe
--     link in a "seat opened up" mail promises.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
  v_short uuid := pg_temp.mk_match(v_host);
begin
  update public.notification_settings
  set someone_drops_out = false where profile_id = v_host;

  v_players := pg_temp.seat(v_match, 3);
  delete from public.match_players where match_id = v_match and player_id = v_players[1];

  if exists (select 1 from pg_temp.notices(v_match, 'match_reopened') r where r = v_host) then
    raise exception '12: the host was told a seat opened after switching it off';
  end if;

  -- The drop-out notice, which was sending before there was a switch at all.
  perform pg_temp.seat(v_short, 2);
  delete from public.match_players
  where match_id = v_short
    and player_id = (select player_id from public.match_players
                     where match_id = v_short and player_id <> v_host limit 1);

  if pg_temp.notice_count(v_short, 'dropout') <> 0 then
    raise exception '12: the drop-out notice ignored the switch';
  end if;

  raise notice '12 PASS  someone_drops_out covers both ways of hearing it';
end $$;

-- 13. The link in the mail. Flips the switch without a session, and takes the
--     already-queued mail with it — the whole point being that nothing arrives
--     after somebody has asked us to stop.
do $$
declare
  v_host uuid := pg_temp.mk_user('Host');
  v_match uuid := pg_temp.mk_match(v_host);
  v_players uuid[];
  v_other uuid;
begin
  v_players := pg_temp.seat(v_match, 3);
  v_other := v_players[1];

  if pg_temp.notice_count(v_match, 'match_full') <> 4 then
    raise exception '13: the fixture did not queue four notices';
  end if;

  if not public.unsubscribe_by_token(pg_temp.token_of(v_host), 'game_is_on') then
    raise exception '13: a valid token was not accepted';
  end if;

  if (select game_is_on from public.notification_settings where profile_id = v_host) then
    raise exception '13: the switch was not turned off';
  end if;

  if exists (select 1 from pg_temp.notices(v_match, 'match_full') r where r = v_host) then
    raise exception '13: a queued notice survived the unsubscribe';
  end if;

  if not exists (select 1 from pg_temp.notices(v_match, 'match_full') r where r = v_other) then
    raise exception '13: somebody else lost their notice too';
  end if;

  if not (select someone_drops_out from public.notification_settings where profile_id = v_host) then
    raise exception '13: unsubscribing from one switch turned off the other';
  end if;

  raise notice '13 PASS  a token unsubscribes and clears what was queued';
end $$;

-- 14. An expired or mangled token says so rather than throwing, so the endpoint
--     can show a page instead of a stack trace. An unknown switch does throw:
--     that is our own link being built wrong, not the reader's problem.
do $$
declare
  v_person uuid := pg_temp.mk_user('Reader');
begin
  if public.unsubscribe_by_token(gen_random_uuid(), 'game_is_on') then
    raise exception '14: an unknown token was accepted';
  end if;

  begin
    perform public.unsubscribe_by_token(pg_temp.token_of(v_person), 'not_a_switch');
    raise exception '14: an unknown switch was accepted';
  exception when others then
    if sqlerrm <> 'Unknown notification setting.' then
      raise;
    end if;
  end;

  raise notice '14 PASS  a bad token is refused quietly, a bad switch loudly';
end $$;

rollback;
