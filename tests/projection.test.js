// ABOUTME: Tests for reachability + max-possible projection on real results.
// ABOUTME: Guards against counting non-qualified or wrong-subtree knockout picks.
import { describe, it, expect } from 'vitest';
import { buildReachability, isOutOfContention, maxPossible } from '../src/projection.js';

// Two complete groups (A1>A2>A3>A4, B1>B2>B3>B4) feeding a tiny knockout tree:
//   M73 = 2A vs 2B  (A2 vs B2)
//   M75 = 1A vs 1B  (A1 vs B1)
//   M90 = W73 vs W75 (r16)
//   M104 = W73 vs W75 (stand-in final, for out-of-contention checks)
function fixture(matchResults = {}) {
  const matches = [
    { id: 'M1', stage: 'group', group_code: 'A', team_a_code: 'A1', team_b_code: 'A2' },
    { id: 'M2', stage: 'group', group_code: 'A', team_a_code: 'A3', team_b_code: 'A4' },
    { id: 'M3', stage: 'group', group_code: 'B', team_a_code: 'B1', team_b_code: 'B2' },
    { id: 'M4', stage: 'group', group_code: 'B', team_a_code: 'B3', team_b_code: 'B4' },
    { id: 'M73', stage: 'r32', slot_a: '2A', slot_b: '2B' },
    { id: 'M75', stage: 'r32', slot_a: '1A', slot_b: '1B' },
    { id: 'M90', stage: 'r16', slot_a: 'W73', slot_b: 'W75' },
    { id: 'M104', stage: 'final', slot_a: 'W73', slot_b: 'W75' },
  ];
  const results = {
    groupOutcomes: {
      A: { first: 'A1', second: 'A2', third: 'A3', third_advances: false },
      B: { first: 'B1', second: 'B2', third: 'B3', third_advances: false },
    },
    matchResults,
  };
  return { matches, results };
}

describe('buildReachability', () => {
  it('resolves a group-slot R32 match to its two finishing teams', () => {
    const { matches, results } = fixture();
    const reach = buildReachability(matches, results);
    const p = reach.participants('M73');
    expect([...p].sort()).toEqual(['A2', 'B2']);
  });

  it('excludes a team whose real seeding puts it in another subtree', () => {
    // A1 finished 1st (slot 1A → M75), so it can never appear in M73 (2A vs 2B).
    const { matches, results } = fixture();
    const reach = buildReachability(matches, results);
    expect(reach.participants('M73').has('A1')).toBe(false);
  });

  it('tightens downstream participants as feeders are decided', () => {
    const { matches, results } = fixture({ M73: { winner: 'A2', played: true } });
    const reach = buildReachability(matches, results);
    // B2 lost M73, so it can no longer reach the R16 match fed by W73.
    expect(reach.participants('M90').has('B2')).toBe(false);
    expect(reach.participants('M90').has('A2')).toBe(true);
  });
});

describe('isOutOfContention', () => {
  it('flags a team that did not qualify to the knockouts', () => {
    const { matches, results } = fixture();
    const reach = buildReachability(matches, results);
    expect(isOutOfContention(reach, 'A3')).toBe(true);   // 3rd, not advancing
    expect(isOutOfContention(reach, 'A1')).toBe(false);  // still alive
  });
});

describe('maxPossible', () => {
  const baseBreakdown = { total: 10, wildcards: 0 };
  const noGroupPotential = { groups: {} }; // both groups already decided

  it('counts only knockout picks whose team can still reach the match', () => {
    const { matches, results } = fixture();
    const reach = buildReachability(matches, results);
    const picks = {
      ...noGroupPotential,
      bracket: {
        M73: 'A2',  // viable r32 (+2)
        M75: 'A3',  // A3 did not qualify -> not viable (+0)
        M90: 'A1',  // viable r16 (+4)
        M104: 'A3', // not viable final (+0)
      },
    };
    const max = maxPossible({ breakdown: baseBreakdown, picks, results, matches, reach });
    expect(max).toBe(10 + 2 + 4);
  });

  it('does not re-count a match that has already been played', () => {
    const { matches, results } = fixture({ M73: { winner: 'A2', played: true } });
    const reach = buildReachability(matches, results);
    const picks = { ...noGroupPotential, bracket: { M73: 'A2' } };
    // M73 is decided; its points live in breakdown.total, so max must not add them.
    const max = maxPossible({ breakdown: baseBreakdown, picks, results, matches, reach });
    expect(max).toBe(10);
  });

  it('adds group-slot upside for undecided groups the player filled', () => {
    // No groups decided yet; player filled 1st/2nd for one group.
    const matches = [
      { id: 'M1', stage: 'group', group_code: 'A', team_a_code: 'A1', team_b_code: 'A2' },
    ];
    const results = { groupOutcomes: {}, matchResults: {} };
    const reach = buildReachability(matches, results);
    const picks = { groups: { A: { first: 'A1', second: 'A2', advances: false } }, bracket: {} };
    const max = maxPossible({ breakdown: { total: 0, wildcards: 0 }, picks, results, matches, reach });
    expect(max).toBe(2); // 1st + 2nd still earnable
  });
});
