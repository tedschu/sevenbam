-- Closing an account must not quietly hand a running league to a stranger.
--
-- `delete_account` already arranged succession: the oldest remaining member was
-- promoted, and if nobody was left the league was archived. That is the right
-- answer for a league nobody is playing any more — it keeps the standings and
-- costs nobody anything.
--
-- It is the wrong answer for a league with meetups on the calendar. The person
-- promoted found out by opening the app and discovering they now run a season,
-- with venues to book and draws to make that somebody else had been handling
-- until Tuesday. "Oldest joiner" is a tiebreak, not a decision about who should
-- run a club, and the member closing their account is the one person who knows
-- who the right successor is.
--
-- So an active league is now refused rather than reassigned, naming the leagues
-- so the member knows exactly what to fix. They already have the tool: the roster
-- has a "Make organizer" button beside every name. Dormant leagues keep the old
-- automatic behaviour, which is below this and unchanged.
create or replace function public.assert_leagues_have_a_successor()
returns void
language plpgsql
-- Reads league_members and league_sessions across leagues, which RLS would
-- otherwise narrow to the caller's own. Same reasoning as is_league_organizer.
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_blocked text;
begin
  if v_caller is null then
    raise exception 'You must be signed in to close your account.';
  end if;

  select string_agg(l.name, ', ' order by l.name)
    into v_blocked
  from public.leagues l
  join public.league_members mine
    on mine.league_id = l.id
   and mine.profile_id = v_caller
   and mine.role = 'organizer'
  where l.archived_at is null
    -- Nobody else live is running it.
    and not exists (
      select 1
      from public.league_members lm
      join public.profiles p on p.id = lm.profile_id
      where lm.league_id = l.id
        and lm.role = 'organizer'
        and lm.profile_id <> v_caller
        and p.deleted_at is null
    )
    -- And it is still going: a meetup ahead of it, or a match of its own that has
    -- not been played. Both, because a league can carry a one-off match that
    -- belongs to no season, and either one means somebody is expected somewhere.
    and (
      exists (
        select 1
        from public.league_sessions ls
        join public.seasons s on s.id = ls.season_id
        where s.league_id = l.id
          and ls.date_time >= timezone('utc'::text, now())
      )
      or exists (
        select 1
        from public.matches m
        where m.league_id = l.id
          and m.status in ('open', 'full')
          and m.date_time >= timezone('utc'::text, now())
      )
    );

  if v_blocked is not null then
    -- Names the leagues and the way out. The profile screen shows this verbatim,
    -- so it has to read as instructions rather than as a database error.
    raise exception 'You are the only organizer of %, which still has meetups coming up. Make someone else an organizer there first, then close your account.', v_blocked;
  end if;
end;
$$;

-- Tenth time — Postgres grants EXECUTE to PUBLIC and `anon` inherits it. See the
-- note in 20260816010000.
revoke all on function public.assert_leagues_have_a_successor() from public, anon;
grant execute on function public.assert_leagues_have_a_successor() to authenticated;

comment on function public.assert_leagues_have_a_successor() is
  'Raises when the caller is the only organizer of a league that still has meetups ahead of it. Called by delete_my_account before it touches anything.';

-- --------------------------------------------------------------------------
-- The same function as 20260816010000, with the check above added at the top and
-- nothing else changed. Reproduced in full because that is the only way Postgres
-- lets one line be added to a function body.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$

declare
  v_caller uuid := (select auth.uid());
  v_match record;
  v_league record;
  v_successor uuid;
