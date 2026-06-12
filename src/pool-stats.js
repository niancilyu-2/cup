// ABOUTME: Pure aggregation functions for the Pool Stats page — pick popularity,
// ABOUTME: divisiveness, group chaos, and contrarian calls across all players.

import { STAGE_MATCHES } from './scoring.js';

const FINAL_MATCH_ID = 'M104';
const SF_MATCH_IDS = STAGE_MATCHES.sf;       // ['M101', 'M102']
const THIRD_PLACE_MATCH_ID = 'M103';
const BRACKET_COMPARE_IDS = [
  ...STAGE_MATCHES.r32,
  ...STAGE_MATCHES.r16,
  ...STAGE_MATCHES.qf,
  ...STAGE_MATCHES.sf,
  ...STAGE_MATCHES.final,
  THIRD_PLACE_MATCH_ID,
];
const STAGE_DEPTH = { r32: 1, r16: 2, qf: 3, sf: 4, final: 5 };

// Shared tally helper: Map<key, count> from an iterable of keys.
function tally(keys) {
  const counts = new Map();
  for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  return counts;
}

function sortedEntries(counts) {
  // count desc, then key asc for deterministic ties.
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

// ---------- Champion favorites ----------
// Who did everyone pick to win the Final? Top N teams + an "Other" bucket.
export function championFavorites(picksByPlayer, { top = 4 } = {}) {
  const codes = [];
  for (const picks of picksByPlayer.values()) {
    const c = picks.bracket[FINAL_MATCH_ID];
    if (c) codes.push(c);
  }
  const totalPickers = codes.length;
  if (!totalPickers) return { totalPickers: 0, entries: [], other: null };
  const ranked = sortedEntries(tally(codes));
  const entries = ranked.slice(0, top).map(([code, count]) => ({
    code, count, share: count / totalPickers,
  }));
  const restCount = ranked.slice(top).reduce((sum, [, c]) => sum + c, 0);
  const other = restCount ? { count: restCount, share: restCount / totalPickers } : null;
  return { totalPickers, entries, other };
}

// ---------- Most common final matchup ----------
// Pair = (M101 winner pick, M102 winner pick); bracket halves are fixed, so
// the ordered pair is already canonical. Players need both SF picks to count.
export function finalMatchups(picksByPlayer, { top = 3 } = {}) {
  const pairs = [];
  for (const picks of picksByPlayer.values()) {
    const a = picks.bracket[SF_MATCH_IDS[0]];
    const b = picks.bracket[SF_MATCH_IDS[1]];
    if (a && b) pairs.push(`${a}|${b}`);
  }
  const totalPickers = pairs.length;
  if (!totalPickers) return { totalPickers: 0, entries: [] };
  const entries = sortedEntries(tally(pairs)).slice(0, top).map(([key, count]) => {
    const [a, b] = key.split('|');
    return { a, b, count, share: count / totalPickers };
  });
  return { totalPickers, entries };
}

// ---------- Most divisive matches ----------
// Divisiveness = 1 - (top share - runner-up share): an even split scores
// highest, and the formula works the same for 2-way and 3-way splits.
// Needs at least 2 pickers and 2 distinct options to be "divisive" at all.
export function divisiveMatches(picksByPlayer, { top = 3 } = {}) {
  const knockoutIds = Object.entries(STAGE_MATCHES)
    .flatMap(([stage, ids]) => ids.map((id) => ({ id, stage })));
  const rows = [];
  for (const { id, stage } of knockoutIds) {
    const codes = [];
    for (const picks of picksByPlayer.values()) {
      const c = picks.bracket[id];
      if (c) codes.push(c);
    }
    const totalPickers = codes.length;
    if (totalPickers < 2) continue;
    const ranked = sortedEntries(tally(codes));
    if (ranked.length < 2) continue;
    const margin = (ranked[0][1] - ranked[1][1]) / totalPickers;
    rows.push({
      matchId: id,
      stage,
      totalPickers,
      margin,
      options: ranked.map(([code, count]) => ({ code, count, share: count / totalPickers })),
    });
  }
  rows.sort((x, y) =>
    x.margin - y.margin ||
    y.totalPickers - x.totalPickers ||
    STAGE_DEPTH[y.stage] - STAGE_DEPTH[x.stage] ||
    parseInt(x.matchId.slice(1), 10) - parseInt(y.matchId.slice(1), 10));
  return rows.slice(0, top);
}

// ---------- Most divisive groups ----------
// Chaos = normalized Shannon entropy of the distribution of complete 1st-4th
// orderings: 0 when everyone agrees, 100 when every picker ordered the group
// differently. Entropy beats a plain unique-orderings count because it also
// reflects how evenly the disagreement is spread.
function chaosScore(orderingCounts, totalPickers) {
  if (totalPickers < 2) return 0;
  let h = 0;
  for (const count of orderingCounts.values()) {
    const p = count / totalPickers;
    h -= p * Math.log2(p);
  }
  const hMax = Math.log2(Math.min(totalPickers, 24)); // 24 = 4! possible orderings
  return hMax > 0 ? Math.round((h / hMax) * 100) : 0;
}

export function divisiveGroups(picksByPlayer, teamsByGroup, { top = 2 } = {}) {
  const rows = [];
  for (const [group, teams] of Object.entries(teamsByGroup)) {
    const members = new Set(teams);
    const orderings = [];   // [c1,c2,c3,c4] per player with a complete valid pick
    const firsts = [];
    const topTwoCounts = new Map();   // team -> times placed 1st or 2nd
    const wildcardCounts = new Map(); // team -> times placed 3rd AND flagged advancing
    let pickers = 0;
    for (const picks of picksByPlayer.values()) {
      const p = picks.groups[group];
      if (!p || !p.first || !p.second || !p.third) continue;
      const trio = [p.first, p.second, p.third];
      if (new Set(trio).size !== 3 || !trio.every((c) => members.has(c))) continue;
      const fourth = teams.find((c) => !trio.includes(c));
      if (!fourth) continue;
      pickers++;
      orderings.push([...trio, fourth]);
      firsts.push(p.first);
      for (const c of [p.first, p.second]) topTwoCounts.set(c, (topTwoCounts.get(c) || 0) + 1);
      if (p.advances) wildcardCounts.set(p.third, (wildcardCounts.get(p.third) || 0) + 1);
    }
    if (!pickers) continue;
    const orderingCounts = tally(orderings.map((o) => o.join('>')));
    const topOrderings = sortedEntries(orderingCounts).slice(0, 2).map(([key, count]) => ({
      order: key.split('>'),
      count,
      share: count / pickers,
    }));
    const firstRanked = sortedEntries(tally(firsts));
    const topTwoRanked = sortedEntries(topTwoCounts);
    const wildcardRanked = sortedEntries(wildcardCounts);
    rows.push({
      group,
      teams,
      chaos: chaosScore(orderingCounts, pickers),
      uniqueOrderings: orderingCounts.size,
      totalPickers: pickers,
      firstFavorite: { code: firstRanked[0][0], share: firstRanked[0][1] / pickers },
      // The contested boundary: teams ranked #2 and #3 by how often players
      // put them in the top two — the race for the second qualifying spot.
      topTwoRace: topTwoRanked.slice(1, 3).map(([code, count]) => ({
        code, share: count / pickers,
      })),
      wildcard: wildcardRanked.length
        ? { code: wildcardRanked[0][0], share: wildcardRanked[0][1] / pickers }
        : null,
      topOrderings,
    });
  }
  rows.sort((x, y) =>
    y.chaos - x.chaos ||
    y.uniqueOrderings - x.uniqueOrderings ||
    (x.group < y.group ? -1 : 1));
  return rows.slice(0, top);
}

// ---------- Most similar picks ----------
// Similarity compares stable pick slots only: group 1st/2nd/3rd/4th, each
// group's wildcard flag, and fixed knockout match IDs. Players are ranked by
// match rate, then raw matches, with a minimum comparable-pick guard.
function buildPickVector(picks, teamsByGroup) {
  const vector = new Map();
  const groups = Object.keys(teamsByGroup || {}).sort();

  for (const group of groups) {
    const teams = teamsByGroup[group] || [];
    const members = new Set(teams);
    const p = picks.groups[group];
    if (!p || !p.first || !p.second || !p.third) continue;

    const trio = [p.first, p.second, p.third];
    if (new Set(trio).size !== 3 || !trio.every((c) => members.has(c))) continue;

    const fourth = teams.find((c) => !trio.includes(c));
    if (!fourth) continue;

    [p.first, p.second, p.third, fourth].forEach((code, idx) => {
      vector.set(`G:${group}:${idx + 1}`, code);
    });
    vector.set(`G:${group}:WC`, p.advances ? 'ADV' : 'OUT');
  }

  const bracketIds = [...new Set([
    ...BRACKET_COMPARE_IDS,
    ...Object.keys(picks.bracket || {}),
  ])].sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

  for (const id of bracketIds) {
    const winner = picks.bracket[id];
    if (winner) vector.set(`B:${id}`, winner);
  }

  return vector;
}

function comparePickVectors(a, b) {
  const out = {
    matches: 0,
    compared: 0,
    groupMatches: 0,
    groupCompared: 0,
    bracketMatches: 0,
    bracketCompared: 0,
  };

  for (const [key, value] of a.entries()) {
    if (!b.has(key)) continue;
    const same = b.get(key) === value;
    out.compared++;
    if (same) out.matches++;

    if (key.startsWith('G:')) {
      out.groupCompared++;
      if (same) out.groupMatches++;
    } else if (key.startsWith('B:')) {
      out.bracketCompared++;
      if (same) out.bracketMatches++;
    }
  }

  return { ...out, share: out.compared ? out.matches / out.compared : 0 };
}

function pickSimilarityPairs(picksByPlayer, teamsByGroup, { top = 5, minCompared = 24, direction = 'most' } = {}) {
  const vectors = [...picksByPlayer.entries()]
    .map(([playerId, picks]) => ({ playerId, vector: buildPickVector(picks, teamsByGroup) }))
    .filter((row) => row.vector.size > 0)
    .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));

  const pairs = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const comparison = comparePickVectors(vectors[i].vector, vectors[j].vector);
      if (comparison.compared < minCompared) continue;
      pairs.push({
        playerIds: [vectors[i].playerId, vectors[j].playerId],
        ...comparison,
      });
    }
  }

  pairs.sort((x, y) => {
    if (direction === 'least') {
      return x.share - y.share ||
        x.matches - y.matches ||
        y.compared - x.compared ||
        (x.playerIds.join('|') < y.playerIds.join('|') ? -1 : 1);
    }
    return y.share - x.share ||
      y.matches - x.matches ||
      y.compared - x.compared ||
      (x.playerIds.join('|') < y.playerIds.join('|') ? -1 : 1);
  });
  return pairs.slice(0, top);
}

