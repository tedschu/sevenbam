-- Scoring a whole meetup, and saying who scored it.
--
-- Two problems with one shape. Scores can only be entered by the host of a table,
-- and the host of a drawn table is whoever the shuffle dealt first — an ordinary
-- member who did not ask for the job and may not know they have it. So a league
-- night ends with four tables, four accidental scorekeepers, and an organizer who
-- can watch the standings stay empty and do nothing about it. Meanwhile the person
-- who *runs* the league, who is the one being asked why the board is wrong, has no
-- route to the card at all.
--
-- And when a score does change, nothing records who changed it or when. A member
-- who thinks their total is wrong has no way to ask anybody about it, because
-- there is no anybody: the number simply differs from what they remember.

-- Who last touched this seat's score, and when.
--
-- On `match_players` rather than a separate audit table. This is not an audit log
-- and should not pretend to be one — it answers "who do I ask about this number",
-- which needs the latest writer and nothing else. A full history of every
-- correction is a different feature with a different table, and building half of
-- one here would mostly produce rows nobody reads.
alter table public.match_players
  add column if not exists score_updated_at timestamptz,
  add column if not exists score_updated_by uuid references public.profiles(id) on delete set null;

comment on column public.match_players.score_updated_at is
  'When this seat''s score last changed. Null for scores entered before this was recorded.';

