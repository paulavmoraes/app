# Chores: shared household chores PWA

A chores tracker for a single household (2–3 flatmates). It is a mobile-first, installable PWA with web push. The UI is in English. Timezone is Europe/London and the week starts on Monday.

## Commands
- `npm run dev`: Vite + Worker (`@cloudflare/vite-plugin`) with a local D1 at http://localhost:5173
- `npm test`: Vitest (domain unit tests in `src/domain/*.test.ts`)
- `npm run typecheck`: `tsc -b` (app + worker projects)
- `npm run build`: production build into `dist/`
- `npm run db:generate`: generate a migration from `src/worker/db/schema.ts`
- `npm run db:migrate:local` / `db:migrate:remote`: apply D1 migrations
- `npm run deploy`: build, run remote migrations, `wrangler deploy` (needs a Cloudflare account; set the real `database_id` in `wrangler.jsonc` first)
- `npm run smoke`: Playwright end-to-end smoke test (two phone browsers). Needs `npm run dev` running on a **fresh** local DB: `rm -rf .wrangler/state && npm run db:migrate:local`, with `SETUP_TOKEN=dev-setup` in `.dev.vars`.
- `npm run test:rules`: API scenario test with a simulated clock (overdue → missed → penalty, swaps, away). Same fresh-DB requirement as the smoke test, plus `TEST_CLOCK=1` in `.dev.vars`. Run it and the smoke test on separate fresh DBs.
- Local secrets go in `.dev.vars` (see `.dev.vars.example`). `FAKE_NOW=<ISO instant>` in `.dev.vars` makes the API pretend it's that time (for testing overdue and cron).
- First run: open `/setup?token=<SETUP_TOKEN>` to create the household and the first member.

## Stack and layout
- Cloudflare Worker (Hono) serves `/api/*` and the static React app (SPA fallback). D1 (SQLite) via Drizzle. An hourly Cron Trigger handles scheduling.
- `src/domain/`: pure recurrence, rotation, penalty and away logic. No I/O. Every rule gets unit tests here.
- `src/worker/`: API routes, auth, DB schema, cron and push.
- `src/client/`: React + React Router + TanStack Query + Tailwind.
- `migrations/`: D1 SQL migrations.

## Product decisions (source of truth: keep updated)
- **Single household.** Members have a display name and a unique colour. Access uses single-use links that expire after 7 days (join, or "sign in as X on a new device"), with no passwords. iOS installed PWAs don't share cookies with Safari, so a 6-character pairing code (valid 10 min) links the installed app.
- **Dates:** occurrence dates are London calendar dates (`YYYY-MM-DD`). Timestamps are stored in UTC.
- **Recurring tasks:**
  - Schedules are *fixed weekdays* or an *interval* (days, weeks or months).
  - Interval tasks count either from the last completion or from the original schedule. In schedule mode dates are `start + k·n` from the anchor, with months clamped.
  - The assignee is either fixed or a rotation (an ordered list). The rotation advances on every occurrence.
- **Edits affect the future only.** Each edit creates a new task version effective from today. Pending occurrences dated today or later are regenerated. Done, missed and overdue rows are never touched.
- **Completion:** anyone can complete any occurrence and can change "done by". Completions and quick ticks can be undone for 10 minutes.
- **Overdue → missed:** a pending occurrence after its date is "overdue by X days". It stays with the same assignee, can still be completed, and appears in the daily summary. It becomes **missed** only when the next occurrence of the same task reaches its date. This applies to weekday tasks and interval tasks counted from the schedule. Interval tasks counted from completion never become missed and have no penalty. A missed occurrence can't be completed.
- **Penalty** (one extra shift): the person who missed it takes the next occurrence of the **same task** that belongs to someone else. If there isn't one, they take the soonest pending occurrence of any task belonging to someone else. If there's none of those either, the penalty is kept as *owed* and applied later. Rotation order never changes. If a swap was accepted, the person who took the shift is responsible.
- **Swap:** A hands one occurrence to B. B accepts or declines, and proposals never expire. A proposal is auto-cancelled if the occurrence is completed, missed or removed by an edit. Swaps don't change the rotation.
- **Away:** rotations skip the away person, and a fixed assignee who is away is covered by the members at home in turn. There are no penalties and no notifications while away, and nothing is owed afterwards.
- **Quick ticks:** no schedule. One tap logs who did it and when, and the app shows when it was last done.
- **Notifications:** web push plus an in-app inbox. A daily summary goes out at 09:00 London time with tasks due today and overdue tasks. Swap proposed, accepted and declined also send notifications. There are no per-user settings.
- **No scores, streaks or "who does more" stats.** History is a plain log.
- **Out of scope for the MVP:** gamification, effort points, checklists, rooms, multiple households.

