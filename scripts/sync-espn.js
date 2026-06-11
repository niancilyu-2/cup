// ABOUTME: Phase 4 sync entry point — fetch ESPN, write match scores, cascade bracket.
// ABOUTME: Run by GitHub Actions every 30 min. Flags: --dry-run --fixture <p> --date <YYYYMMDD> --verbose.

import { fetchEspnEvents } from './espn-fetch.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
export function buildIndex(matches) {
  const idx = {};
  for (const m of matches) {
    if (!m.team_a_code || !m.team_b_code) continue; // KO teams not yet resolved
    const k = pairKey(m.team_a_code, m.team_b_code);
    (idx[k] ||= []).push({ id: m.id, dateUTC: utcStamp(m.kickoff_at) });
  }
  return idx;
}

// Numeric YYYYMMDD differences jump by ~70 across month boundaries, so compare
// real calendar distance instead.
const stampToMs = (s) =>
  Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));

export function matchIdFor(idx, ev) {
  const cands = idx[pairKey(ev.teamA, ev.teamB)];
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0].id;
  // Rematch across stages: pick the candidate whose UTC date is nearest.
  const evMs = stampToMs(ev.dateUTC);
  return cands.slice().sort(
    (x, y) => Math.abs(stampToMs(x.dateUTC) - evMs) - Math.abs(stampToMs(y.dateUTC) - evMs),
  )[0].id;
}

// ESPN reports home/away; our row's a/b orientation is fixed by the seed and
// cascade, and matchIdFor matches the pair in either order — so re-orient the
// scores to the row before writing. (winner_code is a team code, already
// orientation-free.)
export function orientScores(ev, row) {
  const flipped = ev.teamA === row.team_b_code;
  return flipped
    ? { scoreA: ev.scoreB, scoreB: ev.scoreA }
    : { scoreA: ev.scoreA, scoreB: ev.scoreB };
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

  const counts = { final: 0, inProgress: 0, skipManual: 0, unchanged: 0,
                   koNoWinner: 0, unmapped: 0, noMatch: 0 };
  const scoreWrites = [];

  for (const raw of events) {
    const ev = normalizeEspnEvent(raw);
    if (!ev) { counts.unmapped++; if (args.verbose) log('UNMAPPED', raw?.date); continue; }
    if (ev.status === 'scheduled') continue;

    const id = matchIdFor(idx, ev);
    if (!id) { counts.noMatch++; if (args.verbose) log('NO MATCH', ev); continue; }

    const row = byId[id];
    if (row.result_source === 'manual') { counts.skipManual++; continue; }

    const { scoreA, scoreB } = orientScores(ev, row);

    if (ev.status === 'final') {
      // A finished knockout must name a winner (PKs decide level scores). If
      // ESPN hasn't flagged one yet, store the score but leave the row
      // incomplete so the cascade waits and a later run can finish it.
      if (row.stage !== 'group' && !ev.winnerCode) {
        counts.koNoWinner++;
        log(`WARN ${id}: final knockout event without winner flag — left incomplete`);
        if (row.score_a !== scoreA || row.score_b !== scoreB) {
          scoreWrites.push([id, { score_a: scoreA, score_b: scoreB }]);
        }
        continue;
      }
      if (row.completed && row.score_a === scoreA && row.score_b === scoreB &&
          row.winner_code === ev.winnerCode) {
        counts.unchanged++;
        continue;
      }
      counts.final++;
      scoreWrites.push([id, {
        score_a: scoreA, score_b: scoreB,
        winner_code: ev.winnerCode, completed: true, result_source: 'espn_fetch',
      }]);
      // Update local copy so the cascade in this same run sees the final result.
      Object.assign(row, {
        score_a: scoreA, score_b: scoreB,
        winner_code: ev.winnerCode, completed: true,
      });
    } else { // in_progress
      if (row.score_a === scoreA && row.score_b === scoreB && !row.completed) {
        counts.unchanged++;
        continue;
      }
      counts.inProgress++;
      scoreWrites.push([id, { score_a: scoreA, score_b: scoreB }]);
    }
  }

  // Cascade runs off completed matches only (computeGroupStandings ignores
  // non-final games; resolveSlot ignores non-completed knockout sources).
  const cascadeWrites = computeCascadeWrites(matches, standingsByGroup(matches))
    .filter((w) => byId[w.id]?.result_source !== 'manual');

  log(`events=${events.length} final=${counts.final} live=${counts.inProgress} ` +
      `unchanged=${counts.unchanged} koNoWinner=${counts.koNoWinner} ` +
      `skipManual=${counts.skipManual} noMatch=${counts.noMatch} unmapped=${counts.unmapped} ` +
      `cascade=${cascadeWrites.length}`);

  if (args.dryRun) {
    log('DRY RUN — no writes. Planned score writes:');
    scoreWrites.forEach(([id, f]) => log(' ', id, JSON.stringify(f)));
    log('Planned cascade writes:');
    cascadeWrites.forEach((w) => log(' ', w.id, JSON.stringify(w)));
    return;
  }

  for (const [id, fields] of scoreWrites) await patchMatch(id, fields, { skipManual: true });
  for (const w of cascadeWrites) {
    const fields = { team_a_code: w.team_a_code, team_b_code: w.team_b_code };
    // Losing a participant invalidates any result already on the row (this
    // only happens after an upstream result was voided): a completed match
    // with unknown teams must not keep scoring.
    const row = byId[w.id];
    if ((w.team_a_code == null || w.team_b_code == null) && row?.completed) {
      Object.assign(fields, {
        score_a: null, score_b: null, winner_code: null,
        completed: false, result_source: null,
      });
    }
    await patchMatch(w.id, fields, { skipManual: true });
  }
  log(`Wrote ${scoreWrites.length} scores + ${cascadeWrites.length} cascade updates.`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
