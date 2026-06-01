# Phase 4 — Auto-fetch results via GitHub Actions cron + Node script

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan
**Tournament kickoff (lock):** 2026-06-11 13:00 -06:00

## Goal

Automatically pull match results from ESPN's undocumented World Cup scoreboard
endpoint every 30 minutes and write them into the Supabase `matches` table, so
the leaderboard, picks page, and live-scores page reflect real outcomes without
manual data entry. Manual admin entry remains as the override / fallback.

## Decisions settled with Nianci

1. **Cron host: GitHub Actions + Node script** (not Supabase Edge Function, not
   manual-only). Rationale: repo already has Node + npm + Vitest; no Deno /
   Supabase CLI toolchain to learn under a 10-day deadline; trivially testable
   locally (`node scripts/sync-espn.js`); workflow logs give obvious debugging.
   Accepted cost: service-role key lives in GitHub repo secrets; GH cron can be
   5–15 min late (fine for a 30-min poll).

2. **Script scope: raw scores + derived cascade.** The script writes match
   scores AND computes downstream state: group standings (FIFA tiebreakers),
   R32 team-code fills via the Annex C wildcard table, and KO-winner
   propagation. The DB becomes the single source of truth; the bracket page
   shows real team names instead of slot labels once group stage finishes.

3. **Admin always wins.** If a `matches` row has `result_source='manual'`, the
   script skips it entirely — never touches scores, winner, or completed flag.
   Manual entry is the correction path.

4. **Live scores written; cascade only on final.** In-progress scores are
   written (`score_a`, `score_b`) for the Live Scores tab, with
   `completed=false` and `winner_code=null`. Group-standings + KO cascade and
   the leaderboard / picks-page updates only trigger when a match is
   `completed=true` (ESPN status final).

5. **No mock fallback at launch.** `mock-results.js` is a demo prop and will be
   deleted. Every page renders straight from `matches` with an honest
   pre-tournament empty state. Removal happens AFTER the sync pipeline is proven
   (a separate small commit ~2026-06-10), so the mock survives as a visual
   debugging aid during Phase 4 development.

## §1 Architecture (data flow)

```
GitHub Actions cron (*/30 * * * *) + workflow_dispatch
   └─→ node scripts/sync-espn.js
         ├─ GET site.api.espn.com/.../fifa.world/scoreboard?dates=20260611-20260719
         ├─ Load matches table from Supabase (service-role key)
         ├─ Build lookup index keyed by (dateUTC, sorted([teamA,teamB]))
         ├─ For each ESPN event:
         │    normalize team names → 2-letter codes
         │    look up our match id
         │    if result_source='manual' → SKIP
         │    classify status → write scores (+ winner/completed if final)
         └─ runCascade():
              ├─ groups with 6 completed matches → computeGroupStandings()
              ├─ all 12 groups done → pick 3rd-place wildcards → Annex C slots
              │     → fill R32 matches' team_a_code/team_b_code
              └─ each completed KO match → fill downstream match slots
                    (W## winner feeds, L## loser feeds for 3rd-place match)
```

Browser pages read directly from `matches`. Leaderboard + picks page consider
only `completed=true` rows. Live Scores tab also shows in-progress scores.

## §2 Files

| Path | Status | Purpose |
|---|---|---|
| `scripts/sync-espn.js` | NEW | Entry point GH Actions runs. Orchestrates fetch → map → write → cascade. CLI flags: `--dry-run`, `--fixture <path>`, `--date <YYYYMMDD>`, `--verbose`. |
| `src/espn-map.js` | NEW | `ESPN_NAME_TO_CODE` table + `normalizeEspnEvent(event)` → `{date, teamA, teamB, statusKey, score, winnerCode?}`. |
| `src/standings.js` | NEW | Pure: `computeGroupStandings(groupMatches)` → `{first, second, third, fourth, table}`. FIFA tiebreakers: pts → GD → GF → H2H pts → H2H GD → H2H GF → (fair-play / draw treated as tied). Plus `pickThirdPlaceWildcards(allStandings)`. |
| `src/cascade.js` | NEW | Pure: given current match state, returns list of `{matchId, team_a_code?, team_b_code?}` writes for R32 fills + KO propagation + 3rd-place feeds. |
| `tests/standings.test.js` | NEW | Tiebreaker edge cases (2-way, 3-way ties, H2H loops, GD/GF ordering). |
| `tests/cascade.test.js` | NEW | Group completion → R32 fills; KO complete → next-round fill; 3rd-place feeds. |
| `tests/espn-map.test.js` | NEW | Parse a captured ESPN fixture (`tests/fixtures/espn-2022-wc.json`). |
| `.github/workflows/sync-results.yml` | NEW | `*/30 * * * *` schedule + `workflow_dispatch`. Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. |
| `package.json` | EDIT | Scripts `sync:once`, `sync:dry`. No new deps — use Node 22 built-in `fetch`. |
| `livescores.js`, `leaderboard.js`, `app.js` | EDIT (Phase 4b) | Remove all `window.MOCK_TOURNAMENT` reads; render from `matches`; add pre-tournament empty states; bracket ✓/✗ overlay only against real completed matches. |
| `mock-results.js` | DELETE (Phase 4b) | Removed at launch. |
| `index.html`, `leaderboard.html`, `livescores.html` | EDIT (Phase 4b) | Remove `<script src="mock-results.js">` tags. |