export function similarPickPairs(picksByPlayer, teamsByGroup, { top = 5, minCompared = 24 } = {}) {
  return pickSimilarityPairs(picksByPlayer, teamsByGroup, { top, minCompared, direction: 'most' });
}

export function leastSimilarPickPairs(picksByPlayer, teamsByGroup, { top = 5, minCompared = 24 } = {}) {
  return pickSimilarityPairs(picksByPlayer, teamsByGroup, { top, minCompared, direction: 'least' });
}

// ---------- Contrarian picks ----------
// A (team, depth) claim held by few: depth ∈ champion/final/sf/qf, derived
// from bracket picks (e.g. picking a team in M101/M102 claims "in the final").
// Per player, the deepest claim per team subsumes the shallower ones, so a
// "JPN champion" pick doesn't also generate a "JPN in the final" card.
// Contrarian = share ≤ maxShare of players holding any claim at that depth.
const DEPTHS = [
  // matchIds: picking a winner there claims the team reaches the NEXT round.
  { key: 'champion', matchIds: STAGE_MATCHES.final, rank: 4 },
  { key: 'final',    matchIds: STAGE_MATCHES.sf,    rank: 3 },
  { key: 'sf',       matchIds: STAGE_MATCHES.qf,    rank: 2 },
  { key: 'qf',       matchIds: STAGE_MATCHES.r16,   rank: 1 },
];

