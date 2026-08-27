-- Handing the league to someone else, without being able to orphan it.
--
-- The role itself needed no work: `league_members.role` has always been per
-- member rather than a property of `leagues.created_by`, `is_league_organizer`
-- is a set-membership test, and there is already a policy letting organizers
-- change roles. Promoting a second organizer was therefore one UPDATE away the
-- whole time, and everything that asks "may this person run the league?" —
-- editing a meetup, drawing tables, archiving, deleting — already asks it of the
-- role rather than of the founder.
--
-- What was missing is the guard on the other direction. `delete_account` already
-- names the failure exactly: "A league whose only organizer has left is a league
-- nobody can run: no draw, no edits, no new seasons, and no way to promote
-- anyone, because promoting requires being an organizer." That function arranges
-- succession because closing an account is not a decision about a league. A
-- deliberate step-down is, so this refuses it instead — the member is at the
-- roster looking at the people they could hand it to.
--
-- A trigger rather than a check inside a new RPC, because the rule is about the
-- table rather than about one route into it: the client updates the row directly
-- through the existing policy, and this holds for that path, for the SQL editor
-- and for anything added later without anybody having to remember it.
create or replace function public.league_keeps_an_organizer()
returns trigger
language plpgsql
-- Reads the roster to count the others, which RLS would otherwise filter to what
-- the caller can see. Same reasoning as `is_league_member` above it.
security definer
set search_path = ''
as $$
begin
  -- Only ever a demotion. Promotions, and updates that leave the role alone,
  -- fall straight through.
  if old.role <> 'organizer' or new.role = 'organizer' then
    return new;
  end if;

  -- Tombstoned members are not somebody to hand a league to: `delete_account`
  -- leaves their membership row in place so standings still resolve, so without
  -- this the last live organizer could step down in favour of a closed account.
  if not exists (
    select 1
    from public.league_members lm
    join public.profiles p on p.id = lm.profile_id
    where lm.league_id = old.league_id
      and lm.role = 'organizer'
      and lm.profile_id <> old.profile_id
      and p.deleted_at is null
  ) then
    raise exception 'A league needs an organizer. Make someone else an organizer first, then step down.';
  end if;

  return new;
end;
$$;

create trigger league_keeps_an_organizer
  before update of role on public.league_members
  for each row
  execute function public.league_keeps_an_organizer();

comment on function public.league_keeps_an_organizer() is
  'Refuses the demotion that would leave a league with no live organizer. Promotions pass through untouched.';
