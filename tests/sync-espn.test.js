// ABOUTME: Tests for the sync orchestrator's pure match-indexing + lookup helpers.
// ABOUTME: Exercises pair-key lookup (order-independent) and rematch date disambiguation.
import { describe, it, expect } from 'vitest';
import { buildIndex, matchIdFor } from '../scripts/sync-espn.js';

const row = (id, a, b, kickoff) => ({
  id, team_a_code: a, team_b_code: b, kickoff_at: kickoff,
});

describe('buildIndex + matchIdFor', () => {
  it('matches a group game regardless of home/away order', () => {
    const idx = buildIndex([row('M1', 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')]);
    expect(matchIdFor(idx, { teamA: 'RSA', teamB: 'MEX', dateUTC: '20260611' })).toBe('M1');
  });

  it('ignores matches whose team codes are not yet resolved', () => {
    const idx = buildIndex([row('M73', null, null, '2026-06-28T22:00:00+00:00')]);
    expect(matchIdFor(idx, { teamA: 'MEX', teamB: 'BRA', dateUTC: '20260628' })).toBe(null);
  });

  it('disambiguates a rematch by nearest date', () => {
    const idx = buildIndex([
      row('M1', 'MEX', 'BRA', '2026-06-11T19:00:00+00:00'),
      row('M97', 'MEX', 'BRA', '2026-07-09T19:00:00+00:00'),
    ]);
    expect(matchIdFor(idx, { teamA: 'BRA', teamB: 'MEX', dateUTC: '20260709' })).toBe('M97');
    expect(matchIdFor(idx, { teamA: 'BRA', teamB: 'MEX', dateUTC: '20260611' })).toBe('M1');
  });
});
