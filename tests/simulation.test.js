// ABOUTME: Property test — simulates full tournaments on the real seed data and
// ABOUTME: checks scorePlayer/maxPossible invariants at checkpoints throughout.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scorePlayer, PERFECT_TOTAL, STAGE_MATCHES } from '../src/scoring.js';
import { buildTournamentResults } from '../src/results.js';
import { buildReachability, maxPossible } from '../src/projection.js';
import { computeCascadeWrites } from '../src/cascade.js';
import { computeGroupStandings } from '../src/standings.js';
import { lookupAssignment, ALL_GROUPS } from '../src/wildcards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseSeedMatches() {
  const sql = readFileSync(join(ROOT, 'seed.sql'), 'utf8');
  const matches = [];
  const groupRow = /\('(M\d+)',\s*'group',\s*'([A-L])',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'(\w{3})',\s*'(\w{3})',\s*'(\w{3})',\s*'(\w{3})'\)/g;
  for (const m of sql.matchAll(groupRow)) {
    matches.push({ id: m[1], stage: 'group', group_code: m[2], slot_a: m[3], slot_b: m[4],
      team_a_code: m[5], team_b_code: m[6], score_a: null, score_b: null, winner_code: null, completed: false });
  }
  const koRow = /\('(M\d+)',\s*'(r32|r16|qf|sf|third|final)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'([^']+)',\s*'([^']+)'\)/g;
  for (const m of sql.matchAll(koRow)) {
    matches.push({ id: m[1], stage: m[2], group_code: null, slot_a: m[3], slot_b: m[4],
      team_a_code: null, team_b_code: null, score_a: null, score_b: null, winner_code: null, completed: false });
  }
  return matches;
}

// Deterministic LCG so the "random" tournaments are reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return {
    rand,
    int: (n) => Math.floor(rand() * n),
    shuffled(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

function standingsByGroup(ms) {
  const byGroup = {};
  for (const m of ms) if (m.stage === 'group' && m.group_code) (byGroup[m.group_code] ||= []).push(m);
  const out = {};
  for (const [g, rows] of Object.entries(byGroup)) out[g] = computeGroupStandings(rows);
  return out;
}

function applyCascade(ms) {
  for (const w of computeCascadeWrites(ms, standingsByGroup(ms))) {
    Object.assign(ms.find((m) => m.id === w.id), { team_a_code: w.team_a_code, team_b_code: w.team_b_code });
  }
}

// A realistic random player: ranked groups, 8 wildcards, and a bracket
// resolved through their own picks the same way the app cascades them.
function randomPlayer(rng, matches, teamsByGroup) {
  const groups = {};
  for (const g of ALL_GROUPS) {
    const order = rng.shuffled([...teamsByGroup[g]]);
    groups[g] = { first: order[0], second: order[1], third: order[2], advances: false };
  }
  for (const g of rng.shuffled(ALL_GROUPS).slice(0, 8)) groups[g].advances = true;
  const assignment = lookupAssignment(ALL_GROUPS.filter((g) => groups[g].advances).sort());
  const bracket = {};
  const teamFor = (matchId, label) => {
    if (/^[12][A-L]$/.test(label)) return label[0] === '1' ? groups[label[1]].first : groups[label[1]].second;
    if (label.startsWith('3')) { const g = assignment?.[matchId]; return g ? groups[g].third : null; }
    if (label.startsWith('W')) return bracket[`M${label.slice(1)}`] || null;
    if (label.startsWith('L')) {
      const prior = `M${label.slice(1)}`;
      const pm = matches.find((m) => m.id === prior);
      const a = teamFor(prior, pm.slot_a);
      const b = teamFor(prior, pm.slot_b);
      return bracket[prior] === a ? b : a;
    }
    return null;
  };
  for (const m of matches.filter((m) => m.stage !== 'group')) {
    const a = teamFor(m.id, m.slot_a);
    const b = teamFor(m.id, m.slot_b);
    if (a && b) bracket[m.id] = rng.rand() < 0.5 ? a : b;
  }
  return { groups, bracket, tiebreaker: 2.1 };
}

describe('full-tournament simulation invariants', () => {
  const seedMatches = parseSeedMatches();

  it('parses the full 104-match seed', () => {
    expect(seedMatches).toHaveLength(104);
  });

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: total never exceeds max, max never rises, both converge at the end`, () => {
      const rng = makeRng(seed * 7919);
      const ms = seedMatches.map((m) => ({ ...m }));
      const teamsByGroup = {};
      for (const m of ms) if (m.stage === 'group') {
        (teamsByGroup[m.group_code] ||= new Set()).add(m.team_a_code);
        teamsByGroup[m.group_code].add(m.team_b_code);
      }
      const players = Array.from({ length: 12 }, () => randomPlayer(rng, ms, teamsByGroup));
      const prevMax = new Map();
      const prevTotal = new Map();

      const checkpoint = (done) => {
        const results = buildTournamentResults(ms);
        const reach = buildReachability(ms, results);
        players.forEach((p, i) => {
          const bd = scorePlayer(p, results);
          const sum = bd.groups + bd.wildcards + bd.r32 + bd.r16 + bd.qf + bd.sf + bd.final;
          expect(sum).toBe(bd.total);
          const max = maxPossible({ breakdown: bd, picks: p, results, matches: ms, reach });
          expect(max).toBeGreaterThanOrEqual(bd.total);
          expect(max).toBeLessThanOrEqual(PERFECT_TOTAL);
          if (prevMax.has(i)) expect(max).toBeLessThanOrEqual(prevMax.get(i));
          if (prevTotal.has(i)) expect(bd.total).toBeGreaterThanOrEqual(prevTotal.get(i));
          if (done) expect(max).toBe(bd.total);
          prevMax.set(i, max);
          prevTotal.set(i, bd.total);
        });
        return results;
      };

      const ordered = ms.slice().sort((a, b) => +a.id.slice(1) - +b.id.slice(1));
      let played = 0;
      for (const m of ordered) {
        if (m.stage === 'group') {
          const sa = rng.int(4);
          const sb = rng.int(4);
          Object.assign(m, { score_a: sa, score_b: sb,
            winner_code: sa === sb ? null : (sa > sb ? m.team_a_code : m.team_b_code) });
        } else {
          applyCascade(ms);
          expect(m.team_a_code).toBeTruthy();
          expect(m.team_b_code).toBeTruthy();
          const aWins = rng.rand() < 0.5;
          Object.assign(m, { score_a: aWins ? 2 : 1, score_b: aWins ? 1 : 2,
            winner_code: aWins ? m.team_a_code : m.team_b_code });
        }
        m.completed = true;
        if (++played % 8 === 0) checkpoint(false);
      }
      applyCascade(ms);
      const results = checkpoint(true);

      // A player whose picks mirror the actual outcomes scores exactly 148.
      const perfect = { groups: {}, bracket: {}, tiebreaker: 2.1 };
      for (const [g, o] of Object.entries(results.groupOutcomes)) {
        perfect.groups[g] = { first: o.first, second: o.second, third: o.third, advances: o.third_advances };
      }
      for (const ids of Object.values(STAGE_MATCHES)) {
        for (const id of ids) perfect.bracket[id] = results.matchResults[id].winner;
      }
      const bd = scorePlayer(perfect, results);
      expect(bd.total).toBe(PERFECT_TOTAL);
      const reach = buildReachability(ms, results);
      expect(maxPossible({ breakdown: bd, picks: perfect, results, matches: ms, reach })).toBe(PERFECT_TOTAL);
    });
  }
});
