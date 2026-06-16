// ABOUTME: Supabase Edge Function — polls ESPN and syncs match scores + bracket cascade.
// ABOUTME: Deno port of scripts/sync-espn.js, driven by pg_cron so cadence isn't throttled like GitHub's scheduler.

// Business logic is imported from the repo's src/ modules so there is a single
// source of truth shared with the Node sync script and the vitest suite. These
// modules are pure ESM with no Node built-ins, so they run unchanged on Deno.
import { normalizeEspnEvent } from '../../../src/espn-map.js';
import { computeGroupStandings } from '../../../src/standings.js';
import { computeCascadeWrites } from '../../../src/cascade.js';

// --- ESPN fetch (network-only port of scripts/espn-fetch.js) ---------------
const ESPN_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_RANGE = '20260611-20260719'; // whole-tournament window
const ESPN_LIMIT = 200; // ESPN truncates range queries to 100 without this

async function fetchEspnEvents() {
  const res = await fetch(`${ESPN_BASE}?dates=${ESPN_RANGE}&limit=${ESPN_LIMIT}`);
  if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status}`);
  const json = await res.json();
  return json.events || [];
}

// --- Supabase REST (Deno port of scripts/supabase-rest.js) -----------------
// SUPABASE_URL / SUPABASE_ANON_KEY are auto-injected into Edge Functions.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY');

function sbHeaders() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  }
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function selectMatches() {
  const url =
    `${SUPABASE_URL}/rest/v1/matches?select=id,stage,group_code,kickoff_at,slot_a,slot_b,` +
    `team_a_code,team_b_code,score_a,score_b,winner_code,completed,result_source&order=kickoff_at`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`selectMatches failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchMatch(id, fields, { skipManual = false } = {}) {
  // skipManual guards server-side against racing an admin manual entry made
  // between our SELECT and this PATCH (neq alone would also exclude NULLs).
  const guard = skipManual ? '&or=(result_source.is.null,result_source.neq.manual)' : '';
  const url = `${SUPABASE_URL}/rest/v1/matches?id=eq.${encodeURIComponent(id)}${guard}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`patchMatch ${id} failed: ${res.status} ${await res.text()}`);
}

// --- Sync glue (ported verbatim from scripts/sync-espn.js) -----------------
const pad2 = (n) => String(n).padStart(2, '0');
function utcStamp(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}
const pairKey = (a, b) => [a, b].sort().join('|');

function buildIndex(matches) {
  const idx = {};
  for (const m of matches) {
    if (!m.team_a_code || !m.team_b_code) continue; // KO teams not yet resolved
    const k = pairKey(m.team_a_code, m.team_b_code);
    (idx[k] ||= []).push({ id: m.id, dateUTC: utcStamp(m.kickoff_at) });
  }
  return idx;
}

const stampToMs = (s) =>
  Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));

function matchIdFor(idx, ev) {
  const cands = idx[pairKey(ev.teamA, ev.teamB)];
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0].id;
  const evMs = stampToMs(ev.dateUTC);
  return cands.slice().sort(
    (x, y) => Math.abs(stampToMs(x.dateUTC) - evMs) - Math.abs(stampToMs(y.dateUTC) - evMs),
  )[0].id;
}

function orientScores(ev, row) {
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

async function runSync() {
  const matches = await selectMatches();
  const idx = buildIndex(matches);
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  const events = await fetchEspnEvents();

  const counts = { final: 0, inProgress: 0, skipManual: 0, unchanged: 0,
                   koNoWinner: 0, unmapped: 0, noMatch: 0 };
  const scoreWrites = [];

  for (const raw of events) {
    const ev = normalizeEspnEvent(raw);
    if (!ev) { counts.unmapped++; continue; }
    if (ev.status === 'scheduled') continue;

    const id = matchIdFor(idx, ev);
    if (!id) { counts.noMatch++; continue; }

    const row = byId[id];
    if (row.result_source === 'manual') { counts.skipManual++; continue; }

    const { scoreA, scoreB } = orientScores(ev, row);

    if (ev.status === 'final') {
      if (row.stage !== 'group' && !ev.winnerCode) {
        counts.koNoWinner++;
        console.log(`WARN ${id}: final knockout event without winner flag — left incomplete`);
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

  const cascadeWrites = computeCascadeWrites(matches, standingsByGroup(matches))
    .filter((w) => byId[w.id]?.result_source !== 'manual');

  console.log(
    `events=${events.length} final=${counts.final} live=${counts.inProgress} ` +
    `unchanged=${counts.unchanged} koNoWinner=${counts.koNoWinner} ` +
    `skipManual=${counts.skipManual} noMatch=${counts.noMatch} unmapped=${counts.unmapped} ` +
    `cascade=${cascadeWrites.length}`,
  );

  for (const [id, fields] of scoreWrites) await patchMatch(id, fields, { skipManual: true });
  for (const w of cascadeWrites) {
    const fields = { team_a_code: w.team_a_code, team_b_code: w.team_b_code };
    const row = byId[w.id];
    if ((w.team_a_code == null || w.team_b_code == null) && row?.completed) {
      Object.assign(fields, {
        score_a: null, score_b: null, winner_code: null,
        completed: false, result_source: null,
      });
    }
    await patchMatch(w.id, fields, { skipManual: true });
  }
  console.log(`Wrote ${scoreWrites.length} scores + ${cascadeWrites.length} cascade updates.`);

  return {
    events: events.length,
    final: counts.final,
    live: counts.inProgress,
    unchanged: counts.unchanged,
    cascade: cascadeWrites.length,
    scoresWritten: scoreWrites.length,
  };
}

Deno.serve(async () => {
  try {
    const summary = await runSync();
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
