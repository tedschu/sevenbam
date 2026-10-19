-- What the App Review demo account sees, run once against production on 2026-10-18.
--
-- Every profile it makes is is_demo, so after review it all comes out by that flag.
-- Running it a second time makes a second league, so do not.
do $$
declare
  v_demo uuid := (select id from auth.users where email = 'ted.schuster+demo@gmail.com');
  v_people uuid[];
  v_names text[] := array['Ruth Adler','Dottie Fischer','Linda Moy','Carol Baker','Bev Kaplan','Joan Ortiz','Marge Sullivan'];
  v_league uuid;
  v_season uuid;
  v_session uuid;
  v_match uuid;
  v_venue text := 'Mitchell Park Community Center';
  v_lat double precision := 37.4227;
  v_lng double precision := -122.1124;
  v_tz text := 'America/Los_Angeles';
  i int;
  -- Past nights: seats per table (indexes into v_people, 0 = the demo) and scores.
  v_tables int[][] := array[[0,1,2,3],[4,5,6,7],[1,4,3,6],[0,2,5,7]];
  v_scores int[][] := array[[75,40,25,-15],[90,35,10,-20],[60,55,20,5],[110,30,-5,-25]];
  v_t int;
  v_s int;
  v_who uuid;
  v_night timestamptz;
begin
  if v_demo is null then
    raise exception 'Demo account not found.';
  end if;

  update public.profiles
     set is_demo = true,
         name = coalesce(name, 'Jamie Park'),
         town = 'Palo Alto',
         home_latitude = 37.4419,
         home_longitude = -122.1430
   where id = v_demo;

  -- The made up players. No auth user, so no email address, so never emailed.
  v_people := array[v_demo];
  for i in 1 .. array_length(v_names, 1) loop
    insert into public.profiles (id, name, town, home_latitude, home_longitude, is_demo)
    values (gen_random_uuid(), v_names[i], 'Palo Alto', 37.4419, -122.1430, true)
    returning id into v_who;
    v_people := v_people || v_who;
  end loop;

  insert into public.leagues (name, color, created_by, is_public)
  values ('Palo Alto Tuesday Mahjong', 'teal', v_demo, false)
  returning id into v_league;

  insert into public.league_members (league_id, profile_id, role)
  select v_league, p, 'member' from unnest(v_people[2:8]) p;

  insert into public.seasons (league_id, name, status)
  values (v_league, 'Fall 2026', 'active')
  returning id into v_season;

  -- Two past Tuesdays, scored, then four upcoming ones. 7pm Pacific.
  for i in 1 .. 6 loop
    v_night := (timestamp '2026-10-06 19:00' + (i - 1) * interval '7 days') at time zone v_tz;
    insert into public.league_sessions (season_id, sequence, date_time, location, location_detail, latitude, longitude, time_zone)
    values (v_season, i, v_night, v_venue, 'Room A', v_lat, v_lng, v_tz)
    returning id into v_session;

    if i <= 2 then
      for v_t in 1 .. 2 loop
        v_who := v_people[v_tables[(i - 1) * 2 + v_t][1] + 1];
        insert into public.matches (host_id, date_time, location, location_detail, status, league_id, session_id, table_number, latitude, longitude, time_zone)
        values (v_who, v_night, v_venue, 'Room A', 'open', v_league, v_session, v_t, v_lat, v_lng, v_tz)
        returning id into v_match;

        for v_s in 2 .. 4 loop
          insert into public.match_players (match_id, player_id)
          values (v_match, v_people[v_tables[(i - 1) * 2 + v_t][v_s] + 1]);
        end loop;

        for v_s in 1 .. 4 loop
          update public.match_players
             set score = v_scores[(i - 1) * 2 + v_t][v_s],
                 score_updated_at = v_night + interval '3 hours',
                 score_updated_by = v_demo
           where match_id = v_match
             and player_id = v_people[v_tables[(i - 1) * 2 + v_t][v_s] + 1];
        end loop;

        update public.matches set status = 'completed' where id = v_match;
      end loop;
    end if;
  end loop;

  -- Pick-up games for Browse, each with a seat or two left.
  insert into public.matches (host_id, date_time, location, notes, supplies_provided, status, latitude, longitude, time_zone)
  values (v_people[2], (timestamp '2026-10-24 13:30') at time zone v_tz, 'Rinconada Library',
          'Open play, all levels welcome. Bring your 2026 card.', true, 'open', 37.4443, -122.1409, v_tz)
  returning id into v_match;
  insert into public.match_players (match_id, player_id) values (v_match, v_people[4]);

  insert into public.matches (host_id, date_time, location, notes, supplies_provided, status, latitude, longitude, time_zone)
  values (v_people[5], (timestamp '2026-10-29 18:30') at time zone v_tz, 'Mitchell Park Community Center',
          'Thursday evening game. One seat open.', true, 'open', v_lat, v_lng, v_tz)
  returning id into v_match;
  insert into public.match_players (match_id, player_id) values (v_match, v_people[6]), (v_match, v_people[7]);

  insert into public.matches (host_id, date_time, location, notes, supplies_provided, status, latitude, longitude, time_zone)
  values (v_people[3], (timestamp '2026-11-07 14:00') at time zone v_tz, 'Rinconada Library',
          'Saturday afternoon, beginners especially welcome.', false, 'open', 37.4443, -122.1409, v_tz)
  returning id into v_match;
end $$;
