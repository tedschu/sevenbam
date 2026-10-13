# App Review notes

Apple rejected the first iOS submission under Guideline 2.1, Information Needed: a new
developer account with no review history, asked to explain the app and show it running.
Not a policy finding. Nothing in the app was called out.

## Done in App Store Connect

- **App Review Information, Notes field**: filled and saved with answers 2 to 6. Apple
  asked for the information to live there for future submissions, so keep it current
  as the app changes. A stale answer is worse than none, because the reviewer checks it
  against the build. The field caps at 4,000 characters.
- **Sign-In Information**: already filled with ted.schuster+demo@gmail.com. Worth
  checking that the account still signs in and has a league, meetups, past games with
  scores and other members on it. A reviewer landing on empty screens is how 2.1
  comes back.
- **Reply to App Review**: written and saved as a draft, not sent. It is on the
  submission page under Messages, as Continue Draft. It claims a screen recording is
  attached, so attach the recording before sending it.

## The reply, as drafted

    Thank you for the review. This is our first submission. The answers are below, and the same information is now in the Notes field of App Review Information.
    
    1. SCREEN RECORDING
    Attached: a recording made on a physical iPhone running the current iOS, starting from launch. It covers registration, sign-in by both methods, browsing and joining a game, the organizer tools, score entry, Report a problem, and account deletion. The app is free, so there is no purchase flow.
    
    2. PURPOSE AND AUDIENCE
    SEVEN BAM helps American mahjong players find a game, and helps the people who organize those games run them. Players see open tables and public leagues near their town, and join or drop out in one tap. Organizers set up a season of meetups, and the app seats everyone who is coming into tables of four, collects each table's scores and keeps the standings.
    Audience: adult recreational mahjong players, largely 45 and older, and the volunteers who organize club and league play. For adults 18 and over, nothing directed at children, open to the public.
    Free: no in-app purchases, subscriptions, paid content or advertising. Not gambling: no stakes, wagers, prizes, odds or money anywhere, and no simulated gambling. A score is the point total a player types in after a game, used only to rank standings.
    
    3. ACCESS AND MAIN FEATURES
    The demo account is in the Sign-In fields of App Review Information, loaded with a league, meetups, past games with scores and other members, so no screen is empty. There is only one kind of account, and it organizes its league, so the organizer tools are visible.
    Browse (first tab): open tables and public leagues near you, by distance from the town on your profile. Use my location is optional; declining the iOS prompt leaves the app fully usable. Tap a card for details, then Join, and it appears under My Matches, where you can add it to a calendar, enter scores or drop out. Leagues holds the demo league's meetups, roster and standings; as organizer, draw the tables on a meetup, then enter scores. Ranking shows standings. Profile holds your details, email alerts, Report a problem, and Delete my account.
    User-generated content: no public feed, posting, messaging, commenting, photo upload or chat. The only text another member sees is a display name, a home town, a league name, and a venue name or note on a game. Email and phone are visible only to the member and to people at the same table or league.
    
    4. EXTERNAL SERVICES
    Supabase (Postgres, authentication, serverless functions): all accounts and data, access enforced per row. Sign-in by email and password, or Google Sign-In through Supabase, which supplies a name and photo only. Google Places API for venue and town autocomplete, called by our own server function, never from the device. Google Maps URL scheme to open an address. Resend for transactional email only. Expo and EAS as the build toolchain, no over-the-air code updates in this build. No analytics or advertising SDKs, no payment processor, no AI or machine-learning service, no data brokers.
    
    5. REGIONAL DIFFERENCES
    None. Behavior is identical in every region: no geo-gated content, no regional pricing (it is free), English-only interface. Venue suggestions rank places near where our members play first, a preference in ranking rather than a restriction.
    
    6. REGULATED INDUSTRY AND THIRD-PARTY MATERIAL
    Neither applies. Not a regulated industry and not gambling. No protected third-party material: the app carries no mahjong rules content and does not reproduce the National Mah Jongg League card, any copyrighted hand list, or any other party's rules or artwork. SEVEN BAM is our own name and the artwork our own. Published by Far West LLC.

## The recording, which is still to do

Apple wants one take on a physical device on current iOS, starting at launch. Simulator
recordings get rejected. Record with iOS Screen Recording, hold each screen for about
two seconds, and keep it under about three minutes. Sign out first, so the tape opens on
the app cold-launching to the sign-in screen.

1. Launch from the home screen. Splash, then sign-in.
2. Register with a throwaway address you control, and get through whatever confirmation
   the live project asks for. This is the flow Apple most wants to see, so do not skip
   to the demo account.
3. Sign out, then Continue with Google, to show the second method.
4. Sign out again and sign in with the demo account, so the rest of the tape has real
   data on screen.
5. Browse. Let the iOS location prompt appear and decline it, then show distances still
   working from the saved town. That answers the permission question before it is asked.
6. Join a game: tap a card, show details, Join, then My Matches with it listed. Open it
   and show add to calendar and the drop out control.
7. League: meetups, roster, standings. Draw the tables on a meetup, enter scores for a
   table, show the standings move.
8. Profile: name, town, phone, email alerts, the who can see what note, and the Report a
   problem section with the support address.
9. Delete my account, then the confirm step, landing back on sign-in. Apple requires
   this on tape for any app with registration.

## Before resubmitting

- **App icon is wrong in the shipped build.** Build 5 carries the stock Expo template
  icon, the blue chevron, because app.json points ios.icon at ./assets/expo.icon, which
  is the template icon composer bundle, and icon at assets/images/icon.png, which is the
  Expo logo. The real mark, the seven of bamboo, is at public/icon-512.png. This cannot
  be fixed in App Store Connect: the iOS App Store icon is read out of the build's asset
  catalog, so it takes a new EAS build and a new submission. Largest copy of the mark in
  the repo is 512 square, and Apple wants 1024, so either find the original art or
  accept a 2x upscale.
- **Screenshots**, Guideline 2.3.3: App Store screenshots must show the app in use, not
  the sign-in screen or title art. Use Browse, a league with its standings, and score
  entry.
- **Age rating**: the privacy policy says 18 and over. Make sure the App Store Connect
  age rating agrees rather than sitting at 4+.
- **Reporting and blocking**: Profile now carries a Report a problem section, which
  covers published contact information and a way to report. There is still no block.
  The argument for not needing one is that there is no feed and no messaging, which the
  reply makes honestly. If a reviewer presses on Guideline 1.2, the fix is a block that
  hides a blocked member's leagues from Browse.
- **Test on a device first.** The letter leads with it. Run the submitted build on a
  physical iPhone through TestFlight before resubmitting.