## §3 Sync script flow (per run)

1. Fetch ESPN scoreboard for the tournament date range (or `--fixture`).
2. Load matches table (id, stage, kickoff_at, team_a_code, team_b_code,
   result_source, completed).
3. Build lookup index:
   - `groupIdx[`${YYYYMMDD}|${sorted([a,b])}`]` (groups pre-seeded with teams).
   - `knockoutIdx[...]` includes only KO matches whose team codes are already
     filled by prior cascade runs.
4. For each ESPN event:
   - `normalizeEspnEvent(event)`.
   - Look up matchId. KO match not found → skip (cascade not yet run; next run
     picks it up). Group match not found → log warning (likely name-map miss).
   - If `result_source==='manual'` → skip.
   - By status: `SCHEDULED` → no write; `IN_PROGRESS`/`HALFTIME` → write
     `score_a/score_b` only; `FULL_TIME` → write scores + `completed=true` +
     `winner_code` + `result_source='espn_fetch'`.
5. `runCascade()`:
   - Each group with 6 completed matches → `computeGroupStandings`.
   - When all 12 done → `pickThirdPlaceWildcards` → `lookupAssignment`
     (wildcards-table.js) → UPSERT R32 `team_a_code/team_b_code`.
   - Each completed KO match `M##` → fill downstream match where
     `slot_a/slot_b === 'W##'` (winner) or `=== 'L##'` (loser, 3rd-place match).
6. Print summary (counts: fetched, final, in-progress, skipped-manual,
   skipped-KO-unresolved, groups closed).
7. Exit 0.

Properties:
- **Idempotent** — re-running with the same ESPN response is a no-op.
- **No destructive flips** — never sets `completed=true → false`; logs + skips
  if ESPN regresses a final match.

## §4 Testing plan

1. **Unit tests (Vitest)** — `standings.test.js` (most failure-prone: FIFA
   tiebreakers, ~15 cases), `cascade.test.js`, `espn-map.test.js`.
2. **Fixture-replay E2E** — capture a real ESPN scoreboard response from a past
   tournament (2022 WC knockout stretch). Run
   `node scripts/sync-espn.js --dry-run --fixture tests/fixtures/espn-2022-wc.json`
   and verify planned writes.
3. **Live dry-run against prod, carefully** — run the real sync against the prod
   Supabase project but always with `--dry-run` (fetch + compute planned writes,
   never persist). Pre-tournament ESPN returns an empty events array, so this
   mainly validates connectivity, auth, and the fetch/parse path. Only drop
   `--dry-run` once fixture-replay + unit tests pass and we've inspected the
   planned writes for a real (manually-inserted) test match.

**Team-name mapping** built in two passes: (a) seed `ESPN_NAME_TO_CODE` from the
FIFA team list cross-referenced against a captured ESPN response now
(qualifiers/friendlies, to see ESPN's exact strings); (b) any unmapped name
during real sync logs loudly and we patch it. Worst case for a miss: that match
doesn't auto-sync until the mapping is added; admin fills it manually meanwhile.

## Rollout sequence

1. **Phase 4a** — sync + standings + cascade + tests + GH Actions workflow.
   Mock data stays in place as visual fallback. Validate via fixture replay +
   live dry-run + a manually-inserted test match.
2. **Phase 4b (~2026-06-10)** — separate commit: delete `mock-results.js`,
   remove all fallback paths, add pre-tournament empty states.

## Out of scope

- Supabase Edge Function / pg_cron path (rejected in favor of GH Actions).
- Near-real-time live scores (30-min granularity is sufficient).
- Phase 5 (reveal + FIFA-style bracket visualization).
