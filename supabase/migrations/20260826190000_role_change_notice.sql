-- Telling somebody they now run the league.
--
-- Being made an organizer is the one change to a membership that the member did
-- not ask for and cannot see the effect of until they go looking: the controls
-- simply appear on a screen they may not open for a week. Handing it over
-- silently means the person who did it has to remember to mention it, which is
-- exactly the kind of thing that does not get mentioned.
--
-- Announced in the app rather than emailed. Every "email" this app sends is a
-- mailto: hand-off from the sender's own client — there is no transactional mail
-- and no push — so the alternative to a banner is not a message that arrives, it
-- is the organizer being asked to write one. The banner is seen the next time
-- they open the app, which is also the first moment the new controls could
-- possibly matter to them.
--
-- Two columns rather than a notifications table: there is one kind of notice, it
-- belongs to the membership row it describes, and it is answered by the person
-- who holds that row. A table would be the right shape for the second kind.
alter table public.league_members
  -- When the role last changed under them. Null for every existing row on
  -- purpose: nobody should open the app to a banner about something that
  -- happened months ago and that they have long since noticed.
  add column if not exists role_changed_at timestamptz,
  -- When they said they had seen it. Compared against the above rather than
  -- cleared, so a second change re-announces itself without needing a flag reset.
  add column if not exists role_ack_at timestamptz;

comment on column public.league_members.role_changed_at is
  'When this member''s role last changed, stamped by trigger. Null means it has never changed since they joined.';
comment on column public.league_members.role_ack_at is
  'When they dismissed the notice. Older than role_changed_at means there is something to tell them.';

-- Stamped here rather than by whoever performs the update, so the notice cannot
-- be forgotten by a new caller — `delete_account`'s succession promotes people
-- too, and that is precisely a case where nobody is around to tell them.
create or replace function public.stamp_league_role_change()
returns trigger
language plpgsql
as $$
begin
  new.role_changed_at := timezone('utc'::text, now());
  -- Deliberately not clearing role_ack_at: the comparison is what decides, and
  -- leaving the old acknowledgement in place keeps the history honest.
  return new;
end;
$$;

-- BEFORE, so the stamp is part of the same write rather than a second one, and
-- ordered after `league_keeps_an_organizer` by name so a refused demotion is
-- never stamped. Triggers on the same event fire alphabetically: "league_" sorts
-- before "stamp_".
create trigger stamp_league_role_change
  before update of role on public.league_members
  for each row
  when (old.role is distinct from new.role)
  execute function public.stamp_league_role_change();

comment on function public.stamp_league_role_change() is
  'Marks a membership as having something to tell its member, for the banner on the league screen.';

-- --------------------------------------------------------------------------
-- Dismissing the notice.
--
-- A function rather than a policy, and the reason is worth stating because the
-- obvious version is a security hole. RLS policies are permissive and OR
-- together: adding "members may update their own row" beside "organizers may
-- change roles" would not scope the first one to this column — Postgres has no
-- per-column RLS — so any member could then update their own row's `role` and
-- make themselves an organizer. Column-level grants cannot fix it either, since
-- the table-level UPDATE already granted every column.
--
-- So the acknowledgement goes through a definer function that writes exactly one
-- column of exactly one row, and the update policy stays organizer-only.
create or replace function public.acknowledge_league_role_change(p_league uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'You must be signed in.';
  end if;

  -- Their own row and no other: the caller is taken from the token rather than
  -- from an argument, so there is no id to aim at anybody else.
  update public.league_members
  set role_ack_at = timezone('utc'::text, now())
  where league_id = p_league and profile_id = v_caller;
end;
$$;

-- Ninth time. Postgres grants EXECUTE to PUBLIC on a new function and `anon`
-- inherits it — see the note in 20260816010000.
revoke all on function public.acknowledge_league_role_change(uuid) from public, anon;
grant execute on function public.acknowledge_league_role_change(uuid) to authenticated;

comment on function public.acknowledge_league_role_change(uuid) is
  'Marks the caller''s own role-change notice as seen. Writes role_ack_at and nothing else.';