## Implementation notes
- Occurrences are stored up to 90 days ahead (`HORIZON_DAYS`). They're topped up on every authed GET and by the hourly cron. Each row stores the rotation state after it (`pointer_after`, `cover_after`) so generation continues deterministically.
- Completion-anchored tasks have exactly one pending occurrence. Completing one creates the next (`spawned_by_id`), and undo deletes it again.
- D1 enforces foreign keys, so archive and edits **cancel** pending occurrences instead of deleting them. A cancelled row is reused if its date comes back.
- Edits use `applyNewVersion` → `regenerateFuture`, and the 90-day top-up uses `materializeTask`. Both go through `reconcileSeries`, which applies the pure `planRegeneration` (`src/domain/edit.ts`): rows on the same date are reused, swap and penalty overrides survive, removed dates are cancelled, and done/missed rows are skipped.
- The rotation carries over on edit (`carryPointer`): whoever was next up stays next up in the new order.
- Completion-anchored edits: future pending rows are cancelled, an overdue one stays, and `ensureNextCompletionOccurrence` recreates the next one (last completion + new interval).
- The calendar (`GET /api/calendar`, max 62 days) returns stored rows plus *projected* ones beyond the horizon (`projected: true`, which can't be completed or swapped).
- Home shows, per task, every occurrence due up to today, or else only the next one, grouped by assignee.
- Settings is opened from the avatar (top right). The tabs are Today, Home, Calendar, Tasks and History.
- `runMaintenance` (`src/worker/services/rules.ts`) runs on every authed GET and from the hourly cron: top up the horizon → `detectMissed` → `applyOwedPenalties`. All three are idempotent. The pure rules are in `src/domain/penalty.ts`.
- Penalty details: the debtor is the occurrence's current assignee. The target must be dated today or later, belong to someone else, not be another person's penalty shift, and not fall on a day the debtor is away. No penalty if the assignee was away on the due date or on the day it became missed.
- Swaps: only the current assignee can propose, and only one pending request per occurrence. The other person can't be away that day. Accepting sets `override = swap`. Accepted swaps appear in History.
- Away: anyone sets their own periods (no minimum length is enforced; the UI says it's for trips over 5 days). Changing away periods re-plans all tasks from today (`replanAll`). A swap or penalty shift on a day its holder is away is given up, and a released penalty goes back to *owed*.
- `notify()` (`src/worker/services/notify.ts`) writes inbox rows (missed, extra shift, freed, swap proposed/accepted/declined) and skips members who are away today. Web push and the inbox screen come in phase 4.
- `TEST_CLOCK=1` (dev only, never in production) lets a request set the time with an `x-test-now` header.
- Set `WRANGLER_SEND_METRICS=false` in the sandbox, because telemetry hosts are blocked.

## Build phases
0. Scaffold ✅
1. Invites and users, recurring tasks with rotation, quick ticks, Today screen, History ✅
2. Calendar, Home screen, future-only edits ✅
3. Swaps, overdue/missed and penalties, away mode ✅
4. Push notifications, notifications tab, PWA install
