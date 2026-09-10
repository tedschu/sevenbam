-- Telling a pick-up game's players that it is on, and that it is off again.
--
-- Browse is a noticeboard: somebody posts a table, strangers claim the chairs,
-- and nothing has ever said a word to any of them. The fourth seat filling up is
-- the moment the evening becomes real, and until now the only way to learn it had
-- happened was to open the app and count. So people did not learn it. They kept
-- the night loosely free, or they double-booked it, because three-out-of-four and
-- four-out-of-four looked identical from outside.
--
-- The reverse is worse. A player drops out of a full table two days before, the
-- match quietly slides back into Browse, and the three who are still coming carry
-- on believing they have a game. Nobody goes looking for a fourth, because nobody
-- knows there is a chair to fill — and the one person who could have mentioned it
-- to a friend is exactly the person not told.
--
-- Both notices go in the same outbox as the drop-out ones, for the same reason
-- 20260901140000 built it: taking a seat must commit whether or not Resend is
-- reachable. A mail that fails to send is a missed evening; a join that fails to
-- save is a corrupt table.
alter table public.notification_outbox
  drop constraint notification_outbox_kind_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('dropout', 'match_full', 'match_reopened'));

-- Whether a match is the kind of thing these notices are about.
--
-- League tables are excluded, and not because it would be hard: their seats are
-- dealt by the draw, so "four players have signed up" describes nothing that
-- happened. A drawn table of four was four the moment it was drawn, and everyone
-- at it already hears about the meetup through the league.
--
-- Upcoming and still live, because both notices are asking somebody to act — turn
-- up, or find a fourth — and neither is worth saying about a night that is over
-- or a match the host has called off. That matters most on account deletion,
-- which sheds every future seat at once and would otherwise mail about tables
-- nobody is going to.
create or replace function public.notifiable_pickup_match(p_match uuid)
returns boolean
language sql
-- Reads matches across the service rather than the caller's own. Same reasoning
-- as is_league_member.
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match
      and m.league_id is null
      and m.status in ('open', 'full')
      and m.date_time > timezone('utc'::text, now())
  );
$$;

-- Queue one notice per person currently sitting at the table.
--
-- Reads the seats as they are now, which is what makes the same helper serve both
-- events: after a join the four at the table are the four to congratulate, and
-- after a withdrawal the three left are the three to warn. The person who left is
-- already gone from `match_players` by the time the after-delete trigger runs, so
-- excluding them takes no clause.
--
-- Deleted accounts are skipped: their auth row is gone, so a notice addressed to
-- one can never be sent and would sit in the outbox forever.
create or replace function public.enqueue_match_notice(
  p_kind text,
  p_match uuid,
  p_subject uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_outbox (kind, recipient_id, subject_id, match_id)
  select p_kind, mp.player_id, p_subject, p_match
  from public.match_players mp
  join public.profiles p on p.id = mp.player_id
  where mp.match_id = p_match
    and p.deleted_at is null;
end;
$$;

-- The fourth chair being taken.
--
-- Counted rather than read off `matches.status`, which is set by
-- `sync_match_status_after_change` — a sibling after-insert trigger that sorts
-- later by name and so has not run yet. The count is the honest source anyway.
--
-- Safe against two people claiming the last seat at once: `enforce_match_capacity`
-- takes `for update` on the match row before either insert lands, so the joins on
-- a given match are serialised and only one of them can be the one that sees four.
--
-- Equality rather than `>=` is deliberate. A table that somehow held five would
-- have bigger problems than a missing mail, and `>=` would send a fresh round of
-- congratulations for every seat above the limit.
create or replace function public.notice_match_filled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.notifiable_pickup_match(new.match_id) then
    return null;
  end if;

  if (select count(*) from public.match_players where match_id = new.match_id)
     <> public.match_seat_limit() then
    return null;
  end if;

  perform public.enqueue_match_notice('match_full', new.match_id, new.player_id);
  return null;
end;
$$;

create trigger notice_match_filled_after_join
  after insert on public.match_players
  for each row execute function public.notice_match_filled();

-- The fourth chair being given up.
--
-- Only from four to three. A table going three to two has not reopened — it was
-- open the whole time, and telling people so is how a notice that matters becomes
-- one that gets filtered. The host still hears about that case through the
-- drop-out notice below.
create or replace function public.notice_match_reopened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.notifiable_pickup_match(old.match_id) then
    return null;
  end if;

  if (select count(*) from public.match_players where match_id = old.match_id)
     <> public.match_seat_limit() - 1 then
    return null;
  end if;

  perform public.enqueue_match_notice('match_reopened', old.match_id, old.player_id);
  return null;
end;
$$;

create trigger notice_match_reopened_after_leave
  after delete on public.match_players
  for each row execute function public.notice_match_reopened();

-- The drop-out notice stands down when the reopen notice covers the same event.
--
-- Both fire on a seat leaving a pick-up match, and for a table that was full they
-- would reach the host twice about one withdrawal — once to say somebody cannot
-- make it, once to say a chair is free. The second says everything the first does
-- and adds what to do about it, so the first steps aside.
--
-- The condition is written to match `notice_match_reopened` clause for clause,
-- because the failure mode of the two drifting apart is silence: a withdrawal
-- that one trigger declines to report and the other never notices.
--
-- Everything above the new check is unchanged from 20260901140000, restated here
-- because a function body cannot be edited in place.
create or replace function public.notice_match_dropout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  select m.session_id into v_session
  from public.matches m where m.id = old.match_id;

  if v_session is not null then
    return null;
  end if;

  if public.notifiable_pickup_match(old.match_id)
     and (select count(*) from public.match_players where match_id = old.match_id)
         = public.match_seat_limit() - 1 then
    return null;
  end if;

  perform public.enqueue_dropout(old.player_id, null, old.match_id);
  return null;
end;
$$;

-- The sender gains the host's name.
--
-- "Hosted by Ted" is most of what a stranger needs from a pick-up game they said
-- yes to a fortnight ago, and the outbox row already knows the match. Appended at
-- the end of the select list because `create or replace view` will not reorder or
-- retype the columns that are already there.
--
-- Everything else is 20260901170000 verbatim, including the inlined attendance
-- arithmetic and the reason it is inlined rather than borrowed from
-- `session_attendance_summary`.
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
    host.name as host_name
  from public.notification_outbox n
  join public.profiles recipient on recipient.id = n.recipient_id
  join auth.users recipient_user on recipient_user.id = n.recipient_id
  join public.profiles subject on subject.id = n.subject_id
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

comment on function public.notifiable_pickup_match(uuid) is
  'Whether a match is an upcoming, live, non-league table — the only kind the match_full and match_reopened notices are about.';

comment on function public.enqueue_match_notice(text, uuid, uuid) is
  'Queues one notice of the given kind for everybody currently seated at a match.';

comment on table public.notification_outbox is
  'Notices waiting to be sent: somebody dropped out, a pick-up table filled up, or a full one lost a player. Written by triggers, drained by the notify-dropouts edge function.';
