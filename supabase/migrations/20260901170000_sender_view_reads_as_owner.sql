-- The sender's view stops borrowing a caller's permissions.
--
-- `pending_notifications` was declared `security_invoker = off` so it would read
-- the whole service as its owner — the sender is a background job with no user
-- behind it, and there is no member whose reach it should be limited to. That is
-- still right, but it was not what happened: the view joined
-- `session_attendance_summary`, which is itself `security_invoker = true`, and a
-- nested invoker view re-checks against the real caller rather than the outer
-- view's owner. So the summary's own tables were tested against service_role,
-- which has no grant on them, and the read failed with
--
--   permission denied for table league_sessions
--
-- It failed in a nastily quiet way. Postgres drops a LEFT JOIN whose columns
-- nobody selected, so any query not asking for `going` or `expected_tables`
-- succeeded — which is why the deployed function answered 200 against an empty
-- queue and only broke once there was a real notice to read.
--
-- Fixed by computing the two numbers here from base tables instead of borrowing
-- the summary view. The arithmetic is duplicated, which is the cost; the summary
-- is a member-facing view with member-facing permissions, and reaching through it
-- from a background job was the wrong direction. Kept deliberately identical to
-- 20260818025000: everyone on the roster whose account is open counts as coming
-- unless they have said 'out'.
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
    tally.expected_tables
  from public.notification_outbox n
  join public.profiles recipient on recipient.id = n.recipient_id
  join auth.users recipient_user on recipient_user.id = n.recipient_id
  join public.profiles subject on subject.id = n.subject_id
  left join public.league_sessions ls on ls.id = n.session_id
  left join public.matches m on m.id = n.match_id
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
