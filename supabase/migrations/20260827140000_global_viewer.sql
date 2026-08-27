-- Seeing the whole app, for the account that maintains it.
--
-- Answering "is Anna actually at a table?" meant opening a SQL client, because
-- the app can only ever show you a league you belong to. That is the right rule
-- for members and the wrong one for whoever has to support them: the question is
-- about what the app displays, so it should be answerable by looking at the app.
--
-- Read-only, and deliberately so. An admin who can also write is an admin who can
-- redraw somebody's season by misclicking, and the failure would be indisplayable
-- from the outside — an organizer would just find their tables different. Every
-- policy below is `for select`. Nothing here grants insert, update or delete, and
-- `is_league_organizer` is untouched, so "only an organizer can draw the tables"
-- stays literally true.
--
-- This grants no access that the account did not already have; the same person
-- holds the project's database credentials. What it changes is the shape of the
-- access: through the app's own screens, with the app's own rendering, which is
-- the thing being validated.

-- A table rather than a column on `profiles`. `profiles` carries "Public profiles
-- are viewable by everyone", so a flag there would publish the list of admins to
-- every visitor — a small leak, but a free one to avoid.
create table if not exists public.app_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.app_admins enable row level security;

-- Deliberately no policies. RLS with no policy denies everything, so the table is
-- unreachable through PostgREST for every caller including admins themselves —
-- membership is readable only through the definer function below, which answers
-- about the caller and nobody else. Adding a row is a deployment act, done here
-- or in the SQL editor, not something the app can do to itself.
comment on table public.app_admins is
  'Accounts that may read the whole app read-only. No RLS policies on purpose: reachable only via is_admin().';

-- `stable` rather than `volatile` so the planner calls it once per statement
-- instead of once per row — this sits in a policy that a roster query evaluates
-- against every membership row.
create or replace function public.is_admin()
returns boolean
language sql
stable
-- Reads app_admins, which no policy exposes. Same reasoning as is_league_member.
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins a where a.profile_id = (select auth.uid())
  );
$$;

-- Eleventh time. Postgres grants EXECUTE to PUBLIC on a new function and `anon`
-- inherits it — see the note in 20260816010000. The app calls this one directly
-- to decide whether to draw the toggle, so `authenticated` needs it.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'Whether the caller may read the whole app. Answers only about the caller — there is no id to aim at anybody else.';

-- --------------------------------------------------------------------------
-- The read-everything policies.
--
-- Only five tables need one. `matches`, `match_players` and `profiles` already
-- carry "viewable by everyone" policies, so a league's tables and the people at
-- them were never the part that was hidden — the league structure around them
-- was. That is why the SQL client was necessary to tie a name to a table.
--
-- Policies are permissive and OR together, so each of these widens SELECT for
-- admins and changes nothing for anybody else.
create policy "Admins can see every league."
  on public.leagues for select using (public.is_admin());

create policy "Admins can see every roster."
  on public.league_members for select using (public.is_admin());

create policy "Admins can see every season."
  on public.seasons for select using (public.is_admin());

create policy "Admins can see every meetup."
  on public.league_sessions for select using (public.is_admin());

create policy "Admins can see every answer."
  on public.session_attendance for select using (public.is_admin());

-- `profile_contacts` is deliberately absent. It exists only to hold phone
-- numbers, its whole policy is "Members manage their own contact details", and
-- no question about who is sitting at which table needs one. Support does not
-- require a directory of everybody's phone number.

-- --------------------------------------------------------------------------
-- The one admin.
--
-- Matched on the address rather than hardcoding an id, so this migration says who
-- it means and applies to whichever environment it is run in. Silently a no-op
-- where that account does not exist, which is correct for a fresh local stack.
insert into public.app_admins (profile_id)
select u.id from auth.users u where u.email = 'ted.schuster@gmail.com'
on conflict (profile_id) do nothing;
