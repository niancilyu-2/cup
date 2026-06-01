// ABOUTME: Tests the pure scoring engine against fixture tournaments.
// ABOUTME: Verifies each stage's point allocation, defensive handling, and the perfect-bracket total.

import { describe, it, expect } from 'vitest';
import {
  scorePlayer,
  STAGE_MATCHES,
  STAGE_POINTS,
  PERFECT_TOTAL,
} from '../src/scoring.js';

// Fully-played tournament fixture. 8 groups have their 3rd-place team
// advance (A, C, D, E, H, I, K, L); the other 4 do not (B, F, G, J).
// Every knockout match has a known winner — handy for the "perfect" case.
const FULLY_PLAYED_RESULTS = {
  groupOutcomes: {
    A: { first: 'MEX', second: 'KOR', third: 'RSA', third_advances: true  },
    B: { first: 'SUI', second: 'CAN', third: 'QAT', third_advances: false },
    C: { first: 'BRA', second: 'MAR', third: 'SCO', third_advances: true  },
    D: { first: 'USA', second: 'AUS', third: 'PAR', third_advances: true  },
    E: { first: 'GER', second: 'ECU', third: 'CIV', third_advances: true  },
    F: { first: 'NED', second: 'JPN', third: 'TUN', third_advances: false },
    G: { first: 'BEL', second: 'IRN', third: 'EGY', third_advances: false },
    H: { first: 'ESP', second: 'URU', third: 'KSA', third_advances: true  },
    I: { first: 'FRA', second: 'SEN', third: 'NOR', third_advances: true  },
    J: { first: 'ARG', second: 'AUT', third: 'ALG', third_advances: false },
    K: { first: 'POR', second: 'COL', third: 'UZB', third_advances: true  },
    L: { first: 'ENG', second: 'CRO', third: 'PAN', third_advances: true  },
  },
  matchResults: Object.fromEntries(
    [
      ...STAGE_MATCHES.r32,
      ...STAGE_MATCHES.r16,
      ...STAGE_MATCHES.qf,
      ...STAGE_MATCHES.sf,
      ...STAGE_MATCHES.final,
    ].map((id) => [id, { winner: `WIN_${id}`, played: true }]),
  ),
};

function perfectPicksFor(results) {
  const groups = {};
  for (const [code, o] of Object.entries(results.groupOutcomes)) {
    groups[code] = {
      first:    o.first,
      second:   o.second,
      third:    o.third,
      advances: o.third_advances,
    };
  }
  const bracket = {};
  for (const [id, r] of Object.entries(results.matchResults)) {
    bracket[id] = r.winner;
  }
  return { groups, bracket };
}