export function contrarianPicks(picksByPlayer, { maxShare = 0.2, top = 6 } = {}) {
  // Per depth: Map<teamCode, Set<playerId>>; per player: Map<teamCode, rank of deepest claim>.
  const claims = Object.fromEntries(DEPTHS.map((d) => [d.key, new Map()]));
  const depthPickers = Object.fromEntries(DEPTHS.map((d) => [d.key, new Set()]));
  for (const [playerId, picks] of picksByPlayer.entries()) {
    const deepest = new Map(); // teamCode -> {key, rank}
    for (const depth of DEPTHS) {
      let claimedAny = false;
      for (const matchId of depth.matchIds) {
        const code = picks.bracket[matchId];
        if (!code) continue;
        claimedAny = true;
        const cur = deepest.get(code);
        if (!cur || depth.rank > cur.rank) deepest.set(code, depth);
      }
      if (claimedAny) depthPickers[depth.key].add(playerId);
    }
    for (const [code, depth] of deepest.entries()) {
      let set = claims[depth.key].get(code);
      if (!set) { set = new Set(); claims[depth.key].set(code, set); }
      set.add(playerId);
    }
  }
  const out = [];
  for (const depth of DEPTHS) {
    const denom = depthPickers[depth.key].size;
    if (!denom) continue;
    for (const [code, pickers] of claims[depth.key].entries()) {
      const share = pickers.size / denom;
      if (share <= maxShare) {
        out.push({ code, depth: depth.key, count: pickers.size, share, pickerIds: [...pickers] });
      }
    }
  }
  out.sort((x, y) => {
    const rank = (d) => DEPTHS.findIndex((e) => e.key === d);
    return x.share - y.share || rank(x.depth) - rank(y.depth) || (x.code < y.code ? -1 : 1);
  });
  return out.slice(0, top);
}
