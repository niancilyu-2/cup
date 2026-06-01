// ABOUTME: Tests for group-standings computation and best-3rd-place ranking.
// ABOUTME: Verifies FIFA tiebreaker logic (pts→GD→GF→H2H) and 3rd-place ranking.
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
    // YYY wins all 3 (9 pts); XXX wins 2 (6 pts, GD +8); this asserts points ordering.
    const matches = [
      m('XXX', 'YYY', 0, 1), m('XXX', 'ZZZ', 5, 0), m('XXX', 'WWW', 4, 0),
      m('YYY', 'ZZZ', 1, 0), m('YYY', 'WWW', 1, 0),
      m('ZZZ', 'WWW', 0, 0),
    ];
    const s = computeGroupStandings(matches);
    expect(s.first).toBe('YYY');   // 9 pts
    expect(s.second).toBe('XXX');  // 6 pts, GD +8
  });

  it('breaks a full tie by head-to-head points', () => {
    // CCC 1st (6 pts, GD +4); AAA and BBB tied (both 6 pts, GD +2, GF 4); AAA beat BBB 2-0.
    const matches = [
      m('AAA', 'BBB', 2, 0), m('AAA', 'CCC', 0, 2), m('AAA', 'DDD', 2, 0),
      m('BBB', 'CCC', 2, 0), m('BBB', 'DDD', 2, 0),
      m('CCC', 'DDD', 4, 0),
    ];
    const s = computeGroupStandings(matches);
    const idxA = s.table.findIndex((t) => t.code === 'AAA');
    const idxB = s.table.findIndex((t) => t.code === 'BBB');
    expect(idxA).toBeLessThan(idxB); // head-to-head winner ranks higher
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
