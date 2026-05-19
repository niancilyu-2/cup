// ABOUTME: 8-best-3rds → R32 wildcard slot assignment for the WC 2026 bracket.
// ABOUTME: Uses FIFA's official Annexe C lookup table (FWC2026_regulations_EN.pdf).

import { ANNEXE_C } from './wildcards-table.js';

// FIFA's eight wildcard R32 slots and the group codes each is eligible for.
// Derived from inspecting Annexe C — each column in the PDF table corresponds
// to one match, and the groups appearing in that column across all 495 rows
// give the eligibility list. Kept here so tests can assert that every row of
// Annexe C respects these constraints.
export const WILDCARD_SLOTS = [
  { matchId: 'M74', eligible: ['A', 'B', 'C', 'D', 'F'] },
  { matchId: 'M77', eligible: ['C', 'D', 'F', 'G', 'H'] },
  { matchId: 'M79', eligible: ['C', 'E', 'F', 'H', 'I'] },
  { matchId: 'M80', eligible: ['E', 'H', 'I', 'J', 'K'] },
  { matchId: 'M81', eligible: ['B', 'E', 'F', 'I', 'J'] },
  { matchId: 'M82', eligible: ['A', 'E', 'H', 'I', 'J'] },
  { matchId: 'M85', eligible: ['E', 'F', 'G', 'I', 'J'] },
  { matchId: 'M87', eligible: ['D', 'E', 'I', 'J', 'L'] },
];

export const ALL_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export const WILDCARD_TABLE = ANNEXE_C;

export function wildcardKey(pickedGroups) {
  return [...pickedGroups].sort().join('');
}

export function lookupAssignment(pickedGroups) {
  if (pickedGroups.length !== 8) return null;
  return WILDCARD_TABLE[wildcardKey(pickedGroups)] || null;
}
