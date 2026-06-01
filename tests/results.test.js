// ABOUTME: Tests for buildTournamentResults — the matches→{groupOutcomes,matchResults} glue.
// ABOUTME: Verifies a complete group yields outcomes and completed KO matches yield results.
import { describe, it, expect } from 'vitest';
import { buildTournamentResults } from '../src/results.js';

// One group's six games, deterministic: AAA wins all, BBB 2, CCC 1, DDD 0.
function groupA() {
  const g = (a, b, sa, sb) => ({
    stage: 'group', group_code: 'A',
    team_a_code: a, team_b_code: b, score_a: sa, score_b: sb, completed: true,
  });
  return [
    g('AAA', 'BBB', 1, 0), g('AAA', 'CCC', 3, 0), g('AAA', 'DDD', 2, 0),
    g('BBB', 'CCC', 2, 0), g('BBB', 'DDD', 1, 0),
    g('CCC', 'DDD', 1, 0),
  ];
}

describe('buildTournamentResults', () => {
  it('produces group outcomes for a fully-played group', () => {
    const { groupOutcomes } = buildTournamentResults(groupA());
    expect(groupOutcomes.A).toEqual({
      first: 'AAA', second: 'BBB', third: 'CCC', third_advances: false,
    });
  });

  it('omits a group that is not yet complete', () => {
    const partial = groupA().slice(0, 3); // only 3 of 6 played
    const { groupOutcomes } = buildTournamentResults(partial);
    expect(groupOutcomes.A).toBeUndefined();
  });

  it('records completed knockout matches as results, skips unplayed ones', () => {
    const matches = [
      { id: 'M73', stage: 'r32', completed: true, winner_code: 'AAA' },
      { id: 'M74', stage: 'r32', completed: false, winner_code: null },
    ];
    const { matchResults } = buildTournamentResults(matches);
    expect(matchResults.M73).toEqual({ winner: 'AAA', played: true });
    expect(matchResults.M74).toBeUndefined();
  });

  it('leaves third_advances false until every group is complete', () => {
    // Only group A complete → wildcards undecided → no group flagged advancing.
    const { groupOutcomes } = buildTournamentResults(groupA());
    expect(groupOutcomes.A.third_advances).toBe(false);
  });
});