describe('scoring engine', () => {
  it('returns zeros for empty input', () => {
    const s = scorePlayer({}, {});
    expect(s.total).toBe(0);
  });

  it('handles null/undefined defensively', () => {
    expect(scorePlayer(null, null).total).toBe(0);
    expect(scorePlayer(undefined, undefined).total).toBe(0);
  });

  it('awards 148 for a perfect bracket', () => {
    const picks = perfectPicksFor(FULLY_PLAYED_RESULTS);
    const s = scorePlayer(picks, FULLY_PLAYED_RESULTS);
    expect(s.total).toBe(PERFECT_TOTAL);
    expect(s.total).toBe(148);
    expect(s.groups).toBe(24);
    expect(s.wildcards).toBe(8);
    expect(s.r32).toBe(32);
    expect(s.r16).toBe(32);
    expect(s.qf).toBe(24);
    expect(s.sf).toBe(16);
    expect(s.final).toBe(12);
  });

  it('awards 0 for empty picks against a played tournament', () => {
    const s = scorePlayer({ groups: {}, bracket: {} }, FULLY_PLAYED_RESULTS);
    expect(s.total).toBe(0);
  });

  it('scores groups 1pt per correct 1st or 2nd', () => {
    const picks = {
      groups: {
        A: { first: 'MEX', second: 'KOR' }, // both right → +2
        B: { first: 'SUI', second: 'XXX' }, // first only → +1
        C: { first: 'XXX', second: 'MAR' }, // second only → +1
        D: { first: 'XXX', second: 'XXX' }, // none → 0
      },
      bracket: {},
    };
    expect(scorePlayer(picks, FULLY_PLAYED_RESULTS).groups).toBe(4);
  });

  it('does not award group points for a correct 3rd-place identification', () => {
    const picks = {
      groups: { A: { first: 'XXX', second: 'XXX', third: 'RSA' } },
      bracket: {},
    };
    expect(scorePlayer(picks, FULLY_PLAYED_RESULTS).groups).toBe(0);
  });

  it('scores wildcards only when advances flag matches an actual advancing third', () => {
    // Actual advances: A C D E H I K L
    const picks = {
      groups: {
        A: { advances: true  }, // +1
        C: { advances: true  }, // +1
        E: { advances: true  }, // +1
        D: { advances: false }, // 0 — correct guess, but Option-B scoring only counts active picks
        B: { advances: true  }, // 0 — B doesn't advance
        F: { advances: true  }, // 0 — F doesn't advance
      },
      bracket: {},
    };
    expect(scorePlayer(picks, FULLY_PLAYED_RESULTS).wildcards).toBe(3);
  });

  it('scores wildcards up to 8 when the user picks exactly the right 8 groups', () => {
    const picks = {
      groups: {
        A: { advances: true }, C: { advances: true }, D: { advances: true },
        E: { advances: true }, H: { advances: true }, I: { advances: true },
        K: { advances: true }, L: { advances: true },
      },
      bracket: {},
    };
    expect(scorePlayer(picks, FULLY_PLAYED_RESULTS).wildcards).toBe(8);
  });

  it('scores R32 winners at 2 points each', () => {
    const picks = {
      groups: {},
      bracket: {
        M73: 'WIN_M73', // +2
        M74: 'WIN_M74', // +2
        M75: 'XXX',     // 0
      },
    };
    expect(scorePlayer(picks, FULLY_PLAYED_RESULTS).r32).toBe(4);
  });

  it('applies the right point value to each knockout stage', () => {
    const picks = {
      groups: {},
      bracket: {
        M89:  'WIN_M89',  // R16
        M97:  'WIN_M97',  // QF
        M101: 'WIN_M101', // SF
        M104: 'WIN_M104', // Final
      },
    };
    const s = scorePlayer(picks, FULLY_PLAYED_RESULTS);
    expect(s.r16).toBe(STAGE_POINTS.r16);
    expect(s.qf).toBe(STAGE_POINTS.qf);
    expect(s.sf).toBe(STAGE_POINTS.sf);
    expect(s.final).toBe(STAGE_POINTS.final);
  });

  it('ignores knockout picks for matches not yet played', () => {
    const partial = {
      groupOutcomes: {},
      matchResults: {
        M73: { winner: 'WIN_M73', played: true  },
        M74: { winner: 'WIN_M74', played: false },
      },
    };
    const picks = { groups: {}, bracket: { M73: 'WIN_M73', M74: 'WIN_M74' } };
    expect(scorePlayer(picks, partial).r32).toBe(2);
  });

  it('does not score the 3rd-place playoff (M103)', () => {
    const results = {
      groupOutcomes: {},
      matchResults: { M103: { winner: 'WIN_M103', played: true } },
    };
    const picks = { groups: {}, bracket: { M103: 'WIN_M103' } };
    expect(scorePlayer(picks, results).total).toBe(0);
  });

  it('totals the per-stage components correctly', () => {
    const picks = {
      groups: {
        A: { first: 'MEX', second: 'KOR', advances: true }, // 2 groups + 1 wildcard
      },
      bracket: { M104: 'WIN_M104' }, // 12 final
    };
    const s = scorePlayer(picks, FULLY_PLAYED_RESULTS);
    expect(s.groups).toBe(2);
    expect(s.wildcards).toBe(1);
    expect(s.final).toBe(12);
    expect(s.total).toBe(15);
  });
});
