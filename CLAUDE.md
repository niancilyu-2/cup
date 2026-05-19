# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project Overview

**WC 2026 Bracket** — a pick'em bracket for ~10 friends to predict the 2026 FIFA World Cup.

- Plain HTML/CSS/JS, no build step
- Supabase (Postgres) backend, accessed via the public anon key
- GitHub Pages hosting
- Self-signup (no auth); admin actions gated by a shared admin code in `config.js`
- ESPN's undocumented WC scoreboard endpoint pulled every 30 min by a Supabase Edge Function; manual admin entry is the fallback

## Tournament format (2026 only)

- 48 teams in 12 groups of 4
- Top 2 of each group + 8 best 3rd-place teams advance to the Round of 32
- Knockouts: R32 → R16 → QF → SF → Final (+ 3rd place)
- 104 matches total; tournament runs June 11 – July 19, 2026

## Pick model (two stages)

**Phase 1 — Group standings (locks June 11 first kickoff)**
- For each of the 12 groups, predict 1st and 2nd.

**Phase 2 — Bracket (opens after group stage, locks at first R32 kickoff June 28)**
- The R32 matches are populated with the real qualifying teams (24 group winners/runners-up + 8 best 3rds) via FIFA's bracket resolution rules. Admin/auto-fetch sets `matches.team_a_code` / `team_b_code` for M73–M88 once group stage ends.
- User clicks winners through R32 → R16 → QF → SF → Final, plus the 3rd-place match.
- Tiebreaker: predicted total goals scored by the eventual champion (a single integer).
- Optional exact-score predictions for any knockout match (R32+), earning bonus points.

## Lock & visibility

- `GROUP_LOCK_ISO` (June 11 13:00 -06:00) freezes group picks.
- Bracket opens once all 16 R32 matches have `team_a_code` and `team_b_code` populated (or earlier via `?stage=bracket-open` dev override).
- `BRACKET_LOCK_ISO` (June 28 15:00 -07:00) freezes bracket picks.
- Other users' picks are hidden until lock; revealed at first kickoff of each stage.

## Scoring (final)

- Group standings: 1 point per correctly placed team (1st or 2nd slot of any group)
- R32 winner: 2 / R16: 4 / QF: 5 / SF: 8 / Final: 10
- Exact-score bonus: +2 per knockout match (R32+) where the predicted score matches the actual. **Does NOT apply to group-stage matches.**
- Tiebreaker: closest guess to the actual champion's total tournament goals (a single integer per player). Compared against reality regardless of which team the player picked to win.

Perfect bracket = 134 points before bonuses. Max with all 32 exact-score bonuses = 198.

## Files

- `index.html` — static shell
- `app.js` — core logic (picks, lock, leaderboard, bracket)
- `style.css` — FIFA-inspired dark broadcast palette
- `schema.sql` — Supabase tables and seed data
- `config.example.js` — credentials template (copy to `config.js`)
- `config.js` — real credentials (gitignored)

## Conventions

- Every code file starts with two `ABOUTME:` comment lines
- No build step; no npm; no frameworks
- Match the surrounding code style; don't manually tweak whitespace
- Dates are stored in UTC; UI displays in US Eastern time
