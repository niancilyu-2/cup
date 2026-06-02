# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project Overview

**WC 2026 Bracket** — a pick'em bracket for ~10 friends to predict the 2026 FIFA World Cup.

- Plain HTML/CSS/JS, no build step
- Supabase (Postgres) backend, accessed via the public anon key
- GitHub Pages hosting
- Self-signup (no auth); admin actions gated by a shared admin code in `config.js`
- ESPN's undocumented WC scoreboard endpoint pulled every 30 min by a GitHub Actions cron (`scripts/sync-espn.js`, public anon key); manual admin entry is the fallback

## Tournament format (2026 only)

- 48 teams in 12 groups of 4
- Top 2 of each group + 8 best 3rd-place teams advance to the Round of 32
- Knockouts: R32 → R16 → QF → SF → Final (+ 3rd place)
- 104 matches total; tournament runs June 11 – July 19, 2026

## Pick model (single phase)

All sections open from day 1 and lock at the first WC kickoff on June 11.

- **Group ranks**: rank all 4 teams in each of the 12 groups by dragging rows into 1st/2nd/3rd/4th order (SortableJS, mouse + touch). 1st and 2nd score group-stage points; the 3rd team is eligible for wildcard selection.
- **Wildcards**: pick exactly 8 of the 12 third-place teams. The R32 matchups are looked up from FIFA's official Annexe C table (`src/wildcards-table.js`); the user does not assign slots manually.
- **Bracket winners**: click a team in each knockout match to advance through R32 → R16 → QF → SF → Final, plus the 3rd-place match. R32 auto-populates from group ranks + wildcards.
- **Tiebreaker**: predicted average goals per game for the player's predicted champion. The champion is derived from the Final winner pick (`bracket_picks` row for `M104`), not picked separately. Stored as `tiebreaker_picks.champion_avg_goals NUMERIC(4,2)`.

## Two-tier save model

- Clicks edit a **draft** state held in memory; never written to DB on click.
- **Save my picks**: flushes the draft to DB. Picks remain editable.
- **Submit**: flushes the draft to DB AND sets `players.groups_submitted_at` / `bracket_submitted_at`. Editing is disabled until **Edit picks** clears those timestamps.
- **Auto-pick (groups only)**: shuffles teams in any empty group and assigns the top two as 1st/2nd. Updates draft only — Save to persist.
- Navigation guards (browser `beforeunload` + custom modal on internal links) fire whenever the draft differs from the saved snapshot. The modal offers Save & continue / Leave without saving / Cancel — no Submit shortcut.

## Lock & visibility

- `LOCK_DATE_ISO` (June 11 13:00 -06:00) freezes all picks. After lock, everyone's picks are revealed and the leaderboard goes live.

## Scoring (final)

- Group standings: 1 point per correctly placed team (1st or 2nd slot of any group)
- Wildcards: 1 point for each group the player flagged as advancing whose 3rd-place team actually advanced (max 8, since the player picks 8 of 12)
- R32 winner: 2 / R16: 4 / QF: 6 / SF: 8 / Final: 12
- Tiebreaker: closest guess to the actual tournament champion's average goals per game (a decimal per player). Compared against reality regardless of which team the player picked to win.

Perfect bracket = 148 points.

## Files

- `index.html` — static shell (picks page; supports `?view=<player_id>` for read-only viewing of another player)
- `app.js` — core logic (picks, lock, bracket cascade, view-only mode)
- `leaderboard.html` / `leaderboard.js` — Supabase-backed standings; uses `src/scoring.js`
- `livescores.html` / `livescores.js` — schedule + live scores rendered from the `matches` table
- `admin.html` / `admin.js` — admin-only results-entry page (not in nav); gated by ADMIN_CODE
- `src/scoring.js` — pure scoring engine (tested in `tests/scoring.test.js`)
- `style.css` — stadium-green chrome on a vector soccer-pitch background; white card surfaces; bracket connectors in deep green
- `schema.sql` — Supabase tables and seed data
- `config.example.js` — credentials template (copy to `config.js`)
- `config.js` — real credentials (gitignored)

## Conventions

- Every code file starts with two `ABOUTME:` comment lines
- No build step; no npm; no frameworks
- Match the surrounding code style; don't manually tweak whitespace
- Dates are stored in UTC; UI displays in US Eastern time
