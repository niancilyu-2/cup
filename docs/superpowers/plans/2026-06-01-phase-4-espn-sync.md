# Phase 4 — ESPN Results Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Actions cron runs a zero-dependency Node script every 30 minutes that pulls match results from ESPN's World Cup scoreboard, writes scores into the Supabase `matches` table, and — on final scores — cascades group standings and knockout progression into downstream matches.

**Architecture:** Four pure ES modules in `src/` (team-name mapping, group standings, bracket cascade, plus reuse of existing `src/wildcards.js`) are unit-tested in isolation. A thin orchestrator in `scripts/` wires them to ESPN's HTTP endpoint and Supabase's PostgREST API using Node 22's built-in `fetch` (no new dependencies). Admin-entered rows (`result_source='manual'`) are never touched. A `--dry-run` flag computes all writes without persisting.

**Tech Stack:** Node 22 (built-in `fetch`), ES modules (`"type": "module"`), Vitest, Supabase PostgREST, GitHub Actions.

---

## Background facts (verified against the codebase)

- **Match IDs:** `M1`..`M104`, **no zero padding** (`M1`, `M9`, `M10`, `M73`, `M104`).
- **Team codes:** 3-letter FIFA codes that are the `teams.code` primary key (`MEX`, `RSA`, `KOR`, `CZE`, `GER`, `CUW`, ...). These are the values written to `matches.team_a_code` / `team_b_code` / `winner_code`.
- **Stage match ranges:** group `M1`..`M72`; r32 `M73`..`M88`; r16 `M89`..`M96`; qf `M97`..`M100`; sf `M101`..`M102`; third `M103`; final `M104`.
- **Slot label formats in `matches.slot_a` / `slot_b`:**
  - Group winner/runner-up: `1A` = 1st of Group A, `2B` = 2nd of Group B. Pattern `[12][A-L]`.
  - Wildcard receiver: `3A/B/C/D/F` = the 3rd-place team of whichever eligible group is assigned here by Annex C. Pattern `3` + `/`-joined group letters. Only on `M74, M77, M79, M80, M81, M82, M85, M87`.
  - Knockout winner feed: `W74` = winner of match `M74`. Pattern `W<number>`.
  - Knockout loser feed: `L101` = loser of match `M101` (only on `M103`, the 3rd-place playoff). Pattern `L<number>`.
- **`src/wildcards.js` exports** (reuse, do not modify):
  - `lookupAssignment(pickedGroups)` — `pickedGroups` is an array of 8 group letters; returns `{ M74: 'C', M77: 'F', M79: 'H', M80: 'E', M81: 'B', M82: 'A', M85: 'G', M87: 'D' }` (matchId → group letter whose 3rd-place team fills that match), or `null` if not exactly 8.
  - `WILDCARD_SLOTS` — array of `{ matchId, eligible: [...] }`.
  - `ALL_GROUPS` — `['A'..'L']`.
