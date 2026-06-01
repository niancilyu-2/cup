# Build story

A phased log of how this bracket came together. Each phase summarizes what was built and which decisions stuck. Authoritative detail lives in `git log`; this file is the readable narrative.

## Phase 0 — Scaffold (2026-05-19)

Empty project to working skeleton: static `index.html`, `app.js`, `style.css`, Supabase wiring through `config.js`, `package.json` with the Vitest harness, and a `.gitignore` that keeps credentials out of the repo.

## Phase 1 — Schema and seed (2026-05-19)

Postgres schema for `groups`, `teams`, `matches`, `players`, plus `group_picks`, `wildcard_picks`, `bracket_picks`, and `tiebreaker_picks`. Seed data covers all 48 teams, the 12 groups, and every one of the 104 matches with kickoff times and venues. Row-level security uses trust-based `USING (true)` policies — the app is for ~10 friends.

## Phase 2 — Picks UI (2026-05-19)

Built in three chunks:

- **2a** — self-signup with an existing-players picker, a `+ new player` fallback, and the Vitest harness wired up.
- **2b** — group-standings picker. Several iterations: tap-to-swap rather than drag-and-drop, real flag images, fixed row alignment, and a fix for a freeze on repeated picks.
- **2c** — bracket layout, R32 team picker, then winner cascade through every knockout round to the Final.

The pick model itself went through three shapes before settling:

1. Free-draft R32 (rejected — too easy to break the bracket).
2. Two-stage commit: groups first, bracket second.
3. **Final shape**: single phase, all four sections open from day one. Picks live in an in-memory draft; **Save my picks** writes the draft, **Submit** writes and locks until **Edit picks** clears the timestamps. Group ranks moved to 1–3 with explicit wildcard selection (pick 8 of 12 third-place teams). R32 slots are looked up from FIFA's official Annexe C table in `src/wildcards-table.js`, not assigned by hand.

## Visual identity pivots (2026-05-21 → 2026-05-26)

Two themes were attempted. The first was a literal **soccer-pitch theme** — cartoon sky background, grass, white card surfaces, deep-green bracket connectors. It read well as a one-off but fought every UI element that needed to be legible.

It was replaced by an **editorial broadcast theme**: true-black surfaces, a single yellow accent, condensed display type (Oswald wordmark + JetBrains Mono for numerals), hairline chrome rather than borders, news ticker across the top, sticky actions bar, footer signature. The countdown to first kickoff is a vintage split-flap scoreboard with brass-rim flip cards. This is the theme that shipped.

## Phase 3 — Scoring, leaderboard, admin (2026-05-26)

- **3a** — pure scoring engine in `src/scoring.js` with Vitest coverage. No DOM dependencies; reused by both leaderboard and admin code.
- **3b** — real leaderboard wired to the scoring engine. Replaced the mock placeholder.
- **3c** — admin results-entry page (`admin.html` / `admin.js`), gated by `ADMIN_CODE` in `config.js`. Used only when the automated ESPN poll falls behind.
- **3d** — read-only view of another player's picks via `?view=<player_id>`, with a banner and a back link to the leaderboard.

## UX, mobile, and identity pass (2026-05-26)

Polish that touched every page:

- **Collapsible Groups and Wildcards** with a smart default: collapsed once the section is complete, expanded otherwise. Persisted in `localStorage`. Bracket becomes the prominent live area.
- **Bracket live preview** — `mock-results.js` exposes a synthetic `MOCK_TOURNAMENT` so the bracket renders score lines and per-pick ✓/✗ before any real match is played. Phase 4 swaps this for real data without changing `renderBracket()`.
- **Leaderboard hover breakdown** — per-stage points popover on each player's total.
- **Drop exact-score bonus** — simplified scoring to the table now in `rules.html` (perfect bracket = 148 after the QF/Final bump).
- **Live scores page** — standalone schedule + scores view that overlays `MOCK_TOURNAMENT` until Phase 4 lands.
- **Privacy gate** — until first kickoff, only your own picks are visible to you.
- **Per-player PIN auth** — SHA-256 hash stored as `players.pin_hash`. Trust-based, not adversarial.
- **Unified nav across all five pages** — My picks → Leaderboard → Rules → Live scores, with pill overlay for the active tab. The user chip + switch button now travels across pages via the shared `user-bar.js`.
- **Mobile pass** — stepper chevrons as inline SVG, condensed at 560px; bracket compacts at 600px; section toggle summaries hide on narrow screens.
- **Admin** — delete players from the admin page (added `players_delete` RLS policy in `schema.sql`); shortened Bosnia and Herzegovina to "Bosnia" in the admin UI only.

## Phase 4 — Results sync (2026-06-01)

Automated pull of match results from ESPN's undocumented World Cup scoreboard. Decisions that stuck:

- **GitHub Actions cron, not a Supabase Edge Function.** The repo already had Node + Vitest; no Deno/Supabase CLI to learn. The script (`scripts/sync-espn.js`) runs every 30 minutes, is testable locally, and its logs live in the Actions tab.
- **Public anon key, not the service-role key.** `matches` SELECT + UPDATE are already open to anon via RLS (the same path `admin.js` uses), so the cron needs no elevated secret. The dangerous key never enters the repo or CI.
- **Tournament-windowed schedule.** Cron fires `*/30` only across June 11–July 19 (UTC), so it stays dormant until kickoff instead of running year-round.
- **Scores + derived cascade.** The script writes raw scores and, on final results, computes group standings (FIFA tiebreakers, `src/standings.js`), assigns the 8 best third-places via the Annexe C table, and fills knockout matchups (`src/cascade.js`). In-progress scores are written for the Live Scores tab; the leaderboard/picks pages only react to completed matches.
- **Admin always wins.** Rows with `result_source='manual'` are never overwritten by the sync.

Pieces: `src/espn-map.js` (name → FIFA-code map + event normalizer), `src/standings.js`, `src/cascade.js`, `scripts/{espn-fetch,supabase-rest,sync-espn}.js`, `.github/workflows/sync-results.yml`, plus unit + fixture tests.

**Validation before launch.** Confirmed ESPN fetching works from both this machine and the Actions runner. Replayed the real **2022 World Cup** through the parser — finals, group draws (no winner), and penalty shootouts (regulation score kept, shootout winner flagged) all handled, locked in with a regression test. Ran a full simulated group stage as a read-only dry-run against prod (72 finals → 16 R32 fills, 32 distinct teams, no duplicates), then a live write-and-revert to prove the write path. The dry-run caught a real bug: ESPN spells it **"Bosnia-Herzegovina"** (hyphenated), which the map missed — all three of Bosnia's group games would have silently failed to sync.

## Phase 4b — Frontend on real data (2026-06-01)

The sync wrote correct data, but the pages were never wired to read it — they still ran on the `MOCK_TOURNAMENT` stub. Fixed:

- New `src/results.js` derives the `{groupOutcomes, matchResults}` scoring shape from raw match rows (shared by leaderboard + picks page).
- New `src/projection.js` computes the **mathematically-reachable maximum** soundly: a knockout pick counts toward a player's max only if that team can still reach the match — excluding teams that didn't qualify or are stranded in the wrong half by real seeding. The champion ❌ marker uses the same reachability.
- Leaderboard, picks/bracket overlay, and live-scores all read real results; `mock-results.js` deleted; pre-tournament empty states added.

## Bug sweeps (2026-06-01)

Two passes, with parallel review agents (findings verified against code — several false positives rejected):

- **Stale bracket picks** — changing a group/wildcard after building the bracket left stale teams advancing downstream and let the Submit gate pass with invalid picks. `teamForSlot`, `isBracketComplete`, and auto-pick are now validity-aware.
- **Reachability tightening** — a team that finished 4th in a completed group is out immediately; max-possible no longer over-counts it.
- **Wildcard ✓/✗ timing** — only shown once all 12 groups finish (the 8 advancing thirds aren't knowable before then).
- **Admin score validation** — reject negative/decimal/NaN scores and group draws saved with a winner.
- **Storage resilience** — corrupted `localStorage` no longer crashes page load.
- **Group ranked ✓** — each group card shows a check once the player has ranked it.

## Phase 5 — Reveal + visual polish

Effectively delivered across earlier work and confirmed done: the editorial broadcast theme, the column bracket with connectors, the date-based reveal/privacy gate (picks revealed + leaderboard live once matches start), the "Picks locked" countdown, and the leaderboard viz (medals, Accuracy %, Max-possible, hover breakdown). No separate FIFA-style redesign was pursued.

## Going live (2026-06-01)

Hosted on **GitHub Pages** at **https://niancilyu-2.github.io/wc/**. Because the repo is public and `config.js` is gitignored, a deploy workflow (`.github/workflows/deploy-pages.yml`) **generates `config.js` at build time from repo secrets** — the anon key and admin code never live in the public repo. Pages source is set to "GitHub Actions"; every push to `main` redeploys.

## Operations cheat-sheet

- **Live site:** https://niancilyu-2.github.io/wc/ (auto-deploys on push to `main`).
- **Repo secrets** (Settings → Secrets → Actions): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_CODE`. The deploy injects all three into `config.js`; the sync uses the first two.
- **Two workflows:** `deploy-pages.yml` (on push) and `sync-results.yml` (every 30 min, June 11–July 19 UTC, + manual `workflow_dispatch`).
- **Entering results:** automatic via the sync once the tournament starts; manual fallback is `admin.html` (gated by `ADMIN_CODE`), which always wins over the sync.
- **Local credentials:** copy `config.example.js` → `config.js` (gitignored) to run locally.
- **Tests:** `npm test` (Vitest). **Lock date:** `LOCK_DATE_ISO` in `app.js` (June 11, 13:00 -06:00).
