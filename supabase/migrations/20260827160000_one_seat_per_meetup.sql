-- One person, one chair, per meetup.
--
-- `match_players` is keyed on (match_id, player_id), which stops somebody being
-- seated twice at the same table and says nothing at all about being seated at
-- two tables of the same meetup. That gap was reachable in ordinary use: the
-- insert policy lets any league member take any seat in their own league —
--
--   m.league_id is null or is_league_member(m.league_id) or m.needs_sub
--
-- — and nothing in it asks whether they already have one. So an organizer who
-- opens a short table to subs, which is exactly what a short table invites, can
-- have it filled by somebody the draw already dealt into the table next to it.
-- The meetup then shows one player at two tables and one member at none, and the
-- seat count still adds up, so nothing looks wrong until somebody reads the names.
--
-- A trigger rather than a wider unique index, because the rule spans rows the
-- index cannot see: the clash is between two `match_players` rows whose only
-- relation is the `session_id` of the matches they point at. A unique constraint
-- on (session, player) would need that column denormalised onto every seat.
--
-- INSERT only, deliberately. The obvious extension to UPDATE is wrong: during a
-- BEFORE UPDATE the row's old version is still in the table, so moving a seat
-- from one table to another would find that old row and refuse a legitimate move.
-- Nothing in the app moves a seat by update — a seat is taken and given up — and
-- a rule that fires on the wrong thing is worse than one that fires on less.
create or replace function public.one_seat_per_meetup()
returns trigger
language plpgsql
-- Reads seats across the whole meetup, which RLS would otherwise narrow to the
-- caller's own. Same reasoning as is_league_member.
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  select m.session_id into v_session
  from public.matches m where m.id = new.match_id;

  -- A one-off match belongs to no meetup, so there is nothing for it to clash
  -- with. Browse is full of these and none of them should pay for this check.
  if v_session is null then
    return new;
  end if;

  if exists (
    select 1
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where m.session_id = v_session
      and mp.player_id = new.player_id
      and mp.match_id <> new.match_id
  ) then
    -- Written for the person who pressed Join on a table at a meetup they are
    -- already dealt into, which is the only way to arrive here.
    raise exception 'You already have a seat at this meetup. Leave that table first if you want to move.';
  end if;

  return new;
end;
$$;

-- Named to sort after `enforce_match_capacity_before_insert`, so a full table is
-- refused as full before it is refused as a double booking. Both refuse, but
-- "this table is full" is the more useful sentence when both are true.
create trigger enforce_one_seat_per_meetup
  before insert on public.match_players
  for each row
  execute function public.one_seat_per_meetup();

comment on function public.one_seat_per_meetup() is
  'Refuses a seat to somebody who already holds one at the same meetup. One-off matches, which belong to no meetup, pass through untouched.';
