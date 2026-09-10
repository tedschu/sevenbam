-- Moving people between tables by hand.
--
-- The draw is a shuffle, and a shuffle is right most weeks and wrong in all the
-- ways a room full of people is complicated. Two members who car-share get dealt
-- to tables that finish an hour apart. A beginner lands with three of the
-- strongest players in the league. Somebody's ex is at their table. None of that
-- is a bug in the deal, and none of it can be fixed by dealing again — a redraw is
-- a different random answer, not a better one, and it moves fifteen other people
-- to solve one problem.
--
-- So the shuffle stays exactly as it is and this sits beside it: the organizer
-- names the seating they want, and it is written.
--
-- Whole-meetup rather than one move at a time, and for the same reason
-- `enter_session_scores` is: the organizer is rearranging a room, and a sequence
-- of individual moves has no valid intermediate state. Swapping two players is two
-- moves, and between them somebody is at two tables or at none. One call, one
-- transaction, one arrangement that is either written or not.
create or replace function public.set_session_seating(p_session_id uuid, p_tables jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league uuid;
  v_when timestamptz;
  v_location text;
  v_detail text;
  v_latitude double precision;
  v_longitude double precision;
  v_time_zone text;
  v_seats integer := public.match_seat_limit();
  v_existing uuid[];
  v_existing_count integer;
  v_wanted integer;
  v_players uuid[];
  v_everyone uuid[];
  v_match uuid;
  v_was_open boolean;
  i integer;
begin
  select se.league_id, ls.date_time, ls.location, ls.location_detail,
         ls.latitude, ls.longitude, ls.time_zone
    into v_league, v_when, v_location, v_detail,
         v_latitude, v_longitude, v_time_zone
  from public.league_sessions ls
  join public.seasons se on se.id = ls.season_id
  where ls.id = p_session_id;

  if v_league is null then
    raise exception 'That meetup no longer exists.';
  end if;

  -- The whole reason this bypasses RLS: seating other people is not something the
  -- `matches` update policy permits anybody to do, host included.
  if not public.is_league_organizer(v_league) then
    raise exception 'Only a league organizer can move players between tables.';
  end if;

  -- The same guard the redraw has, for the same reason. Once a table is scored,
  -- its four scores belong to the four people who were sitting at it; moving one
  -- of them elsewhere would leave a number attached to a seat nobody was in.
  if exists (
    select 1 from public.matches m
    where m.session_id = p_session_id and m.status = 'completed'
  ) then
    raise exception 'A table at this meetup has already been played. Moving players now would erase its scores.';
  end if;

  v_wanted := coalesce(jsonb_array_length(p_tables), 0);
  if v_wanted = 0 then
    raise exception 'A meetup needs at least one table.';
  end if;

  -- Everybody named, flattened, so the checks below are about the arrangement as
  -- a whole rather than about one table at a time.
  select array_agg((seat.value #>> '{}')::uuid)
    into v_everyone
  from jsonb_array_elements(p_tables) as t(tbl),
       jsonb_array_elements(t.tbl) as seat(value);

  if v_everyone is null then
    raise exception 'A meetup needs at least one player.';
  end if;

  -- The one-seat-per-meetup trigger would catch this on the way in, but only
  -- after some of the writes had happened and with a message about joining a
  -- table. Said here, it is about the arrangement the organizer is looking at.
  if array_length(v_everyone, 1) <> (select count(distinct x) from unnest(v_everyone) x) then
    raise exception 'Somebody is seated at two tables.';
  end if;

  -- On the roster, or already sitting here.
  --
  -- The second half is what keeps subs seatable. A sub is by definition not a
  -- member — that is the whole point of `needs_sub` — and an organizer tidying the
  -- tables must not have to choose between rearranging the room and keeping the
  -- stranger who came to fill a chair.
  --
  -- Read before anything is deleted, because "already sitting here" stops being
  -- true the moment the seats are cleared.
  if exists (
    select 1 from unnest(v_everyone) as x(id)
    where not exists (
      select 1
      from public.league_members lm
      join public.profiles p on p.id = lm.profile_id and p.deleted_at is null
      where lm.league_id = v_league and lm.profile_id = x.id
    )
    and not exists (
      select 1
      from public.matches m
      join public.match_players mp on mp.match_id = m.id
      join public.profiles p on p.id = mp.player_id and p.deleted_at is null
      where m.session_id = p_session_id and mp.player_id = x.id
    )
  ) then
    raise exception 'Somebody in this seating is not in the league and was not already playing.';
  end if;

  -- Whether the meetup was open to subs, as one fact about the meetup. Re-applied
  -- at the end rather than preserved per table, exactly as the redraw does it —
  -- table numbers do not survive a rearrangement in any meaningful sense.
  select coalesce(bool_or(m.needs_sub), false)
    into v_was_open
  from public.matches m where m.session_id = p_session_id;

  -- Existing tables are reused rather than replaced, in order.
  --
  -- The redraw deletes every match and makes new ones, which is right for a
  -- redraw: it is a new arrangement and nobody's old table means anything. This is
  -- the opposite — it is usually two people swapping — and a new match id would
  -- take the table out of everybody's My Matches and put a different one back,
  -- for a change that moved nobody.
  v_existing := array(
    select m.id from public.matches m
    where m.session_id = p_session_id
    order by m.table_number nulls last, m.id
  );
  v_existing_count := coalesce(array_length(v_existing, 1), 0);

  -- Seats first, and all of them, so the capacity and one-seat-per-meetup triggers
  -- see a clean slate rather than the arrangement being replaced. Half a swap is
  -- exactly what those triggers exist to refuse.
  --
  -- Silent: `notice_match_dropout` returns early for anything with a session, and
  -- the pick-up notices only fire for matches with no league. Nobody dropped out,
  -- the room was rearranged.
  delete from public.match_players mp
  using public.matches m
  where mp.match_id = m.id and m.session_id = p_session_id;

  -- Tables nobody is at any more.
  if v_existing_count > v_wanted then
    delete from public.matches where id = any(v_existing[v_wanted + 1:]);
  end if;

  for i in 1..v_wanted loop
    v_players := array(
      select (seat.value #>> '{}')::uuid
      from jsonb_array_elements(p_tables -> (i - 1)) as seat(value)
    );

    -- An empty table is not an arrangement, it is a heading. The editor drops them
    -- before sending, and this is the backstop.
    if v_players is null or array_length(v_players, 1) = 0 then
      raise exception 'A table needs at least one player.';
    end if;

    if array_length(v_players, 1) > v_seats then
      raise exception 'A table seats % players.', v_seats;
    end if;

    if i <= v_existing_count then
      v_match := v_existing[i];

      -- The first player at a table hosts it, the same rule the draw uses. What
      -- matters is that it is somebody actually sitting there: leave the old host
      -- in place and a table can end up scored by a person who moved away from it.
      --
      -- `status` is reset because a table that filled up is being re-seated and may
      -- not be full any more; `sync_match_status` puts it back to 'full' on the way
      -- in if it is. A table the organizer had called off is reopened by being
      -- given players, which is what giving it players means.
      update public.matches
      set table_number = i,
          host_id = v_players[1],
          status = 'open'
      where id = v_match;

      insert into public.match_players (match_id, player_id)
      select v_match, unnest(v_players);
    else
      insert into public.matches (
        host_id, date_time, location, location_detail, latitude, longitude, time_zone,
        league_id, session_id, table_number, status
      )
      values (
        v_players[1], v_when, v_location, v_detail, v_latitude, v_longitude, v_time_zone,
        v_league, p_session_id, i, 'open'
      )
      returning id into v_match;

      -- The host's own seat is taken by seat_host_on_match_insert.
      if array_length(v_players, 1) > 1 then
        insert into public.match_players (match_id, player_id)
        select v_match, unnest(v_players[2:]);
      end if;
    end if;
  end loop;

  if v_was_open then
    perform public.open_session_to_subs(p_session_id, true);
  end if;

  return v_wanted;
end;
$$;

revoke all on function public.set_session_seating(uuid, jsonb) from public, anon;
grant execute on function public.set_session_seating(uuid, jsonb) to authenticated;

comment on function public.set_session_seating(uuid, jsonb) is
  'Writes a meetup''s seating as the organizer arranged it. Takes an array of tables, each an array of player ids, and reuses the existing matches in order so a small change does not rebuild everybody''s table.';
