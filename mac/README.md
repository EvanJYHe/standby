# Standby for Mac

A menu-bar app that watches your Google Calendar. When an appointment is cancelled, the slot shows up as an
opening; Standby offers it to the best person on your waitlist (the call is simulated in this version, and the app
says so), and when they say yes it books them into the slot on your Google Calendar ("Sarah · Haircut", noted
"Booked by Standby").

- macOS 14 Sonoma or later, Apple silicon and Intel (one universal binary).
- Builds with the Command Line Tools alone (Swift 6); no Xcode project.
- Without a Google OAuth client it runs on a built-in sample calendar, so a downloaded copy always works.

## Build

```bash
cd mac
scripts/build.sh                 # dist/Standby.app and ../public/downloads/Standby.dmg
scripts/build.sh --screenshots   # also renders the landing page's PNGs into ../public/landing/v2/app/
scripts/build.sh --icons         # re-renders Resources/AppIcon.iconset from the app's own drawing
```

`build.sh` compiles release builds for arm64 and x86_64 (`swift build --triple …`) and joins them with `lipo`,
assembles `Standby.app` (Info.plist, fonts, the Google "G", `AppIcon.icns` from `Resources/AppIcon.iconset`, and
the OAuth client from `Config.local.json` if present), signs it ad hoc, and builds a compressed DMG with the app and
an Applications link. Intermediates go to `.build/` and `dist/`.

Run from source with `swift run Standby` (debug builds read `Resources/` and `Config.local.json` from this folder).

## Test

```bash
scripts/test.sh                                   # unit tests (swift-testing)
dist/Standby.app/Contents/MacOS/Standby --self-test
```

`test.sh` is `swift test` plus the Command Line Tools' swift-testing paths (with Xcode, plain `swift test` works).
The unit tests cover opening detection from event-state diffs, waitlist ranking, title parsing, PKCE, Google request
building and response decoding, persistence, formatting and the sample day. `--self-test` checks what needs the app
itself: the OAuth loopback server over real HTTP on 127.0.0.1, a Keychain round trip (a throwaway item, deleted at
once), and the whole sample flow through the app model (cancellation → opening → simulated call → booking → saved).

## Connect Google (once, about five minutes)

Until this is done the app runs on sample data, and "Continue with Google" explains that this build has no Google
client.

1. Open https://console.cloud.google.com/ and create a project called "Standby".
2. APIs & Services → Library → enable **Google Calendar API**.
3. OAuth consent screen → External → app name "Standby", a support email → add the scopes `openid`, `email`,
   `profile`, `https://www.googleapis.com/auth/calendar.readonly` and
   `https://www.googleapis.com/auth/calendar.events` → add test users (your Gmail and anyone who will try it) → save.
   Unverified apps work for up to 100 test users and show Google's "unverified app" warning.
4. Credentials → Create credentials → OAuth client ID → **Desktop app**, named "Standby for Mac". Copy the client ID
   and secret into `mac/Config.local.json` (same shape as `Config.example.json`; the file is gitignored):

   ```json
   {"googleClientId": "….apps.googleusercontent.com", "googleClientSecret": "…"}
   ```

5. Run `scripts/build.sh` again. The client is copied into the app as `Contents/Resources/GoogleClient.json`. Google
   issues this secret to desktop clients and does not treat it as confidential, but keep it out of git anyway.

Sign-in uses Google's flow for installed apps: PKCE (S256), a one-shot listener on `http://127.0.0.1:<free port>`,
the system browser, `access_type=offline` and `prompt=consent`. Standby asks for the scopes above, keeps the
refresh token in the Keychain (generic password, service `co.evanhe.standby`), and refreshes access tokens itself.
An expired or revoked token shows "Reconnect Google" in the popover; network errors are retried on the next minute.

## How it works

- **Watching.** Every 60 seconds (and when the popover opens) Standby fetches each watched calendar's events from an
  hour ago to a week ahead (`singleEvents=true`, `showDeleted=true`, every page) and compares them with what it saw
  last time. An event that was confirmed and is now `cancelled`, or that vanished from the window before its time,
  becomes an opening. All-day events and anything over four hours are ignored; openings expire when they start.
