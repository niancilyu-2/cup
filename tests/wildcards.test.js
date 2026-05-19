// ABOUTME: Verifies the 8-best-3rds wildcard lookup table satisfies FIFA's constraints.
// ABOUTME: Four properties per Article 12.6: completeness, uniqueness, membership, eligibility.

import { describe, it, expect } from 'vitest';
import {
  WILDCARD_TABLE,
  WILDCARD_SLOTS,
  ALL_GROUPS,
  lookupAssignment,
  wildcardKey,
} from '../src/wildcards.js';

const SLOT_ELIGIBILITY = Object.fromEntries(
  WILDCARD_SLOTS.map((s) => [s.matchId, new Set(s.eligible)]),
);

function* combinations(arr, k) {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > arr.length) return;
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest];
    }
  }
}

const ALL_COMBOS = [...combinations(ALL_GROUPS, 8)];

describe('wildcard lookup table', () => {
  it('contains an entry for all 495 8-of-12 group combinations', () => {
    expect(ALL_COMBOS.length).toBe(495);
    for (const combo of ALL_COMBOS) {
      const key = combo.join('');
      expect(WILDCARD_TABLE[key], `missing assignment for ${key}`).toBeDefined();
    }
  });

  it('each assignment maps to exactly 8 unique third-place groups', () => {
    for (const [key, assignment] of Object.entries(WILDCARD_TABLE)) {
      const groups = Object.values(assignment);
      expect(groups.length, `wrong slot count for ${key}`).toBe(8);
      expect(new Set(groups).size, `duplicate groups in ${key}`).toBe(8);
    }
  });

  it('each assigned group is one of the user\'s 8 picks', () => {
    for (const [key, assignment] of Object.entries(WILDCARD_TABLE)) {
      const picked = new Set(key.split(''));
      for (const g of Object.values(assignment)) {
        expect(picked.has(g), `${key}: assigned ${g} not in picks`).toBe(true);
      }
    }
  });

  it('each assignment respects the slot eligibility constraint', () => {
    for (const [key, assignment] of Object.entries(WILDCARD_TABLE)) {
      for (const [matchId, group] of Object.entries(assignment)) {
        expect(
          SLOT_ELIGIBILITY[matchId].has(group),
          `${key}: ${group} not eligible for ${matchId}`,
        ).toBe(true);
      }
    }
  });

  it('lookupAssignment is order-independent', () => {
    const sorted = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const shuffled = ['H', 'C', 'A', 'F', 'B', 'D', 'G', 'E'];
    expect(lookupAssignment(sorted)).toEqual(lookupAssignment(shuffled));
  });

  it('wildcardKey is the sorted concatenation', () => {
    expect(wildcardKey(['H', 'C', 'A', 'F', 'B', 'D', 'G', 'E'])).toBe('ABCDEFGH');
  });

  it('lookupAssignment returns null when not exactly 8 picks', () => {
    expect(lookupAssignment(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe(null);
    expect(lookupAssignment(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])).toBe(null);
  });
});
