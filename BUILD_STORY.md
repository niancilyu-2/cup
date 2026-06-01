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

## Up next

- **Phase 4** — auto-fetch live results via a Supabase Edge Function on a 30-minute cron, hitting ESPN's undocumented WC scoreboard endpoint. Admin entry remains the manual fallback.
- **Phase 5** — reveal-day polish: tournament-style bracket visualization, share cards, end-of-tournament wrap-up screen.
