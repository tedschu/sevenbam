-- Local development seed. Runs automatically on `supabase db reset`.
-- Never applied to remote — `db push` only ships migrations.
--
-- Sign in as any of these with password: password123

-- Members. The on_auth_user_created trigger derives public.profiles rows from
-- these, reading the name out of raw_user_meta_data.
-- The empty-string token columns are required: GoTrue scans them as non-null
-- strings, and NULLs make every sign-in fail with "Database error querying schema".
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'ted@example.com', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Ted"}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'sarah@example.com', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sarah"}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'mei@example.com', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Mei"}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'jian@example.com', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Jian"}',
   '', '', '', '', '', ''),
  -- Five and six exist so a league draw has to split across two tables, which is
  -- the case worth having in front of you while working on it.
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'alex@example.com', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Alex Ruiz"}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666',
   'authenticated', 'authenticated', 'priya@example.com', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Priya Nair"}',
   '', '', '', '', '', '');

update public.profiles set town = 'Brookline', experience_level = 'intermediate'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set town = 'Newton', experience_level = 'advanced'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set town = 'Cambridge', experience_level = 'beginner'
  where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set town = 'Somerville', experience_level = 'intermediate'
  where id = '44444444-4444-4444-4444-444444444444';

-- Ted's town gets coordinates so Browse's distance filter has an origin. These
-- are the centre of Brookline, MA, matching the town already set above — the app
-- fills them from a Places city result when a member picks a suggestion.
update public.profiles set home_latitude = 42.3318, home_longitude = -71.1212
  where id = '11111111-1111-1111-1111-111111111111';

-- Matches: one open that Ted hosts, one Ted joined but does not host, and one
-- completed with scores, so My Matches has both sections populated.
--
-- Coordinates are set on most venues and deliberately left off one, because
-- "no coordinates" is a case Browse has to handle rather than a gap in the seed:
-- every match proposed before the distance filter existed has none, and so does
-- any venue typed by hand. Distances from Brookline are roughly:
--   Ted's House            0 mi
--   Community Center       1 mi
--   Brookline Senior Ctr   1 mi
--   Newton Library         5 mi
--   Dusable              850 mi  (Chicago — well outside every radius option)
insert into public.matches (id, host_id, date_time, location, notes, supplies_provided, status,
                            latitude, longitude)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   now() + interval '3 days', 'Ted''s House', 'Parking on the street.', true, 'open',
   42.3318, -71.1212),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   now() + interval '6 days', 'Community Center', null, false, 'open',
   42.3370, -71.1100),
  -- Starts open so players can be seated; closed out below, the way a real
  -- match progresses. enforce_match_capacity refuses to seat anyone into a
  -- match that is already completed.
  -- Left without coordinates on purpose; see above.
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   now() - interval '8 days', 'Mei''s Place', 'Great night.', true, 'open',
   null, null);

-- Hosts are seated automatically by seat_host_after_match_insert, so only the
-- guests are inserted here.
insert into public.match_players (match_id, player_id)
values
  -- Ted hosts, Sarah joined. Still open.
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  -- Sarah hosts, Ted joined.
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  -- Completed match: Sarah and Mei joined Ted.
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333');

-- Scores are NMJL-shaped: each hand on the card is worth 25-85, so a session
-- total lands in multiples of five and a shut-out zero is normal.
update public.match_players set score = 50
  where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'
    and player_id = '11111111-1111-1111-1111-111111111111';
update public.match_players set score = 25
  where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'
    and player_id = '22222222-2222-2222-2222-222222222222';
update public.match_players set score = 35
  where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'
    and player_id = '33333333-3333-3333-3333-333333333333';

update public.matches set status = 'completed'
  where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- A fourth match with an empty seat that Ted is NOT in, so Browse has something
-- joinable, plus one that is already full.
insert into public.matches (id, host_id, date_time, location, notes, supplies_provided, status,
                            latitude, longitude)
