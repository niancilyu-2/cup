# 2026 World Cup Bracket Challenge

A pick'em bracket for ~10 friends to predict the 2026 FIFA World Cup. Live at GitHub Pages, no login, no app store.

For the readable build/change history, see [BUILD_STORY.md](BUILD_STORY.md).

## Stack

- Plain HTML/CSS/JS, no build step
- Supabase (Postgres) for picks, results, and leaderboard
- GitHub Pages for hosting
- ESPN scoreboard endpoint pulled every 30 min by a GitHub Actions cron (`scripts/sync-espn.js`) for auto-results; manual admin entry as fallback

## How it works

Four pick steps, all open from day one, all locked at first kickoff (June 11, 2026, 1:00 PM Mexico City time):

1. **Group ranks** — for each of the 12 groups, rank all 4 teams 1st–4th by dragging them into order (they start scrambled). 1st and 2nd score group-stage points; your 3rd is eligible for wildcard selection.
2. **Wildcards** — pick exactly 8 of the 12 third-place teams to advance. The R32 matchups are looked up from FIFA's official Annexe C table; you don't place teams in slots yourself.
3. **Knockout bracket** — click winners through R32 → R16 → QF → SF → Final, plus the 3rd-place match. R32 auto-populates from your group ranks + wildcards; downstream rounds auto-populate from your winners.
4. **Tiebreaker** — predict your champion's average goals per game across the whole tournament. Your champion is whoever you pick to win the Final (no separate pick).

Picks live in a **draft** until you commit them. **Save my picks** writes the draft to Supabase but stays editable. **Submit** writes the draft AND locks it until you click **Edit picks**. Both no-op when nothing has changed.

## Scoring

| Round | Points each | Picks | Subtotal |
|---|---:|---:|---:|
| Group standings (1st or 2nd of any group) | 1 | 24 | 24 |
| Wildcards (3rd-place team you flagged actually advances) | 1 | 8 | 8 |
| R32 winner | 2 | 16 | 32 |
| R16 winner | 4 | 8 | 32 |
| QF winner | 6 | 4 | 24 |
| SF winner | 8 | 2 | 16 |
| Final winner | 12 | 1 | 12 |
| **Perfect bracket** | | | **148** |

Tiebreaker: closest guess to the actual champion's real average goals per game wins, regardless of which team the player picked.

## Lock & reveal

Everything locks at the first kickoff. Until then only your own picks are visible to you. At kickoff, all picks are revealed and the leaderboard goes live.

## Local development

```bash
cd /home/PS828ET/wcbracket
cp config.example.js config.js   # fill in your Supabase credentials and admin code
python3 -m http.server 8000
# open http://localhost:8000
```

Migrations live in `migrations/`; apply them in order in the Supabase SQL editor. `schema.sql` is the authoritative current schema.

Tests:

```bash
npm test
```

## Repo layout

- `index.html` — pick page (the main app)
- `rules.html` — rules and scoring
- `leaderboard.html` — leaderboard (placeholder until first kickoff)
- `app.js` — all client logic (picks, draft/save/submit, bracket cascade, navigation guards)
- `style.css` — stadium-green palette on a vector soccer-pitch background
- `schema.sql` — current Supabase schema
- `migrations/` — incremental schema changes
- `seed.sql` — teams, groups, and the 104 matches with kickoffs and venues
- `src/wildcards-table.js` — FIFA Annexe C R32 lookup table
- `tests/` — Vitest suite
