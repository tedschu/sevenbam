-- A redraw stops throwing the subs out.
--
-- Reported from a real league: the organizer shuffles, and the sub who had agreed
-- to fill a chair is simply gone. It was never a bug in the shuffle so much as an
-- omission in what the shuffle knows about. `draw_league_session` clears the
-- meetup —
--
--   delete from public.matches where session_id = p_session_id;
--
-- — and `match_players.match_id` is ON DELETE CASCADE, so every seat goes with it.
-- The tables are then refilled from `league_members`, and a sub is by definition
-- the one person who is not in that table. Members get dealt again; the sub does
-- not exist as far as the roster query is concerned.
--
-- Two things were lost, and both are fixed here.
--
--   1. The sub's seat. Non-members holding a chair at this meetup are read before
--      the delete and dealt back in with everybody else.
--
--   2. The invitation itself. `needs_sub` lives on the `matches` row, so the
--      delete took it too and the recreated tables came back at the column
--      default of false. A meetup the organizer had opened to subs quietly closed
--      itself every time they shuffled.
--
-- Everything else is exactly as it was: the shuffle, the round-robin deal, the
-- attendance filter, the closed-account filter and the played-table guard.
create or replace function public.draw_league_session(p_session_id uuid)
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
  v_seats integer := public.match_seat_limit();
  v_roster uuid[];
  v_subs uuid[];
  v_was_open boolean;
  v_count integer;
  v_members integer;
  v_tables integer;
  v_seatmates uuid[];
  v_match uuid;
  i integer;
