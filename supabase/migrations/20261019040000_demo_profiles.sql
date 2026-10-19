-- Players who exist for App Review and nobody else.
--
-- Apple's reviewer signs in to the live service with a demo account, and to see
-- the organizer tools it needs a league with a roster, meetups with tables drawn
-- and scores on the board. None of that can be borrowed from real members without
-- putting a stranger in their league. So the demo league is filled with made up
-- players, and this keeps them out of the way of everyone real.
--
-- Two places would show them. The overall ranking lists every profile there is,
-- so a made up player with good scores would sit above real members. And Browse
-- keeps any game it cannot measure a distance to, so a member with no home town
-- set would see the demo's pick-up games, however far away they are.
--
-- A league's own standings are left alone: the demo league is private, so only
-- its own members ever read them.
alter table public.profiles
  add column if not exists is_demo boolean not null default false;

comment on column public.profiles.is_demo is
  'A demo account or one of its made up players. Hidden from the overall ranking, and their games are only visible to other demo profiles.';

create or replace function public.is_demo_profile(p_profile uuid)
returns boolean
language sql
-- Reads the flag on somebody else's row, which the policy below needs.
security definer
set search_path = ''
stable
as $$
  select coalesce((select is_demo from public.profiles where id = p_profile), false);
$$;

-- Same definition as before, less the demo profiles.
create or replace view public.leaderboard
with (security_invoker = true)
as
with scored as (
  select mp.match_id,
    mp.player_id,
    mp.score,
    mp.score_updated_at,
    mp.score_updated_by
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where m.status = 'completed' and mp.score is not null
), placed as (
  select scored.match_id,
    scored.player_id,
    scored.score,
    scored.score_updated_at,
    scored.score_updated_by,
    rank() over (partition by scored.match_id order by scored.score desc) as placement
  from scored
)
select p.id as player_id,
  p.name,
  count(placed.match_id)::integer as games_played,
  coalesce(sum(placed.score), 0::bigint)::integer as total_points,
  round(avg(placed.score), 1) as average_points,
  count(*) filter (where placed.placement = 1)::integer as wins,
  round(avg(placed.placement), 2) as average_placement,
  p.deleted_at is not null as deleted,
  p.avatar_url,
  max(placed.score_updated_at) as score_updated_at,
  (array_agg(updater.name order by placed.score_updated_at desc nulls last))[1] as score_updated_by_name
from public.profiles p
left join placed on placed.player_id = p.id
left join public.profiles updater on updater.id = placed.score_updated_by
where not p.is_demo
group by p.id, p.name, p.deleted_at, p.avatar_url
having p.deleted_at is null or count(placed.match_id) > 0;

-- A demo game is visible to demo profiles only. Everything else stays visible to
-- everyone, as it was.
drop policy if exists "Matches are viewable by everyone." on public.matches;

create policy "Matches are viewable by everyone, demo games by demo profiles."
  on public.matches for select
  using (not public.is_demo_profile(host_id) or public.is_demo_profile(auth.uid()));