- **Offering.** The waitlist is ranked by service match (an exact match before "Any"), then by who has waited
  longest. "Calling Sarah Chen…" runs for about three seconds and comes back "Sarah said yes": calls are simulated.
- **Booking.** "Book Sarah" checks the slot is still free, then `POST`s the event to the calendar the opening came
  from (Peacock, with a private `bookedByStandby` property). Sarah leaves the waitlist and the week's count goes up.
- **Data.** The waitlist, watched calendars, remembered event states, openings and bookings are in
  `~/Library/Application Support/Standby/state.json`. To start over, quit Standby, delete that folder, and delete the
  `co.evanhe.standby` item in Keychain Access.

**Sample data** is a barber's afternoon laid out around the next free hour (Michael, walk-ins, Josh's haircut, Ava,
Leo). Josh cancels a few seconds after watching starts and goes through the same detection path as a real
cancellation; bookings go into the sample calendar only. Settings → Account → "Reset sample" replays it.

## Screenshots for the website

`Standby --render-screenshots <dir>` renders six PNGs offscreen with SwiftUI's `ImageRenderer` at 2× and exits.
The clock is fixed at Friday, October 9, 2026, 4:12 PM (Toronto), with Josh's 5:00 PM haircut as the opening.

| File | What | Pixels | The UI inside |
| --- | --- | --- | --- |
| `onboarding-connect.png` | Welcome step, Google's button | 1328 × 1528 | window 1040 × 1240 at (144, 144) |
| `onboarding-calendars.png` | Calendar picker | 1328 × 1528 | window 1040 × 1240 at (144, 144) |
| `popover-openings.png` | The opening card, "Sarah said yes" | 1000 × 1360 | popover 760 × 1120 at (120, 120) |
| `popover-booked.png` | "Booked · Sarah Chen, 5:00 PM", 3 filled this week | 1000 × 1360 | popover 760 × 1120 at (120, 120) |
| `popover-today.png` | All booked, today's list | 1000 × 1360 | popover 760 × 1120 at (120, 120) |
| `settings-about.png` | Settings, About tab | 1168 × 1107 | window 880 × 819 at (144, 144) |

Backgrounds are transparent around rounded corners and a soft shadow, so the page can place them on a wallpaper.
Materials can't draw offscreen, so the popover uses a flat `#F3F4F6` that matches its frosted look over a light
desktop. The popover renders show Standby as it looks once Google is connected (no "Sample data" strip), with the
example day and people. `--render-review <dir>` writes extra states for checking layouts (calling, reconnect, the
Google account tab), not for the site.

## Installing a downloaded copy

The app is signed ad hoc, not with a Developer ID, so Gatekeeper stops it the first time:

- **macOS 14:** right-click Standby in Applications → Open → Open.
- **macOS 15 and later:** open it once, then System Settings → Privacy & Security → "Open Anyway".

After that it opens normally. Developer ID signing and notarization (Apple Developer Program, $99 a year) would
remove this step.

## Layout

```text
Package.swift                 StandbyCore (logic, tested) + Standby (the app) + StandbyCoreTests
Sources/StandbyCore/          models, OpeningDetector, WaitlistRanker, TitleParser, PKCE, GoogleAPI (requests and
                              decoding), GoogleColors, Store (JSON), Formatting, SampleData
Sources/Standby/App/          AppDelegate, StatusItemController (menu-bar icon + popover panel), window
                              controllers, screenshot and icon renderers, self-test
Sources/Standby/Model/        AppModel: sync loop, detection, offers, bookings, onboarding
Sources/Standby/Google/       GoogleAuth (OAuth), LoopbackServer (NWListener), GoogleCalendarClient, Keychain
Sources/Standby/Views/        popover, onboarding, calendar list, waitlist editor, settings tabs, components, mark
Resources/                    Geist, Instrument Serif and Google Sans Medium (OFL, with licences), Google's "G",
                              AppIcon.iconset
scripts/build.sh, test.sh
```

The Standby mark is drawn from its geometry as a SwiftUI `Shape` (the same as `public/landing/v2/standby-mark.svg`);
the menu-bar icon is that shape as a 16 pt template image, with a blue dot when an opening is waiting.