- **`src/scoring.js` exports** (reuse, do not modify): `STAGE_MATCHES`, `STAGE_POINTS`, `PERFECT_TOTAL`.
- **`matches` columns:** `id, stage, group_code, kickoff_at (timestamptz), venue, slot_a, slot_b, team_a_code, team_b_code, score_a, score_b, winner_code, completed (bool), result_source ('manual'|'espn_fetch'|null), updated_at`.
- **Supabase access from Node:** PostgREST at `${SUPABASE_URL}/rest/v1/matches`. Headers: `apikey: <anon>`, `Authorization: Bearer <anon>`, `Content-Type: application/json`. The public anon key is sufficient — `matches` SELECT + UPDATE are open to anon via RLS (the same path `admin.js` uses), so no service-role key is needed.
- **ESPN endpoint:** `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD-YYYYMMDD` (same host family as `ticker.js`'s `/news`). The event/competitor JSON shape is consistent across ESPN's `site.api` sports feeds; Task 6 captures a real fixture to confirm field names before going live.

## File structure

| Path | Responsibility |
|---|---|
| `src/espn-map.js` | Map ESPN team-name strings → FIFA codes; classify ESPN match status; normalize a raw ESPN event into a flat record. Pure. |
| `src/standings.js` | Compute one group's final table with FIFA tiebreakers; rank 3rd-place teams; pick the best 8. Pure. |
| `src/cascade.js` | Given all matches' current state + completed-group standings, resolve slot labels and return the team-code writes needed for downstream matches. Pure. |
| `scripts/supabase-rest.js` | Thin PostgREST wrapper (select all matches, patch one match). Reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` from env. |
| `scripts/espn-fetch.js` | Fetch + parse the ESPN scoreboard (or load a fixture file). Returns an array of raw events. |
| `scripts/sync-espn.js` | Orchestrator + CLI. Wires fetch → normalize → write → cascade. Flags: `--dry-run`, `--fixture <path>`, `--date <YYYYMMDD>`, `--verbose`. |
| `tests/espn-map.test.js` | Unit tests for `src/espn-map.js`. |
| `tests/standings.test.js` | Unit tests for `src/standings.js` (tiebreaker edge cases). |
| `tests/cascade.test.js` | Unit tests for `src/cascade.js`. |
| `tests/fixtures/espn-sample.json` | Captured/hand-built ESPN scoreboard response for fixture-replay. |
| `.github/workflows/sync-results.yml` | 30-min cron + manual trigger; runs `scripts/sync-espn.js`. |
| `package.json` | Add `sync:once` / `sync:dry` scripts (EDIT). |

Phase 4b (separate, ships ~2026-06-10 once sync is proven) removes `mock-results.js` and all `window.MOCK_TOURNAMENT` fallbacks — tasks at the end under "Phase 4b".

---

## Task 1: ESPN team-name map + status classifier

**Files:**
- Create: `src/espn-map.js`
- Test: `tests/espn-map.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ABOUTME: Tests for ESPN name→code mapping, status classification, event normalization.
import { describe, it, expect } from 'vitest';
import { teamCodeFromEspn, classifyStatus, normalizeEspnEvent } from '../src/espn-map.js';

describe('teamCodeFromEspn', () => {
  it('maps canonical names to FIFA codes', () => {
    expect(teamCodeFromEspn('Mexico')).toBe('MEX');
    expect(teamCodeFromEspn('United States')).toBe('USA');
    expect(teamCodeFromEspn('Germany')).toBe('GER');
  });
  it('maps known ESPN aliases', () => {
    expect(teamCodeFromEspn('Korea Republic')).toBe('KOR');
    expect(teamCodeFromEspn('Czechia')).toBe('CZE');
    expect(teamCodeFromEspn('USA')).toBe('USA');
  });
  it('returns null for unknown names', () => {
    expect(teamCodeFromEspn('Atlantis')).toBe(null);
  });
});

describe('classifyStatus', () => {
  it('uses state + completed flag', () => {
    expect(classifyStatus({ state: 'pre', completed: false })).toBe('scheduled');
    expect(classifyStatus({ state: 'in', completed: false })).toBe('in_progress');
    expect(classifyStatus({ state: 'post', completed: true })).toBe('final');
  });
  it('treats post-but-not-completed (abandoned) as in_progress, not final', () => {
    expect(classifyStatus({ state: 'post', completed: false })).toBe('in_progress');
  });
});

describe('normalizeEspnEvent', () => {
  const event = {
    date: '2026-06-28T22:00Z',
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { displayName: 'Mexico' }, score: '2', winner: true },
        { homeAway: 'away', team: { displayName: 'Brazil' }, score: '1', winner: false },
      ],
      status: { type: { state: 'post', completed: true } },
    }],
  };
  it('flattens a final event', () => {
    expect(normalizeEspnEvent(event)).toEqual({
      dateUTC: '20260628',
      teamA: 'MEX', teamB: 'BRA',
      scoreA: 2, scoreB: 1,
      status: 'final',
      winnerCode: 'MEX',
    });
  });
  it('returns null winner for a draw', () => {
    const draw = structuredClone(event);
    draw.competitions[0].competitors[0].winner = false;
    draw.competitions[0].competitors[0].score = '1';
    expect(normalizeEspnEvent(draw).winnerCode).toBe(null);
  });
  it('returns null if a team name is unmappable', () => {
    const bad = structuredClone(event);
    bad.competitions[0].competitors[0].team.displayName = 'Atlantis';
    expect(normalizeEspnEvent(bad)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/espn-map.test.js`
Expected: FAIL — `Cannot find module '../src/espn-map.js'`.

- [ ] **Step 3: Write the implementation**

```js
// ABOUTME: Maps ESPN scoreboard team names + statuses onto our FIFA codes/match model.
// ABOUTME: Pure helpers — no network. The name map is hand-built; unknowns log upstream.

// Canonical names match teams.name in seed.sql; aliases cover ESPN's variants.
// One entry per accepted string → 3-letter FIFA code (teams.code primary key).
export const ESPN_NAME_TO_CODE = {
  'Mexico': 'MEX',
  'South Africa': 'RSA',
  'South Korea': 'KOR', 'Korea Republic': 'KOR',
  'Czech Republic': 'CZE', 'Czechia': 'CZE',
  'Canada': 'CAN',
  'Bosnia and Herzegovina': 'BIH', 'Bosnia & Herzegovina': 'BIH',
  'Qatar': 'QAT',
  'Switzerland': 'SUI',
  'Brazil': 'BRA',
  'Morocco': 'MAR',
  'Haiti': 'HAI',
  'Scotland': 'SCO',
  'United States': 'USA', 'USA': 'USA',
  'Paraguay': 'PAR',
  'Australia': 'AUS',
  'Turkey': 'TUR', 'Türkiye': 'TUR', 'Turkiye': 'TUR',
  'Germany': 'GER',
  'Curaçao': 'CUW', 'Curacao': 'CUW',
  'Ivory Coast': 'CIV', "Côte d'Ivoire": 'CIV', "Cote d'Ivoire": 'CIV',
  'Ecuador': 'ECU',
  'Netherlands': 'NED',
  'Japan': 'JPN',
  'Sweden': 'SWE',
  'Tunisia': 'TUN',
  'Belgium': 'BEL',
  'Egypt': 'EGY',
  'Iran': 'IRN', 'IR Iran': 'IRN',
  'New Zealand': 'NZL',
  'Spain': 'ESP',
  'Cape Verde': 'CPV', 'Cabo Verde': 'CPV',
  'Saudi Arabia': 'KSA',
  'Uruguay': 'URU',
  'France': 'FRA',
  'Senegal': 'SEN',
  'Iraq': 'IRQ',
  'Norway': 'NOR',
  'Argentina': 'ARG',
  'Algeria': 'ALG',
  'Austria': 'AUT',
  'Jordan': 'JOR',
  'Portugal': 'POR',
  'DR Congo': 'COD', 'Congo DR': 'COD', 'DR Congo (Congo-Kinshasa)': 'COD',
  'Uzbekistan': 'UZB',
  'Colombia': 'COL',
  'England': 'ENG',
  'Croatia': 'CRO',
  'Ghana': 'GHA',
  'Panama': 'PAN',
};

export function teamCodeFromEspn(name) {
  if (!name) return null;
  return ESPN_NAME_TO_CODE[name.trim()] || null;
}

export function classifyStatus(type) {
  if (!type) return 'scheduled';
  if (type.state === 'post' && type.completed === true) return 'final';
  if (type.state === 'pre') return 'scheduled';
  return 'in_progress';
}

function dateToUTCStamp(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function normalizeEspnEvent(event) {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const teamA = teamCodeFromEspn(home.team?.displayName);
  const teamB = teamCodeFromEspn(away.team?.displayName);
  if (!teamA || !teamB) return null;

  const status = classifyStatus(comp.status?.type);
  const scoreA = home.score == null || home.score === '' ? null : Number(home.score);
  const scoreB = away.score == null || away.score === '' ? null : Number(away.score);

  let winnerCode = null;
  if (status === 'final') {
    if (home.winner === true) winnerCode = teamA;
    else if (away.winner === true) winnerCode = teamB;
  }

  return {
    dateUTC: dateToUTCStamp(event.date),
    teamA, teamB, scoreA, scoreB, status, winnerCode,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/espn-map.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/espn-map.js tests/espn-map.test.js
git commit -m "feat(phase4): ESPN name map + event normalizer"
```

---

## Task 2: Group standings engine (FIFA tiebreakers)

**Files:**
- Create: `src/standings.js`
- Test: `tests/standings.test.js`

FIFA 2026 group ranking order: (1) points, (2) goal difference, (3) goals for, (4) head-to-head points among still-tied teams, (5) head-to-head GD, (6) head-to-head GF, (7) fair play, (8) drawing of lots. We implement 1–6; for 7–8 we fall back to alphabetical by code (deterministic — we do not track cards). This caveat is documented in the file header.

- [ ] **Step 1: Write the failing test**

```js
// ABOUTME: Tests for group-standings computation and best-3rd-place ranking.
import { describe, it, expect } from 'vitest';
import { computeGroupStandings, bestEightThirdGroups } from '../src/standings.js';

// Helper: build a group match row.
const m = (a, b, sa, sb) => ({
  team_a_code: a, team_b_code: b, score_a: sa, score_b: sb, completed: true,
});

describe('computeGroupStandings', () => {
  it('orders by points then goal difference then goals for', () => {
    // AAA wins all, BBB 2 wins, CCC 1 win, DDD 0.
    const matches = [
      m('AAA', 'BBB', 1, 0), m('AAA', 'CCC', 3, 0), m('AAA', 'DDD', 2, 0),
      m('BBB', 'CCC', 2, 0), m('BBB', 'DDD', 1, 0),
      m('CCC', 'DDD', 1, 0),
    ];
    const s = computeGroupStandings(matches);
    expect(s.first).toBe('AAA');
    expect(s.second).toBe('BBB');
    expect(s.third).toBe('CCC');
    expect(s.fourth).toBe('DDD');
  });

  it('breaks a points tie by goal difference', () => {
    // XXX and YYY both 2 wins / 1 loss; XXX has better GD.
    const matches = [
      m('XXX', 'YYY', 0, 1), m('XXX', 'ZZZ', 5, 0), m('XXX', 'WWW', 4, 0),
      m('YYY', 'ZZZ', 1, 0), m('YYY', 'WWW', 1, 0),
      m('ZZZ', 'WWW', 0, 0),
    ];
    const s = computeGroupStandings(matches);
    // XXX: 6pts GD +8; YYY: 9pts? recompute: YYY beat XXX, ZZZ, WWW => 9pts.
    expect(s.first).toBe('YYY');   // 9 pts
    expect(s.second).toBe('XXX');  // 6 pts, GD +8
  });

  it('breaks a full tie by head-to-head points', () => {
    // PPP and QQQ tie on pts+GD+GF overall; PPP beat QQQ head-to-head.
    const matches = [
      m('PPP', 'QQQ', 1, 0), m('PPP', 'RRR', 0, 2), m('PPP', 'SSS', 3, 0),
      m('QQQ', 'RRR', 2, 0), m('QQQ', 'SSS', 1, 3),
      m('RRR', 'SSS', 1, 1),
    ];
    const s = computeGroupStandings(matches);
    const idxP = s.table.findIndex((t) => t.code === 'PPP');
    const idxQ = s.table.findIndex((t) => t.code === 'QQQ');
    expect(idxP).toBeLessThan(idxQ); // head-to-head winner ranks higher
  });

  it('returns null places when the group is incomplete', () => {
    const matches = [m('AAA', 'BBB', 1, 0)]; // only 1 of 6 played
    const s = computeGroupStandings(matches);
    expect(s.complete).toBe(false);
    expect(s.first).toBe(null);
  });
});

describe('bestEightThirdGroups', () => {
  it('returns 8 group letters sorted alphabetically', () => {
    // Build 12 trivial complete groups; vary 3rd-place strength by group.
    const byGroup = {};
    const letters = 'ABCDEFGHIJKL'.split('');
    letters.forEach((g, i) => {
      // 3rd-place team gets `i` goals-for to create a strict ranking.
      byGroup[g] = {
        complete: true,
        third: `${g}3`,
        thirdStats: { pts: 3, gd: 0, gf: i },
      };
    });
    const best = bestEightThirdGroups(byGroup);
    expect(best).toHaveLength(8);
    // Highest gf are groups E..L (i=4..11); sorted alpha.
    expect(best).toEqual(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/standings.test.js`
Expected: FAIL — `Cannot find module '../src/standings.js'`.

- [ ] **Step 3: Write the implementation**

```js
// ABOUTME: Computes a group's final table (FIFA tiebreakers 1-6) and ranks 3rd-place teams.
// ABOUTME: Tiebreakers 7-8 (fair play, drawing of lots) fall back to alphabetical by code.

function emptyRow(code) {
  return { code, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}

function tallyOverall(matches) {
  const rows = {};
  const ensure = (c) => (rows[c] ||= emptyRow(c));
  for (const x of matches) {
    if (!x.completed || x.score_a == null || x.score_b == null) continue;
    const a = ensure(x.team_a_code), b = ensure(x.team_b_code);
    a.played++; b.played++;
    a.gf += x.score_a; a.ga += x.score_b;
    b.gf += x.score_b; b.ga += x.score_a;
    if (x.score_a > x.score_b) { a.won++; b.lost++; a.pts += 3; }
    else if (x.score_a < x.score_b) { b.won++; a.lost++; b.pts += 3; }
    else { a.drawn++; b.drawn++; a.pts += 1; b.pts += 1; }
  }
  for (const r of Object.values(rows)) r.gd = r.gf - r.ga;
  return rows;
}

// Head-to-head mini-table among a set of tied team codes.
function headToHead(matches, codes) {
  const set = new Set(codes);
  const rows = {};
  codes.forEach((c) => (rows[c] = emptyRow(c)));
  for (const x of matches) {
    if (!x.completed || x.score_a == null || x.score_b == null) continue;
    if (!set.has(x.team_a_code) || !set.has(x.team_b_code)) continue;
    const a = rows[x.team_a_code], b = rows[x.team_b_code];
    a.gf += x.score_a; a.ga += x.score_b;
    b.gf += x.score_b; b.ga += x.score_a;
    if (x.score_a > x.score_b) a.pts += 3;
    else if (x.score_a < x.score_b) b.pts += 3;
    else { a.pts += 1; b.pts += 1; }
  }
  for (const r of Object.values(rows)) r.gd = r.gf - r.ga;
  return rows;
}

function compareOverall(a, b) {
  if (b.pts !== a.pts) return b.pts - a.pts;
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return 0; // still tied → caller applies head-to-head
}

function sortGroup(rows, matches) {
  const all = Object.values(rows);
  all.sort(compareOverall);
  // Resolve clusters that are equal on pts/gd/gf via head-to-head, then alpha.
  const out = [];
  let i = 0;
  while (i < all.length) {
    let j = i + 1;
    while (j < all.length && compareOverall(all[i], all[j]) === 0) j++;
    const cluster = all.slice(i, j);
    if (cluster.length === 1) {
      out.push(cluster[0]);
    } else {
      const h2h = headToHead(matches, cluster.map((r) => r.code));
      cluster.sort((x, y) => {
        const hx = h2h[x.code], hy = h2h[y.code];
        if (hy.pts !== hx.pts) return hy.pts - hx.pts;
        if (hy.gd !== hx.gd) return hy.gd - hx.gd;
        if (hy.gf !== hx.gf) return hy.gf - hx.gf;
        return x.code < y.code ? -1 : 1; // tiebreaker 7-8 fallback: alphabetical
      });
      out.push(...cluster);
    }
    i = j;
  }
  return out;
}

export function computeGroupStandings(matches) {
  const completed = matches.filter(
    (x) => x.completed && x.score_a != null && x.score_b != null,
  );
  const complete = completed.length === 6;
  const rows = tallyOverall(matches);
  const table = sortGroup(rows, matches);
  return {
    complete,
    table,
    first:  complete ? table[0]?.code ?? null : null,
    second: complete ? table[1]?.code ?? null : null,
    third:  complete ? table[2]?.code ?? null : null,
    fourth: complete ? table[3]?.code ?? null : null,
    thirdStats: complete && table[2]
      ? { pts: table[2].pts, gd: table[2].gd, gf: table[2].gf }
      : null,
  };
}

// Rank the 3rd-place teams across all 12 complete groups; return the 8 best
// group letters, sorted alphabetically (so the result feeds lookupAssignment).
export function bestEightThirdGroups(standingsByGroup) {
  const entries = Object.entries(standingsByGroup)
    .filter(([, s]) => s.complete && s.thirdStats)
    .map(([g, s]) => ({ g, ...s.thirdStats }));
  entries.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.g < b.g ? -1 : 1; // fair play / lots fallback: alphabetical
  });
  return entries.slice(0, 8).map((e) => e.g).sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/standings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standings.js tests/standings.test.js
git commit -m "feat(phase4): group standings engine with FIFA tiebreakers"
```

---

## Task 3: Bracket cascade engine

**Files:**
- Create: `src/cascade.js`
- Test: `tests/cascade.test.js`

`computeCascadeWrites(matches, standingsByGroup)` returns an array of `{ id, team_a_code, team_b_code }` for matches whose slots can now be resolved and whose current team codes differ. It resolves four slot kinds: `1A`/`2B` (group), `3X/Y/...` (wildcard via `bestEightThirdGroups` + `lookupAssignment`), `W##` (winner), `L##` (loser).

- [ ] **Step 1: Write the failing test**

```js
// ABOUTME: Tests for resolving slot labels into concrete team-code writes.
import { describe, it, expect } from 'vitest';
import { computeCascadeWrites } from '../src/cascade.js';

const match = (id, stage, slot_a, slot_b, extra = {}) => ({
  id, stage, slot_a, slot_b,
  team_a_code: null, team_b_code: null,
  score_a: null, score_b: null, winner_code: null, completed: false,
  ...extra,
});

describe('computeCascadeWrites', () => {
  it('fills a group-slot R32 match when both groups are complete', () => {
    const matches = [match('M73', 'r32', '2A', '2B')];
    const standings = {
      A: { complete: true, first: 'MEX', second: 'KOR', third: 'RSA' },
      B: { complete: true, first: 'CAN', second: 'SUI', third: 'QAT' },
    };
    const writes = computeCascadeWrites(matches, standings);
    expect(writes).toContainEqual({ id: 'M73', team_a_code: 'KOR', team_b_code: 'SUI' });
  });

  it('does not fill when a referenced group is incomplete', () => {
    const matches = [match('M73', 'r32', '2A', '2B')];
    const standings = { A: { complete: false }, B: { complete: true, second: 'SUI' } };
    expect(computeCascadeWrites(matches, standings)).toEqual([]);
  });

  it('fills a wildcard slot using Annex C once all 12 groups are complete', () => {
    // 8 best thirds = groups A..H; lookupAssignment('ABCDEFGH') puts group A's
    // 3rd into M82 and group C's 3rd into M74 (see wildcards-table.js).
    const matches = [match('M74', 'r32', '1E', '3A/B/C/D/F')];
    const standings = {};
    'ABCDEFGHIJKL'.split('').forEach((g) => {
      standings[g] = {
        complete: true, first: `${g}1`, second: `${g}2`, third: `${g}3`,
        thirdStats: { pts: g <= 'H' ? 6 : 1, gd: 0, gf: 0 }, // A..H advance
      };
    });
    standings.E.first = 'GER';
    const writes = computeCascadeWrites(matches, standings);
    const m74 = writes.find((w) => w.id === 'M74');
    expect(m74.team_a_code).toBe('GER');      // 1E
    expect(m74.team_b_code).toBe('C3');       // group C 3rd, per Annex C 'ABCDEFGH'
  });

  it('propagates a knockout winner into the next match', () => {
    const matches = [
      match('M73', 'r32', '2A', '2B', {
        team_a_code: 'KOR', team_b_code: 'SUI',
        score_a: 2, score_b: 1, winner_code: 'KOR', completed: true,
      }),
      match('M90', 'r16', 'W73', 'W75'),
    ];
    const writes = computeCascadeWrites(matches, {});
    const m90 = writes.find((w) => w.id === 'M90');
    expect(m90.team_a_code).toBe('KOR');
    expect(m90.team_b_code).toBe(null); // W75 not yet decided
  });

  it('feeds the 3rd-place match from semifinal losers', () => {
    const matches = [
      match('M101', 'sf', 'W97', 'W98', {
        team_a_code: 'BRA', team_b_code: 'FRA',
        score_a: 1, score_b: 2, winner_code: 'FRA', completed: true,
      }),
      match('M103', 'third', 'L101', 'L102'),
    ];
    const writes = computeCascadeWrites(matches, {});
    const m103 = writes.find((w) => w.id === 'M103');
    expect(m103.team_a_code).toBe('BRA'); // loser of M101
  });

  it('emits no write when the resolved teams already match the row', () => {
    const matches = [match('M73', 'r32', '2A', '2B', {
      team_a_code: 'KOR', team_b_code: 'SUI',
    })];
    const standings = {
      A: { complete: true, second: 'KOR' }, B: { complete: true, second: 'SUI' },
    };
    expect(computeCascadeWrites(matches, standings)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cascade.test.js`
Expected: FAIL — `Cannot find module '../src/cascade.js'`.

- [ ] **Step 3: Write the implementation**

```js
// ABOUTME: Resolves R32/knockout slot labels into concrete team-code writes.
// ABOUTME: Pure — takes current match state + group standings, returns minimal diffs.

import { bestEightThirdGroups } from './standings.js';
import { lookupAssignment } from './wildcards.js';

const GROUP_SLOT = /^([12])([A-L])$/;
const WILDCARD_SLOT = /^3[A-L](?:\/[A-L])*$/;
const WINNER_SLOT = /^W(\d+)$/;
const LOSER_SLOT = /^L(\d+)$/;

function loserCode(match) {
  if (!match.completed || !match.winner_code) return null;
  if (match.team_a_code === match.winner_code) return match.team_b_code || null;
  if (match.team_b_code === match.winner_code) return match.team_a_code || null;
  return null;
}

function resolveSlot(slot, ctx) {
  let g = GROUP_SLOT.exec(slot);
  if (g) {
    const [, rank, group] = g;
    const s = ctx.standingsByGroup[group];
    if (!s || !s.complete) return null;
    return (rank === '1' ? s.first : s.second) || null;
  }
  if (WILDCARD_SLOT.test(slot)) {
    const group = ctx.wildcardAssignment?.[ctx.currentMatchId];
    if (!group) return null;
    const s = ctx.standingsByGroup[group];
    return (s && s.complete && s.third) || null;
  }
  let w = WINNER_SLOT.exec(slot);
  if (w) {
    const src = ctx.byId[`M${w[1]}`];
    return (src && src.completed && src.winner_code) || null;
  }
  let l = LOSER_SLOT.exec(slot);
  if (l) {
    const src = ctx.byId[`M${l[1]}`];
    return src ? loserCode(src) : null;
  }
  return null;
}

export function computeCascadeWrites(matches, standingsByGroup) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));

  // Wildcard assignment is available only once all 12 groups are complete.
  let wildcardAssignment = null;
  const allComplete = 'ABCDEFGHIJKL'.split('')
    .every((g) => standingsByGroup[g] && standingsByGroup[g].complete);
  if (allComplete) {
    const best = bestEightThirdGroups(standingsByGroup);
    wildcardAssignment = lookupAssignment(best);
  }

  const writes = [];
  for (const m of matches) {
    if (m.stage === 'group') continue;
    const ctx = { standingsByGroup, byId, wildcardAssignment, currentMatchId: m.id };
    const a = resolveSlot(m.slot_a, ctx);
    const b = resolveSlot(m.slot_b, ctx);
    if (a == null && b == null) continue;
    const nextA = a ?? m.team_a_code ?? null;
    const nextB = b ?? m.team_b_code ?? null;
    if (nextA === (m.team_a_code ?? null) && nextB === (m.team_b_code ?? null)) continue;
    writes.push({ id: m.id, team_a_code: nextA, team_b_code: nextB });
  }
  return writes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cascade.test.js`
Expected: PASS. (If the Annex C assertion for `M74`/`M82` differs, open `src/wildcards-table.js`, read `ANNEXE_C['ABCDEFGH']`, and correct the expected value in the test — the table is the source of truth.)

- [ ] **Step 5: Commit**

```bash
git add src/cascade.js tests/cascade.test.js
git commit -m "feat(phase4): bracket cascade slot resolver"
```

---

## Task 4: Supabase PostgREST client

**Files:**
- Create: `scripts/supabase-rest.js`

No unit test — it is a thin network wrapper exercised by the dry-run in Task 7. Keep it tiny.

- [ ] **Step 1: Write the implementation**

```js
// ABOUTME: Minimal Supabase PostgREST client for the sync script (Node, zero deps).
// ABOUTME: Uses the public anon key; matches SELECT + UPDATE are open to anon via RLS.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

function headers() {
  if (!URL || !KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  }
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function selectMatches() {
  const url = `${URL}/rest/v1/matches?select=id,stage,group_code,kickoff_at,slot_a,slot_b,team_a_code,team_b_code,score_a,score_b,winner_code,completed,result_source&order=kickoff_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`selectMatches failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function patchMatch(id, fields) {
  const url = `${URL}/rest/v1/matches?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`patchMatch ${id} failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 2: Sanity-check it imports**

Run: `node -e "import('./scripts/supabase-rest.js').then(()=>console.log('ok'))"`
Expected: prints `ok` (no network call made on import).

- [ ] **Step 3: Commit**

```bash
git add scripts/supabase-rest.js
git commit -m "feat(phase4): minimal Supabase PostgREST client"
```

---

## Task 5: ESPN fetch wrapper

**Files:**
- Create: `scripts/espn-fetch.js`

- [ ] **Step 1: Write the implementation**

```js
// ABOUTME: Fetches the ESPN World Cup scoreboard, or loads a fixture file for testing.
// ABOUTME: Returns the raw events array; parsing/normalization happens in espn-map.js.

import { readFile } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// Whole-tournament date range; ESPN accepts YYYYMMDD-YYYYMMDD.
const DEFAULT_RANGE = '20260611-20260719';

export async function fetchEspnEvents({ fixture, dates } = {}) {
  let json;
  if (fixture) {
    json = JSON.parse(await readFile(fixture, 'utf8'));
  } else {
    const range = dates || DEFAULT_RANGE;
    const res = await fetch(`${BASE}?dates=${range}`);
    if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status}`);
    json = await res.json();
  }
  return json.events || [];
}
```

- [ ] **Step 2: Sanity-check fixture path branch with a stub**

Run: `node -e "import('./scripts/espn-fetch.js').then(m=>m.fetchEspnEvents({fixture:'/dev/null'}).catch(e=>console.log('expected-json-error')))"`
Expected: prints `expected-json-error` (empty file isn't valid JSON — proves the fixture branch is wired and network is not hit).

- [ ] **Step 3: Commit**

```bash
git add scripts/espn-fetch.js
git commit -m "feat(phase4): ESPN scoreboard fetch wrapper"
```

---

## Task 6: Capture an ESPN fixture + reconcile field names

**Files:**
- Create: `tests/fixtures/espn-sample.json`

This task validates that the real ESPN payload matches the field names assumed in `src/espn-map.js` (`competitions[0].competitors[].homeAway/team.displayName/score/winner`, `status.type.state/completed`). ESPN's `fifa.world` feed has no live matches until 2026-06-11, so capture from a feed that does have data, then confirm the shape.

- [ ] **Step 1: Capture a real payload with finished matches**

Run (any past date with completed soccer matches, e.g. a league fixture day):
```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260516" -o /tmp/espn-raw.json
node -e "const j=require('/tmp/espn-raw.json'); const c=j.events[0].competitions[0]; console.log(JSON.stringify({date:j.events[0].date, status:c.status.type, comp:c.competitors.map(x=>({homeAway:x.homeAway, name:x.team.displayName, score:x.score, winner:x.winner}))}, null, 2));"
```
Expected: prints an object showing `status.type.state` ∈ `{pre,in,post}`, `status.type.completed` boolean, and competitors with `homeAway`, `name`, `score`, `winner`.

- [ ] **Step 2: Reconcile**

If any field path differs from what `src/espn-map.js` reads (Task 1, Step 3), update `normalizeEspnEvent` + `classifyStatus` and re-run `npx vitest run tests/espn-map.test.js`. If the paths match, no code change.

- [ ] **Step 3: Build a WC-shaped fixture**

Save a trimmed 2-event fixture (one `final`, one `in_progress`) using **WC team names** so the name map is exercised end-to-end. Write to `tests/fixtures/espn-sample.json`:

```json
{
  "events": [
    {
      "date": "2026-06-11T19:00Z",
      "competitions": [{
        "status": { "type": { "state": "post", "completed": true } },
        "competitors": [
          { "homeAway": "home", "team": { "displayName": "Mexico" }, "score": "2", "winner": true },
          { "homeAway": "away", "team": { "displayName": "South Africa" }, "score": "1", "winner": false }
        ]
      }]
    },
    {
      "date": "2026-06-11T22:00Z",
      "competitions": [{
        "status": { "type": { "state": "in", "completed": false } },
        "competitors": [
          { "homeAway": "home", "team": { "displayName": "Germany" }, "score": "0", "winner": false },
          { "homeAway": "away", "team": { "displayName": "Curaçao" }, "score": "0", "winner": false }
        ]
      }]
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/espn-sample.json src/espn-map.js
git commit -m "test(phase4): capture ESPN fixture + reconcile field paths"
```

---

## Task 7: Sync orchestrator + CLI

**Files:**
- Create: `scripts/sync-espn.js`
- Modify: `package.json` (add scripts)

- [ ] **Step 1: Write the orchestrator**

```js
// ABOUTME: Phase 4 sync entry point — fetch ESPN, write match scores, cascade bracket.
// ABOUTME: Run by GitHub Actions every 30 min. Flags: --dry-run --fixture <p> --date <YYYYMMDD> --verbose.

import { fetchEspnEvents } from './espn-fetch.js';
import { normalizeEspnEvent } from '../src/espn-map.js';
import { computeGroupStandings } from '../src/standings.js';
import { computeCascadeWrites } from '../src/cascade.js';
import { selectMatches, patchMatch } from './supabase-rest.js';

function parseArgs(argv) {
  const out = { dryRun: false, fixture: null, dates: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--date') out.dates = argv[++i];
  }
  return out;
}

const pad2 = (n) => String(n).padStart(2, '0');
function utcStamp(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}
const pairKey = (a, b) => [a, b].sort().join('|');

// Build pair → [{id, dateUTC}] so we can disambiguate knockout rematches by date.
function buildIndex(matches) {
  const idx = {};
  for (const m of matches) {
    if (!m.team_a_code || !m.team_b_code) continue; // KO teams not yet resolved
    const k = pairKey(m.team_a_code, m.team_b_code);
    (idx[k] ||= []).push({ id: m.id, dateUTC: utcStamp(m.kickoff_at) });
  }
  return idx;
}

function matchIdFor(idx, ev) {
  const cands = idx[pairKey(ev.teamA, ev.teamB)];
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0].id;
  // Rematch across stages: pick the candidate whose UTC date is nearest.
  const evNum = Number(ev.dateUTC);
  return cands.slice().sort(
    (x, y) => Math.abs(Number(x.dateUTC) - evNum) - Math.abs(Number(y.dateUTC) - evNum),
  )[0].id;
}

function standingsByGroup(matches) {
  const byGroup = {};
  for (const m of matches) {
    if (m.stage === 'group' && m.group_code) (byGroup[m.group_code] ||= []).push(m);
  }
  const out = {};
  for (const [g, ms] of Object.entries(byGroup)) out[g] = computeGroupStandings(ms);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const log = (...a) => console.log(...a);

  const matches = await selectMatches();
  const idx = buildIndex(matches);
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  const events = await fetchEspnEvents({ fixture: args.fixture, dates: args.dates });

  const counts = { final: 0, inProgress: 0, skipManual: 0, unmapped: 0, noMatch: 0 };
  const scoreWrites = [];

  for (const raw of events) {
    const ev = normalizeEspnEvent(raw);
    if (!ev) { counts.unmapped++; if (args.verbose) log('UNMAPPED', raw?.date); continue; }
    if (ev.status === 'scheduled') continue;

    const id = matchIdFor(idx, ev);
    if (!id) { counts.noMatch++; if (args.verbose) log('NO MATCH', ev); continue; }

    const row = byId[id];
    if (row.result_source === 'manual') { counts.skipManual++; continue; }

    if (ev.status === 'final') {
      counts.final++;
      scoreWrites.push([id, {
        score_a: ev.scoreA, score_b: ev.scoreB,
        winner_code: ev.winnerCode, completed: true, result_source: 'espn_fetch',
      }]);
      // Update local copy so the cascade in this same run sees the final result.
      Object.assign(row, {
        score_a: ev.scoreA, score_b: ev.scoreB,
        winner_code: ev.winnerCode, completed: true,
      });
    } else { // in_progress
      counts.inProgress++;
      scoreWrites.push([id, { score_a: ev.scoreA, score_b: ev.scoreB }]);
    }
  }

  // Cascade runs off completed matches only (computeGroupStandings ignores
  // non-final games; resolveSlot ignores non-completed knockout sources).
  const cascadeWrites = computeCascadeWrites(matches, standingsByGroup(matches))
    .filter((w) => byId[w.id]?.result_source !== 'manual');

  log(`events=${events.length} final=${counts.final} live=${counts.inProgress} ` +
      `skipManual=${counts.skipManual} noMatch=${counts.noMatch} unmapped=${counts.unmapped} ` +
      `cascade=${cascadeWrites.length}`);

  if (args.dryRun) {
    log('DRY RUN — no writes. Planned score writes:');
    scoreWrites.forEach(([id, f]) => log(' ', id, JSON.stringify(f)));
    log('Planned cascade writes:');
    cascadeWrites.forEach((w) => log(' ', w.id, JSON.stringify(w)));
    return;
  }

  for (const [id, fields] of scoreWrites) await patchMatch(id, fields);
  for (const w of cascadeWrites) {
    await patchMatch(w.id, { team_a_code: w.team_a_code, team_b_code: w.team_b_code });
  }
  log(`Wrote ${scoreWrites.length} scores + ${cascadeWrites.length} cascade updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

Modify `package.json` `"scripts"` block to:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "serve": "python3 -m http.server 8001",
    "sync:once": "node scripts/sync-espn.js",
    "sync:dry": "node scripts/sync-espn.js --dry-run --verbose"
  },
```

- [ ] **Step 3: Dry-run against the fixture (no Supabase env needed will fail at selectMatches — so test the pure path with env stubbed empty)**

Run:
```bash
SUPABASE_URL=x SUPABASE_ANON_KEY=x node scripts/sync-espn.js --dry-run --verbose --fixture tests/fixtures/espn-sample.json 2>&1 | head -20
```
Expected: it reaches `selectMatches()` and errors with a 4xx/connection error (because `SUPABASE_URL=x` is invalid). This proves arg parsing + module wiring. To exercise the full pure pipeline without Supabase, do Step 4.

- [ ] **Step 4: Full dry-run against prod (read-only)**

Prerequisite: a local export of the real prod `SUPABASE_URL` and the **public anon key** (from `config.js`, or Supabase dashboard → Project Settings → API).

Run:
```bash
export SUPABASE_URL="https://<prod>.supabase.co"
export SUPABASE_ANON_KEY="<public-anon-key>"
npm run sync:dry -- --fixture tests/fixtures/espn-sample.json
```
Expected: connects to prod, reads matches, prints planned writes for the 2 fixture events (M1 final MEX 2-1 RSA → completed; the GER vs CUW live event → score-only). NO rows are modified (dry run). Inspect the planned writes for correctness.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-espn.js package.json
git commit -m "feat(phase4): sync orchestrator + CLI with dry-run"
```

---

## Task 8: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/sync-results.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# ABOUTME: Polls ESPN every 30 min during the tournament and syncs results to Supabase.
# ABOUTME: Manual runs via workflow_dispatch (optionally with --dry-run by editing the step).
name: Sync results

# Dormant until kickoff: only fires during the tournament window (UTC dates).
on:
  schedule:
    - cron: '*/30 * 11-30 6 *'
    - cron: '*/30 * 1-19 7 *'
  workflow_dispatch:

# Avoid overlapping runs if one is slow.
concurrency:
  group: sync-results
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Run sync
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: node scripts/sync-espn.js
```

- [ ] **Step 2: Document the required secrets**

The repo needs two GitHub Actions secrets (Settings → Secrets and variables → Actions):
- `SUPABASE_URL` — `https://<prod>.supabase.co`
- `SUPABASE_ANON_KEY` — the public anon key (matches SELECT + UPDATE are open to anon via RLS, so no service-role key is needed)

Add these manually in the GitHub UI; they are never committed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync-results.yml
git commit -m "feat(phase4): GitHub Actions cron for results sync"
```

- [ ] **Step 4: First live validation (manual)**

After secrets are set and the branch is on the default branch, trigger the workflow once via the Actions tab (`workflow_dispatch`). Pre-tournament, ESPN returns no WC events, so the run should log `events=0 ... cascade=0` and exit 0. Confirm no rows changed in Supabase.

---

## Task 9: Full regression

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all prior tests + the 3 new test files pass (green). Note the new total count.

- [ ] **Step 2: Commit (only if any test needed adjusting)**

```bash
git add -A
git commit -m "test(phase4): full suite green"
```

---

# Phase 4b — Remove mock fallback (ships ~2026-06-10, AFTER sync is proven)

Do NOT start these until Task 1–9 are done and a live dry-run against prod looks correct. These tasks make the site show real data only.

## Task 10: Strip MOCK_TOURNAMENT from the browser

**Files:**
- Modify: `leaderboard.js`, `livescores.js`, `app.js`
- Modify: `index.html`, `leaderboard.html`, `livescores.html`
- Delete: `mock-results.js`

- [ ] **Step 1: Find every reference**

Run: `grep -rn "MOCK_TOURNAMENT\|mock-results" --include="*.js" --include="*.html" . | grep -v node_modules`
Expected: a list across `app.js`, `leaderboard.js`, `livescores.js` and the 3 HTML files.

- [ ] **Step 2: Replace each consumer with the real-data path + empty state**

For each `.js` file, remove the `window.MOCK_TOURNAMENT` read and the fallback branch, leaving only the Supabase `matches`-derived path. Where a page previously fell back to mock when no match was completed, render an empty-state message instead. Exact copy:
- Leaderboard (no completed matches yet): `"The leaderboard goes live when the first match kicks off on June 11."`
- Live scores (no scores yet): `"Matches start June 11. Check back for live scores."`
- Picks page bracket overlay: simply skip ✓/✗ rendering when there are no completed matches (no message needed).

(Implement per file by reading the current fallback branch and deleting the mock side. The data shape from `matches` already feeds these views; this is deletion + an empty-state string, not new logic.)

- [ ] **Step 3: Remove the script tags**

In `index.html`, `leaderboard.html`, `livescores.html`, delete the line `<script src="mock-results.js"></script>`.

- [ ] **Step 4: Delete the file**

```bash
git rm mock-results.js
```

- [ ] **Step 5: Verify nothing references it**

Run: `grep -rn "MOCK_TOURNAMENT\|mock-results" --include="*.js" --include="*.html" . | grep -v node_modules`
Expected: no output.

- [ ] **Step 6: Manual smoke test (Cloudflare tunnel)**

Load each page through the tunnel pre-tournament. Expect: leaderboard + live scores show their empty-state copy; picks page renders normally with no ✓/✗ overlay; no console errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(phase4b): remove mock data, render real results only"
```

---

## Self-review notes

- **Spec coverage:** §1 (architecture) → Tasks 5,7,8. §2 (files) → all tasks map 1:1 to the file table. §3 (sync flow) → Task 7. §4 (testing) → Tasks 1–3 (unit), 6 (fixture), 7 Step 4 (live dry-run vs prod). Decisions: GH Actions (Task 8); scores+cascade (Tasks 2,3,7); admin-wins (Task 7 `skipManual` + cascade filter); live-scores-written/cascade-on-final-only (Task 7 branches); no-mock-fallback (Tasks 10). All covered.
- **Open risk flagged in-plan:** ESPN field paths are assumed from the standard `site.api` shape and reconciled against a real capture in Task 6 before go-live.
- **Type consistency:** `computeGroupStandings` returns `{complete, table, first, second, third, fourth, thirdStats}` — consumed with those exact names in `cascade.js` and `sync-espn.js`. `bestEightThirdGroups` returns sorted group letters → fed to `lookupAssignment` (expects 8-length array) → returns `{matchId: groupLetter}` consumed in `resolveSlot`. `computeCascadeWrites` returns `{id, team_a_code, team_b_code}` consumed in `sync-espn.js`. Consistent.
