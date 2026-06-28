// ABOUTME: Pure scoring engine for the WC 2026 bracket pick'em.
// ABOUTME: Given a player's picks and the tournament results, returns a per-stage breakdown.

export const STAGE_POINTS = {
  groups:    1,
  wildcards: 1,
  r32:       2,
  r16:       4,
  qf:        6,
  sf:        8,
  final:     12,
};

// Knockout match IDs grouped by stage (fixed for WC 2026).
// M103 is the 3rd-place playoff — picked separately, not scored.
export const STAGE_MATCHES = {
  r32:   ['M73', 'M74', 'M75', 'M76', 'M77', 'M78', 'M79', 'M80',
          'M81', 'M82', 'M83', 'M84', 'M85', 'M86', 'M87', 'M88'],
  r16:   ['M89', 'M90', 'M91', 'M92', 'M93', 'M94', 'M95', 'M96'],
  qf:    ['M97', 'M98', 'M99', 'M100'],
  sf:    ['M101', 'M102'],
  final: ['M104'],
};

export const PERFECT_TOTAL =
  24 /* groups */ + 8 /* wildcards */ +
  32 /* r32 */ + 32 /* r16 */ + 24 /* qf */ + 16 /* sf */ + 12 /* final */;
// 148

const KNOCKOUT_STAGES = ['r32', 'r16', 'qf', 'sf', 'final'];

const ZERO_BREAKDOWN = () => ({
  groups: 0, wildcards: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, total: 0,
});

export function scorePlayer(picks, results) {
  const out = ZERO_BREAKDOWN();
  if (!picks || !results) return out;

  const playerGroups   = picks.groups   || {};
  const playerBracket  = picks.bracket  || {};
  const groupOutcomes  = results.groupOutcomes || {};
  const matchResults   = results.matchResults  || {};

  // Groups: 1 pt for a correct 1st-place pick, 1 pt for a correct 2nd-place
  // pick. Max 24 across 12 groups.
  for (const code of Object.keys(groupOutcomes)) {
    const o = groupOutcomes[code];
    const p = playerGroups[code];
    if (!p) continue;
    if (p.first  && p.first  === o.first)  out.groups += STAGE_POINTS.groups;
    if (p.second && p.second === o.second) out.groups += STAGE_POINTS.groups;
  }

  // Wildcards: 1 pt for each group the player flagged as advancing whose
  // 3rd-place team actually advanced. Max 8 — both sets are size 8 in a
  // valid pick, so the score is |picked ∩ actual|.
  for (const code of Object.keys(groupOutcomes)) {
    const o = groupOutcomes[code];
    const p = playerGroups[code];
    if (!p) continue;
    if (p.advances && o.third_advances && p.third === o.third) {
      out.wildcards += STAGE_POINTS.wildcards;
  }

  // Knockout stages: per-stage points for picking the actual winner of each
  // played match. Unplayed matches and matches missing a winner are skipped.
  for (const stage of KNOCKOUT_STAGES) {
    for (const matchId of STAGE_MATCHES[stage]) {
      const r = matchResults[matchId];
      if (!r || !r.played || !r.winner) continue;
      if (playerBracket[matchId] === r.winner) out[stage] += STAGE_POINTS[stage];
    }
  }

  out.total =
    out.groups + out.wildcards +
    out.r32 + out.r16 + out.qf + out.sf + out.final;

  return out;
}
