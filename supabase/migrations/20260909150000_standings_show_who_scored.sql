-- "Updated 8/8 by April Lane."
--
-- A total on the standings is the end of a chain nobody can see: four people at a
-- table, one of them typing, an organizer correcting it a week later. When the
-- number is not what somebody remembers, the screen offers them nothing to do
-- about it — not a date, not a name, no way to tell a stale score from a wrong one
-- or from their own bad memory. So they either accept a number they think is wrong
-- or ask everybody in the league.
--
-- The latest scoring event, not a history. What this answers is "who do I ask",
-- and that has exactly one answer.
--
-- Both boards, because the same member reads both and a provenance line that
-- appears on one of them looks like a bug on the other.

-- Every match: the all-matches board.
--
-- The two new columns are appended, as `avatar_url` was in 20260817190000 and for
-- the same reason — `create or replace view` will not reorder or retype what is
-- already there, and dropping the view to tidy the ordering would take its grants
-- with it.
create or replace view public.leaderboard
with (security_invoker = true) as
with scored as (
  select
    mp.match_id,
    mp.player_id,
    mp.score,
    mp.score_updated_at,
    mp.score_updated_by
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where m.status = 'completed'
    and mp.score is not null
),
placed as (
  select
    scored.*,
    -- rank(), not row_number(): a tied top score is a win for everyone tied.
    rank() over (partition by scored.match_id order by scored.score desc) as placement
  from scored
)
select
  p.id as player_id,
  p.name,
  count(placed.match_id)::int as games_played,
  coalesce(sum(placed.score), 0)::int as total_points,
  round(avg(placed.score), 1) as average_points,
  count(*) filter (where placed.placement = 1)::int as wins,
  round(avg(placed.placement), 2) as average_placement,
  (p.deleted_at is not null) as deleted,
  -- Closed accounts have this nulled by delete_my_account(), so a deleted member
  -- keeps their results and shows the initials of their generated label.
  p.avatar_url,
  max(placed.score_updated_at) as score_updated_at,
  -- The name attached to that most recent stamp.
  --
  -- `array_agg(... order by ...)` rather than a correlated subquery: the ordering
  -- has to happen inside the same grouping that produced `max()` above, or the two
  -- columns can disagree — a date from one match and a name from another, which is
  -- worse than showing neither. `nulls last` keeps scores entered before any of
  -- this was recorded from winning the sort and blanking a real name.
  (array_agg(updater.name order by placed.score_updated_at desc nulls last))[1]
    as score_updated_by_name
from public.profiles p
left join placed on placed.player_id = p.id
left join public.profiles updater on updater.id = placed.score_updated_by
group by p.id, p.name, p.deleted_at, p.avatar_url
having p.deleted_at is null or count(placed.match_id) > 0;

grant select on public.leaderboard to anon, authenticated;

-- One league: the board with the stakes, and the one an organizer is answering
-- questions about.
create or replace view public.league_standings
with (security_invoker = true) as
with scored as (
  select
    m.league_id,
    mp.match_id,
    mp.player_id,
    mp.score,
    mp.score_updated_at,
    mp.score_updated_by
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where m.status = 'completed'
    and mp.score is not null
    and m.league_id is not null
),
placed as (
  select
    scored.*,
    rank() over (partition by scored.match_id order by scored.score desc) as placement
  from scored
)
select
  lm.league_id,
  p.id as player_id,
  p.name,
  p.avatar_url,
  count(placed.match_id)::int as games_played,
  coalesce(sum(placed.score), 0)::int as total_points,
  round(avg(placed.score), 1) as average_points,
  count(*) filter (where placed.placement = 1)::int as wins,
  round(avg(placed.placement), 2) as average_placement,
  (p.deleted_at is not null) as deleted,
  max(placed.score_updated_at) as score_updated_at,
  (array_agg(updater.name order by placed.score_updated_at desc nulls last))[1]
    as score_updated_by_name
from public.league_members lm
join public.profiles p on p.id = lm.profile_id
left join placed
  on placed.player_id = lm.profile_id
 and placed.league_id = lm.league_id
left join public.profiles updater on updater.id = placed.score_updated_by
group by lm.league_id, p.id, p.name, p.avatar_url, p.deleted_at
having p.deleted_at is null or count(placed.match_id) > 0;

grant select on public.league_standings to authenticated;
