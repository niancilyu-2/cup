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

## Pick model

- Per group: predict 1st and 2nd (24 teams advance directly)
- R32 draft: user fills R32 slots with any of the 48 teams (implicitly picks the 8 wildcard thirds)
- Bracket: click a team in each match to advance them through R16 → QF → SF → Final
- Exact-score predictions are optional per match and earn bonus points
- Tiebreaker: predicted total goals scored by the champion

## Lock & visibility

- Picks freeze at the first kickoff (`LOCK_DATE_ISO` in `app.js`)
- Other users' picks are hidden until lock; revealed at first kickoff

## Scoring (final)

- Group standings: 1 point per correctly placed team (1st or 2nd slot of any group)
- R32 winner: 2 / R16: 4 / QF: 8 / SF: 16 / Final: 24
- Exact-score bonus: +3 per knockout match (R32+) where the predicted score matches the actual. **Does NOT apply to group-stage matches.**
- Tiebreaker: closest guess to the actual champion's total tournament goals (a single integer per player). Compared against reality regardless of which team the player picked to win.

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
