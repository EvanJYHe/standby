# Standby

A Mac menu-bar app that refills cancelled appointments from your Google Calendar, by Evan He: the app in `mac/`
(Swift package, see `mac/README.md`) and its static landing page at `/` (React + Vite + Tailwind, Vercel). The old
hackathon web demo and its API are gone; `/app` redirects to `/`.

**Project memory:** `/Users/evanhe/repos/projects/project-vaults/standby/` holds Evan's decisions, his feedback in his
words, references with screenshots, and open questions. Read its `README.md` before changing how anything looks, and
record new feedback and decisions there.

**Briefs:** `design/landing-page-handoff.md` (brand, type, colour, motion) and `design/mac-app-and-landing-v2-handoff.md`
(the Mac app and this version of the page) in that folder.

## Commands

- `npm run dev`: the landing page on http://127.0.0.1:5174
- `npm run typecheck`, `npm run test:run`, `npm run build` (what Vercel runs); `npm run check` runs all three
- `npm run preview`: the production build
- `mac/scripts/build.sh`: builds the app and `public/downloads/Standby.dmg`; `--screenshots` re-renders
  `public/landing/v2/app/*.png` (the page uses WebP copies of `popover-openings` and `popover-booked`; reconvert with
  `cwebp -lossless -z 9` after re-rendering)

## Rules

- Never claim real phone calls, texts or AI voices: calls are simulated in this version.
- Nothing is committed, pushed or deployed unless Evan asks.