-- Writing one table's card, with the authorisation already done.
--
-- Split out of `enter_match_scores` so the meetup-wide entry below can reuse the
-- rules about what a complete card is without restating them. Deliberately checks
-- nothing about *who* is calling: both callers do that first, and they answer it
-- differently — one asks about a match, the other about a league.
--
-- Which is exactly why this is revoked from every API role. It is a fragment of
-- two functions, not a third one, and reachable from PostgREST it would let
-- anybody score anybody's table.
create or replace function public.apply_match_scores(p_match_id uuid, p_scores jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_status text;
  v_seated integer;
  v_supplied integer;
  v_unmatched integer;
begin
  select m.status into v_status
    from public.matches m
    where m.id = p_match_id
    for update;

  if v_status is null then
    raise exception 'Match not found.';
  end if;

  if v_status = 'canceled' then
    raise exception 'This match was canceled.';
  end if;

  select count(*) into v_seated
    from public.match_players mp
    where mp.match_id = p_match_id;

  select count(*) into v_supplied from jsonb_array_elements(p_scores);

  -- Every seat must be accounted for, so a partial card cannot close a match and
  -- quietly leave someone on zero in the standings.
  if v_supplied <> v_seated then
    raise exception 'Expected % scores, got %.', v_seated, v_supplied;
  end if;

  select count(*) into v_unmatched
    from jsonb_array_elements(p_scores) as entry
    where not exists (
      select 1 from public.match_players mp
      where mp.match_id = p_match_id
        and mp.player_id = (entry ->> 'player_id')::uuid
    );

  if v_unmatched > 0 then
    raise exception 'Scores submitted for % players who are not seated.', v_unmatched;
  end if;

  -- `is distinct from` is what keeps the stamp honest. Re-saving a card to correct
  -- one number would otherwise re-date all four, and the line on the standings
  -- would claim somebody revised a score they only looked at.
  -- `clock_timestamp()` rather than `now()`, which is the transaction's start and
  -- so is identical for every write inside one. That is the wrong reading of "when
  -- was this last changed" whenever two cards are entered back to back, and it
  -- makes the difference unobservable in a test, where the whole run is one
  -- transaction.
  update public.match_players mp
    set score = (entry ->> 'score')::integer,
        score_updated_at = clock_timestamp(),
        score_updated_by = v_caller
    from jsonb_array_elements(p_scores) as entry
    where mp.match_id = p_match_id
      and mp.player_id = (entry ->> 'player_id')::uuid
      and mp.score is distinct from (entry ->> 'score')::integer;

  update public.matches
    set status = 'completed'
    where id = p_match_id;
end;
$$;

revoke all on function public.apply_match_scores(uuid, jsonb) from public, anon, authenticated;

-- One table's card. Now also enterable by whoever runs the league.
--
-- The host keeps the right, because for a pick-up game in Browse they are the only
-- person who has it — there is no league and no organizer to fall back on. What
-- changes is that a league table has a second answer: the organizer, who is the
-- person actually accountable for the standings being right.
--
-- Everything else is 20260806005009, moved into `apply_match_scores` above.
create or replace function public.enter_match_scores(p_match_id uuid, p_scores jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_host uuid;
  v_league uuid;
begin
  select m.host_id, m.league_id into v_host, v_league
    from public.matches m
    where m.id = p_match_id;

  if v_host is null then
    raise exception 'Match not found.';
  end if;

  if v_host is distinct from v_caller
     and not (v_league is not null and public.is_league_organizer(v_league)) then
    raise exception 'Only the host or a league organizer can enter scores.';
  end if;

  perform public.apply_match_scores(p_match_id, p_scores);
end;
$$;

revoke all on function public.enter_match_scores(uuid, jsonb) from public, anon;
grant execute on function public.enter_match_scores(uuid, jsonb) to authenticated;

-- A whole meetup's cards, in one action.
--
-- The shape the evening actually has. An organizer standing in the room at the end
-- of the night has four score sheets in their hand, not one, and the app made them
-- find four separate matches in four separate places — none of which they could
-- open anyway. One call, one transaction: either the meetup is scored or it is
-- not, and a network failure halfway through cannot leave two tables counted and
-- two ignored while the standings settle in between.
--
-- Tables are addressed by `match_id` inside the payload rather than scored all at
-- once, because a meetup is not always one event. Three tables play and the fourth
-- gives up and goes to the pub; a card gets queried a week later and one table is
-- re-entered. Anything not named here is left exactly as it was.
--
-- Returns how many tables were written, which is what the screen tells the
-- organizer afterwards.
create or replace function public.enter_session_scores(p_session_id uuid, p_scores jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_league uuid;
  v_organizer boolean;
  v_table record;
  v_written integer := 0;
begin
  select s.league_id into v_league
  from public.league_sessions ls
  join public.seasons s on s.id = ls.season_id
  where ls.id = p_session_id;

  if v_league is null then
    raise exception 'That meetup no longer exists.';
  end if;

  -- Asked once rather than per table: it is the same answer four times, and it
  -- reads the league membership through a security definer function.
  v_organizer := public.is_league_organizer(v_league);

  for v_table in
    select distinct (entry ->> 'match_id')::uuid as id
    from jsonb_array_elements(p_scores) as entry
  loop
    if v_table.id is null then
      raise exception 'Every score must say which table it belongs to.';
    end if;

    -- Checked before the permission, so somebody aiming a payload at another
    -- league's table is told the table is not here rather than being told
    -- whether they would have been allowed to score it.
    if not exists (
      select 1 from public.matches m
      where m.id = v_table.id and m.session_id = p_session_id
    ) then
      raise exception 'That table is not part of this meetup.';
    end if;

    -- The table's own host keeps the right they have always had. Without this an
    -- organizer would be the only person who could score from the league screen,
    -- and the member who was dealt the scorekeeper's job would find the button
    -- there and refused.
    if not v_organizer and not exists (
      select 1 from public.matches m
      where m.id = v_table.id and m.host_id = v_caller
    ) then
      raise exception 'Only an organizer or the table''s scorer can enter these scores.';
    end if;

    perform public.apply_match_scores(
      v_table.id,
      (
        select jsonb_agg(entry - 'match_id')
        from jsonb_array_elements(p_scores) as entry
        where (entry ->> 'match_id')::uuid = v_table.id
      )
    );

    v_written := v_written + 1;
  end loop;

  if v_written = 0 then
    raise exception 'No scores were submitted.';
  end if;

  return v_written;
end;
$$;

revoke all on function public.enter_session_scores(uuid, jsonb) from public, anon;
grant execute on function public.enter_session_scores(uuid, jsonb) to authenticated;

comment on function public.enter_session_scores(uuid, jsonb) is
  'Records the cards for one or more tables at a league meetup in a single transaction. Organizers may score any table; a table host may score their own.';