begin
  if v_caller is null then
    raise exception 'You must be signed in to close your account.';
  end if;

  -- Leagues that would be left with nobody to run them. Asked first, before a
  -- single row is touched: the whole function is one transaction so a later
  -- failure would roll back anyway, but the member is owed the answer before
  -- anything happens rather than after it silently un-happens.
  perform public.assert_leagues_have_a_successor();

  -- ----------------------------------------------------------------------
  -- Matches they are hosting that have not happened yet.
  --
  -- A tombstone cannot host: nothing it owns can be edited, moved or scored,
  -- because there is no longer anyone who satisfies `auth.uid() = host_id`. So a
  -- future match must be handed over or called off before the account goes.
  --
  -- Handed to the longest-seated other player, rather than canceled. They already
  -- said they were coming, so the game survives someone leaving — and cancelling
  -- would delete three other people's Saturday to tidy up one person's exit. It
  -- is the same rule the league draw already uses when it needs a host: the first
  -- player at the table takes it.
  for v_match in
    select m.id
    from public.matches m
    where m.host_id = v_caller
      and m.status in ('open', 'full')
      and m.date_time > timezone('utc'::text, now())
  loop
    select mp.player_id into v_successor
    from public.match_players mp
    join public.profiles p on p.id = mp.player_id
    where mp.match_id = v_match.id
      and mp.player_id <> v_caller
      and p.deleted_at is null
    order by mp.joined_at
    limit 1;

    if v_successor is not null then
      update public.matches set host_id = v_successor where id = v_match.id;
    else
      -- Nobody else was coming, so there is no game to save. `match_players`
      -- goes with it by cascade.
      delete from public.matches where id = v_match.id;
    end if;
  end loop;

  -- Seats at future matches, including ones just handed on. They are not coming,
  -- and leaving the seat filled would hold a place at a table someone else could
  -- take. Seats at matches already played are left exactly where they are — those
  -- are the record.
  delete from public.match_players mp
  using public.matches m
  where mp.match_id = m.id
    and mp.player_id = v_caller
    and m.status in ('open', 'full')
    and m.date_time > timezone('utc'::text, now());

  -- ----------------------------------------------------------------------
  -- Leagues they organize.
  --
  -- A league whose only organizer has left is a league nobody can run: no draw,
  -- no edits, no new seasons, and no way to promote anyone, because promoting
  -- requires being an organizer. Succession has to happen here.
  for v_league in
    select lm.league_id
    from public.league_members lm
    where lm.profile_id = v_caller
      and lm.role = 'organizer'
  loop
    -- Someone else already runs it too, so there is nothing to arrange.
    if exists (
      select 1
      from public.league_members lm
      join public.profiles p on p.id = lm.profile_id
      where lm.league_id = v_league.league_id
        and lm.role = 'organizer'
        and lm.profile_id <> v_caller
        and p.deleted_at is null
    ) then
      continue;
    end if;

    select lm.profile_id into v_successor
    from public.league_members lm
    join public.profiles p on p.id = lm.profile_id
    where lm.league_id = v_league.league_id
      and lm.profile_id <> v_caller
      and p.deleted_at is null
    order by lm.joined_at
    limit 1;

    if v_successor is not null then
      update public.league_members
      set role = 'organizer'
      where league_id = v_league.league_id and profile_id = v_successor;
    else
      -- Nobody is left in it. Archived rather than deleted: archiving keeps the
      -- seasons, tables and scores that `delete_league` would destroy, and the
      -- whole point of this function is that closing an account does not erase
      -- games. It also stops the league being listed or joinable, which is the
      -- part that actually matters once it is empty.
      update public.leagues
      set archived_at = timezone('utc'::text, now())
      where id = v_league.league_id and archived_at is null;
    end if;
  end loop;

  -- Their league memberships are deliberately NOT removed. Standings are built
  -- from `league_members` joined to scores, so deleting the row would erase the
  -- member's results from a league other people are still playing in. The draw
  -- and the seat counts skip deleted members instead — see the functions below.

  -- ----------------------------------------------------------------------
  -- The personal details.
  --
  -- Everything identifying, cleared in one statement. `deleted_at` is set in the
  -- same update so there is no window in which a scrubbed profile looks like a
  -- live member with a blank name.
  update public.profiles
  set
    name = public.anonymous_player_name(v_caller),
    town = null,
    experience_level = null,
    avatar_url = null,
    home_latitude = null,
    home_longitude = null,
    deleted_at = timezone('utc'::text, now())
  where id = v_caller;

  -- The phone number. Deleted outright rather than nulled, so nothing is left
  -- keyed to this member in a table whose only purpose is contact details.
  delete from public.profile_contacts where profile_id = v_caller;

  -- ----------------------------------------------------------------------
  -- The auth user, which is where the email address lives.
  --
  -- Most of GoTrue's tables reference `auth.users` ON DELETE CASCADE, so sessions,
  -- identities, MFA factors, one-time tokens and webauthn credentials go with this
  -- row. Two do not, and were found by checking rather than by assuming:
  -- `auth.refresh_tokens.user_id` and `auth.flow_state.user_id` carry the user
  -- with no foreign key at all. Left alone they would be the only surviving trace
  -- of the account — and `refresh_tokens` in particular is a live credential.
  delete from auth.refresh_tokens where user_id = v_caller::text;
  delete from auth.flow_state where user_id = v_caller;
  delete from auth.users where id = v_caller;
end;

$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Close the caller''s own account: refuses while they solely organize a league that is still running, then hands on or cancels their future matches, arranges succession for dormant leagues, scrubs their profile to an anonymous tombstone and deletes their auth user. Scores and past matches are kept, attributed to the tombstone.';