values
  ('aaaaaaaa-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333',
   now() + interval '9 days', 'Newton Library', 'Beginners welcome.', true, 'open',
   42.3370, -71.2092),
  ('aaaaaaaa-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   now() + interval '12 days', 'Brookline Senior Center', null, false, 'open',
   42.3320, -71.1180),
  -- Far enough away that every radius option excludes it, so the filter can be
  -- seen working rather than assumed to work.
  ('aaaaaaaa-0000-0000-0000-000000000008', '33333333-3333-3333-3333-333333333333',
   now() + interval '4 days', 'Dusable Museum', 'A long way from Brookline.', false, 'open',
   41.7910, -87.6070);

insert into public.match_players (match_id, player_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222');
-- Fill match 5 to capacity (Sarah hosts, plus three) so the full state is
-- visible in Browse and sync_match_status flips it without any client help.
insert into public.match_players (match_id, player_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-0000-0000-0000-000000000005', '44444444-4444-4444-4444-444444444444');

-- Two more finished four-player nights, so the leaderboard has real history and
-- no single match decides the standings.
insert into public.matches (id, host_id, date_time, location, notes, supplies_provided, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   now() - interval '21 days', 'Ted''s House', null, true, 'open'),
  ('aaaaaaaa-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222',
   now() - interval '14 days', 'Community Center', null, false, 'open');

insert into public.match_players (match_id, player_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-0000-0000-0000-000000000006', '44444444-4444-4444-4444-444444444444'),
  ('aaaaaaaa-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000007', '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-0000-0000-0000-000000000007', '44444444-4444-4444-4444-444444444444');

-- Sarah takes the 21-days-ago night, Mei the 14-days-ago one, so the top of the
-- table is decided by totals rather than by one player sweeping every match.
update public.match_players set score = 50 where match_id = 'aaaaaaaa-0000-0000-0000-000000000006' and player_id = '11111111-1111-1111-1111-111111111111';
update public.match_players set score = 75 where match_id = 'aaaaaaaa-0000-0000-0000-000000000006' and player_id = '22222222-2222-2222-2222-222222222222';
update public.match_players set score = 0  where match_id = 'aaaaaaaa-0000-0000-0000-000000000006' and player_id = '33333333-3333-3333-3333-333333333333';
update public.match_players set score = 25 where match_id = 'aaaaaaaa-0000-0000-0000-000000000006' and player_id = '44444444-4444-4444-4444-444444444444';

update public.match_players set score = 60 where match_id = 'aaaaaaaa-0000-0000-0000-000000000007' and player_id = '11111111-1111-1111-1111-111111111111';
update public.match_players set score = 30 where match_id = 'aaaaaaaa-0000-0000-0000-000000000007' and player_id = '22222222-2222-2222-2222-222222222222';
update public.match_players set score = 85 where match_id = 'aaaaaaaa-0000-0000-0000-000000000007' and player_id = '33333333-3333-3333-3333-333333333333';
update public.match_players set score = 0  where match_id = 'aaaaaaaa-0000-0000-0000-000000000007' and player_id = '44444444-4444-4444-4444-444444444444';

update public.matches set status = 'completed'
  where id in ('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000007');

-- A league with six members, so the draw has to split them across two tables.
-- Ted organizes it; seat_league_creator_after_insert makes that happen, so only
-- the other five are inserted below.
insert into public.leagues (id, name, color, created_by, invite_token, is_public, max_members)
values (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'Fox Valley League',
  'gold',
  '11111111-1111-1111-1111-111111111111',
  'seed-invite-1',
  -- Public with a cap of eight against six members, so Browse has a league with
  -- seats left to show. Ted is in this one, which is the "You're in" case.
  true, 8
);

insert into public.league_members (league_id, profile_id, role)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'member'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'member'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'member');

-- A second league Ted is NOT in, to prove the standings switcher only offers the
-- leagues you belong to and that RLS hides the rest. Left private, which also
-- proves Browse does not offer a league that has not opted in.
insert into public.leagues (id, name, color, created_by, invite_token)
values (
  'bbbbbbbb-0000-0000-0000-000000000002',
  'Tuesday Nighters',
  'plum',
  '22222222-2222-2222-2222-222222222222',
  'seed-invite-2'
);

-- A public league Ted is NOT in, which is the case Browse exists to serve: a
-- joinable league with room and a meetup nearby.
insert into public.leagues (id, name, color, created_by, invite_token, is_public, max_members)
values (
  'bbbbbbbb-0000-0000-0000-000000000003',
  'Riverside Mahjong Club',
  'teal',
  '22222222-2222-2222-2222-222222222222',
  'seed-invite-3',
  true, 8
);

insert into public.league_members (league_id, profile_id, role)
values
  ('bbbbbbbb-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'member');

insert into public.seasons (id, league_id, name)
values (
  'cccccccc-0000-0000-0000-000000000002',
  'bbbbbbbb-0000-0000-0000-000000000003',
  'Fall 2026'
);

-- One meetup, three miles from Brookline, so the league survives a 5-mile filter.
insert into public.league_sessions (season_id, sequence, date_time, location, latitude, longitude)
values (
  'cccccccc-0000-0000-0000-000000000002', 1,
  date_trunc('day', now() at time zone 'America/Chicago')
    + interval '5 days' + interval '19 hours',
  'Riverside Community Room', 42.3600, -71.0900
);

-- And a full public league, which Browse must not offer at all: two of two taken.
insert into public.leagues (id, name, color, created_by, invite_token, is_public, max_members)
values (
  'bbbbbbbb-0000-0000-0000-000000000004',
  'Full House Club',
  'orange',
  '22222222-2222-2222-2222-222222222222',
  'seed-invite-4',
  true, 2
);

insert into public.league_members (league_id, profile_id, role)
values
  ('bbbbbbbb-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', 'member');

insert into public.seasons (id, league_id, name)
values (
  'cccccccc-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'Fall 2026'
);

-- Six meetups, the shape the season was described in. Left undrawn so the draw
-- can be exercised from the app.
insert into public.league_sessions (season_id, sequence, date_time, location, location_detail)
select
  'cccccccc-0000-0000-0000-000000000001',
  n,
  -- 7pm local. Truncating a UTC now() and adding 19 hours lands at 6am in
  -- Chicago, so the day is trimmed in the target zone and converted back.
  (date_trunc('day', now() at time zone 'America/Chicago')
    + (n * interval '7 days') + interval '19 hours') at time zone 'America/Chicago',
  'Geneva Public Library District',
  'South 7th Street, Geneva, IL, USA'
from generate_series(1, 6) as g(n);

-- Contact details, so the "reach the host" section on a match sheet and the
-- organizer block on a league have something to draw. Only two members give a
-- phone number: it is optional, and the common case is an email address alone.
insert into public.profile_contacts (profile_id, phone)
values
  ('11111111-1111-1111-1111-111111111111', '(630) 555-0142'),
  ('22222222-2222-2222-2222-222222222222', '(630) 555-0198');

-- An archived league Ted organizes, so that state is visible without having to
-- create it. Public and capped, which is the case worth seeing: archiving has to
-- un-list a league from Browse without erasing the setting it had, so unarchiving
-- puts it back exactly as it was.
insert into public.leagues (id, name, color, created_by, invite_token, is_public, max_members, archived_at)
values (
  'bbbbbbbb-0000-0000-0000-000000000005',
  'Spring 2026 Ladder',
  'blue',
  '11111111-1111-1111-1111-111111111111',
  'seed-invite-5',
  true, 8,
  now() - interval '30 days'
);

insert into public.league_members (league_id, profile_id, role)
values
  ('bbbbbbbb-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'member'),
  ('bbbbbbbb-0000-0000-0000-000000000005', '44444444-4444-4444-4444-444444444444', 'member');

-- Ted is the local stand-in for the maintainer account, so global view can be
-- exercised against the seed. Production's admin is added by migration
-- 20260827140000, which matches on the real email address and finds nothing here.
insert into public.app_admins (profile_id)
values ('11111111-1111-1111-1111-111111111111')
on conflict (profile_id) do nothing;