begin
  select se.league_id, ls.date_time, ls.location, ls.location_detail, ls.latitude, ls.longitude
    into v_league, v_when, v_location, v_detail, v_latitude, v_longitude
  from public.league_sessions ls
  join public.seasons se on se.id = ls.season_id
  where ls.id = p_session_id;

  if v_league is null then
    raise exception 'Session not found.';
  end if;

  if not public.is_league_organizer(v_league) then
    raise exception 'Only a league organizer can draw the tables.';
  end if;

  if exists (
    select 1 from public.matches
    where session_id = p_session_id and status = 'completed'
  ) then
    raise exception 'A table in this session has already been played. Redrawing would erase its scores.';
  end if;

  -- Read before the delete, because the delete is what destroys them.
  --
  -- "Sub" is not a stored role anywhere — it is simply somebody sitting at this
  -- meetup who is not a member of the league, which is precisely who the
  -- `needs_sub` insert policy lets through. So it is derived here rather than
  -- looked up, and derived per meetup: a stranger at last week's table is not a
  -- sub for this one.
  --
  -- `distinct` rather than a bare array_agg because the one-seat-per-meetup rule
  -- only arrived in 20260827160000, and a league that predates it can still hold
  -- a double booking that would otherwise be dealt in twice.
  --
  -- Nothing filters these on attendance. It would be dead code: the
  -- `session_attendance` policies are member-gated, so a sub has no way to answer
  -- and never has a row to find.
  select array_agg(s.player_id order by random())
    into v_subs
  from (
    select distinct mp.player_id
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    join public.profiles p on p.id = mp.player_id
    where m.session_id = p_session_id
      and p.deleted_at is null
      and not exists (
        select 1
        from public.league_members lm
        where lm.league_id = v_league
          and lm.profile_id = mp.player_id
      )
  ) s;

  -- Whether this meetup was open to subs, as one fact about the meetup rather
  -- than one per table. That is how `open_session_to_subs` sets it and how the
  -- organizer thinks about it — "we are short this week" — and table numbers do
  -- not survive a redraw in any meaningful sense anyway, so there is no per-table
  -- state worth carrying across.
  select coalesce(bool_or(m.needs_sub), false)
    into v_was_open
  from public.matches m
  where m.session_id = p_session_id;

  delete from public.matches where session_id = p_session_id;

  -- order by random() is the shuffle. Every draw is independent, so the same
  -- four people can land together twice running; that is what random means, and
  -- deliberately avoiding it would be a different feature.
  --
  -- Closed accounts are skipped. Their membership row survives so their results
  -- stay in the standings, but dealing them a seat would seat a tombstone — a
  -- table nobody can score, hosted by nobody if they were dealt first.
  --
  -- So are members who have said they are out for this meetup. Silence is not
  -- absence: somebody who has answered nothing is dealt in, which is what the
  -- summary's "no answer" count exists to qualify.
  select array_agg(lm.profile_id order by random())
    into v_roster
  from public.league_members lm
  join public.profiles p on p.id = lm.profile_id
  where lm.league_id = v_league
    and p.deleted_at is null
    and not exists (
      select 1 from public.session_attendance sa
      where sa.session_id = p_session_id
        and sa.profile_id = lm.profile_id
        and sa.status = 'out'
    );

  v_count := coalesce(array_length(v_roster, 1), 0);

  -- Counted on members alone, before the subs are added, so the two "there is
  -- nobody to seat" errors keep meaning what they meant. A meetup where every
  -- member is out is not rescued by the fact that a stranger had taken a chair:
  -- the evening is off, and drawing one table seating only that stranger would
  -- be a worse answer than saying so.
  if v_count = 0 then
    -- Told apart, because they need different things doing about them: an empty
    -- league needs members, a league where everybody is out needs another date.
    select count(*) into v_members
    from public.league_members lm
    join public.profiles p on p.id = lm.profile_id
    where lm.league_id = v_league and p.deleted_at is null;

    if v_members = 0 then
      raise exception 'This league has no members yet.';
    end if;

    raise exception 'Everybody has said they cannot make this meetup.';
  end if;

  -- Subs go on the end, and that position is doing one job: the deal below takes
  -- its hosts from v_roster[1..v_tables], so members first means members host.
  -- A sub hosting is not broken — they have a profile and the host policy is on
  -- host_id, not membership — it is just the wrong person to hand scorekeeping
  -- to when a member is available. If subs outnumber the seats members can fill
  -- the front of the array runs out and one will host, which is the right answer
  -- to that (very odd) league anyway.
  --
  -- Both halves are independently shuffled, so which table a sub lands at is
  -- still uniformly random. And they are counted into v_tables, so a sub gets a
  -- real chair rather than being squeezed into a table that is already full.
  v_roster := v_roster || coalesce(v_subs, '{}'::uuid[]);
  v_count := array_length(v_roster, 1);

  v_tables := ceil(v_count::numeric / v_seats);

  for i in 1..v_tables loop
    -- Dealt round-robin rather than in blocks, so sizes stay even: six members
    -- become two tables of three, not a four and a two.
    select array_agg(v_roster[j])
      into v_seatmates
    from generate_series(i, v_count, v_tables) as g(j);

    -- The first player dealt to a table hosts it. Someone has to, the host holds
    -- a seat anyway, and it spreads scorekeeping around instead of parking every
    -- table on the organizer.
    insert into public.matches (
      host_id, date_time, location, location_detail, latitude, longitude,
      league_id, session_id, table_number, status
    )
    values (
      v_seatmates[1], v_when, v_location, v_detail, v_latitude, v_longitude,
      v_league, p_session_id, i, 'open'
    )
    returning id into v_match;

    -- The host's own seat is taken by seat_host_on_match_insert.
    if array_length(v_seatmates, 1) > 1 then
      insert into public.match_players (match_id, player_id)
      select v_match, unnest(v_seatmates[2:]);
    end if;
  end loop;

  -- Reopening, if it was open. Re-run rather than restored, because the flag was
  -- never really per table: this is the same short-table rule
  -- `open_session_to_subs` applies, evaluated against the tables that now exist.
  -- Running it after the loop matters — `sync_match_status` has by then settled
  -- every table to open or full, and the seat counts are final.
  --
  -- Note that a redraw which seats the subs can legitimately close the meetup
  -- to further ones: four members and a sub used to be a table of four plus an
  -- orphan, and is now a table of three and a table of two, both still short. It
  -- is the count that decides, not the previous answer.
  if v_was_open then
    update public.matches m
    set needs_sub = true
    where m.session_id = p_session_id
      and m.status in ('open', 'full')
      and (select count(*) from public.match_players mp where mp.match_id = m.id) < v_seats;
  end if;

  return v_tables;
end;
$$;

revoke all on function public.draw_league_session(uuid) from public, anon;
grant execute on function public.draw_league_session(uuid) to authenticated;

comment on function public.draw_league_session(uuid) is
  'Shuffles a meetup into tables. Seats league members who have not said they are out, keeps any non-member subs already seated, and re-applies the meetup''s open-to-subs flag to whichever tables come out short.';
