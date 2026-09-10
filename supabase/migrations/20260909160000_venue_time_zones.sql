-- What time the game is, at the place the game is.
--
-- A meetup stores a `timestamptz` and nothing else, which is a complete record of
-- the instant and says nothing at all about the clock anybody will read it on. The
-- app got away with that because every screen renders in the reader's own device
-- zone — right, and free. An email has no reader's device. It is composed by a
-- Deno function, and Deno runs in UTC, so a 7pm game in Glen Ellyn went out to all
-- four players as "12:00 AM UTC".
--
-- The fix was very nearly a single service-wide setting, and that would have been
-- a guess dressed as a fact: correct while every league is in one metro, silently
-- wrong the day one is not, and wrong while still confidently printing a zone
-- abbreviation. The venue already knows the answer — the Places lookup that gives
-- a meetup its coordinates returns the zone in the same call, on the same request,
-- for no extra round trip.
--
-- Null is expected and fine. A venue typed by hand rather than picked from the
-- suggestions has no coordinates and no zone, and so does every row that predates
-- this. The sender falls back to `APP_TIMEZONE` for those, which is exactly the
-- service-wide guess — kept as a fallback, where a guess belongs, rather than as
-- the answer.
alter table public.matches
  add column if not exists time_zone text;

alter table public.league_sessions
  add column if not exists time_zone text;

comment on column public.matches.time_zone is
  'IANA zone of the venue, e.g. America/Chicago, from the Places lookup. Null when the venue was typed by hand. Used to render times in email, where there is no reader''s device to ask.';

comment on column public.league_sessions.time_zone is
  'IANA zone of the venue. See matches.time_zone.';

-- The draw copies it onto every table, alongside the rest of the meetup's details.
--
-- It has to: a drawn table is what the players actually see, and what the drop-out
-- and "game is on" notices are composed from. A meetup that knows its zone and
-- four tables that do not would put the right time on the league screen and the
-- wrong one in everybody's inbox.
--
-- Everything else is 20260901120000 byte for byte — the shuffle, the round-robin
-- deal, the attendance filter, the closed-account filter, the played-table guard
-- and the sub handling. Restated because a function body cannot be edited in place,
-- and copied mechanically rather than retyped: a hand-written first pass at this
-- migration silently dropped the rule that members are shuffled ahead of subs so
-- that members host. The redraw tests caught it; nothing on any screen would
-- have.
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
  v_time_zone text;
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
  select se.league_id, ls.date_time, ls.location, ls.location_detail,
         ls.latitude, ls.longitude, ls.time_zone
    into v_league, v_when, v_location, v_detail,
         v_latitude, v_longitude, v_time_zone
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
      host_id, date_time, location, location_detail, latitude, longitude, time_zone,
      league_id, session_id, table_number, status
    )
    values (
      v_seatmates[1], v_when, v_location, v_detail, v_latitude, v_longitude, v_time_zone,
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

-- Moving a meetup carries the zone with it, because moving a meetup is usually
-- moving the venue — which is the one edit that can change the answer.
--
-- Dropped and recreated rather than overloaded. Postgres would happily keep both
-- arities, and a stale six-argument copy sitting beside the seven-argument one is
-- a trap: PostgREST resolves by the argument names it is given, so an old client
-- would go on silently writing a null zone over a good one.
drop function if exists public.update_league_session(
  uuid, timestamptz, text, text, double precision, double precision
);

create or replace function public.update_league_session(
  p_session_id uuid,
  p_date_time timestamptz,
  p_location text,
  p_location_detail text,
  p_latitude double precision,
  p_longitude double precision,
  p_time_zone text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league uuid;
  v_tables integer;
begin
  select s.league_id
    into v_league
  from public.league_sessions ls
  join public.seasons s on s.id = ls.season_id
  where ls.id = p_session_id;

  if v_league is null then
    raise exception 'That meetup no longer exists.';
  end if;

  -- The whole reason this function bypasses RLS, so it is the first thing it does.
  if not public.is_league_organizer(v_league) then
    raise exception 'Only an organizer can change a meetup.';
  end if;

  update public.league_sessions
  set date_time = p_date_time,
      location = p_location,
      location_detail = p_location_detail,
      latitude = p_latitude,
      longitude = p_longitude,
      time_zone = p_time_zone
  where id = p_session_id;

  -- Only tables still to be played. A completed table is a record of an evening
  -- that happened somewhere, and a canceled one is not going to happen at all;
  -- rewriting either would be falsifying it rather than rescheduling it.
  update public.matches
  set date_time = p_date_time,
      location = p_location,
      location_detail = p_location_detail,
      latitude = p_latitude,
      longitude = p_longitude,
      time_zone = p_time_zone
  where session_id = p_session_id
    and status in ('open', 'full');

  get diagnostics v_tables = row_count;
  return v_tables;
end;
$$;

revoke all on function public.update_league_session(
  uuid, timestamptz, text, text, double precision, double precision, text
) from public, anon;

grant execute on function public.update_league_session(
  uuid, timestamptz, text, text, double precision, double precision, text
) to authenticated;

-- The sender reads the venue's zone beside the venue's name.
--
-- `coalesce` in the same order as every other detail on this view: a league notice
-- takes the meetup's, a pick-up notice takes the match's. Appended at the end for
-- the usual reason — `create or replace view` will not reorder what is already
-- there. Everything above it is 20260909130000 verbatim.
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
    settings.unsubscribe_token,
    coalesce(ls.time_zone, m.time_zone) as time_zone
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
