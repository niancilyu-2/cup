// ABOUTME: Tests for the sync orchestrator's pure match-indexing + lookup helpers.
// ABOUTME: Exercises pair-key lookup (order-independent) and rematch date disambiguation.
import { describe, it, expect } from 'vitest';
import { buildIndex, matchIdFor, orientScores } from '../scripts/sync-espn.js';

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

  it('disambiguates by real calendar distance across a month boundary', () => {
    const idx = buildIndex([
      row('M72', 'MEX', 'BRA', '2026-06-30T19:00:00+00:00'),
      row('M97', 'MEX', 'BRA', '2026-07-04T19:00:00+00:00'),
    ]);
    // Numeric YYYYMMDD distance would pick Jul 4 (|20260704-20260701| = 3
    // vs |20260630-20260701| = 71); calendar distance is 3 days vs 1 day.
    expect(matchIdFor(idx, { teamA: 'BRA', teamB: 'MEX', dateUTC: '20260701' })).toBe('M72');
  });
});

describe('orientScores', () => {
  const dbRow = { team_a_code: 'MEX', team_b_code: 'RSA' };

  it('keeps scores when ESPN home is our team_a', () => {
    const ev = { teamA: 'MEX', teamB: 'RSA', scoreA: 2, scoreB: 1 };
    expect(orientScores(ev, dbRow)).toEqual({ scoreA: 2, scoreB: 1 });
  });

  it('swaps scores when ESPN home is our team_b', () => {
    // RSA 1-2 MEX as ESPN reports it must store as MEX 2-1 RSA on our row.
    const ev = { teamA: 'RSA', teamB: 'MEX', scoreA: 1, scoreB: 2 };
    expect(orientScores(ev, dbRow)).toEqual({ scoreA: 2, scoreB: 1 });
  });
});
