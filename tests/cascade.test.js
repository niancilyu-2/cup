// ABOUTME: Tests for resolving slot labels into concrete team-code writes.
// ABOUTME: Validates group-slot, wildcard-slot, winner-slot, and loser-slot handling.

import { describe, it, expect } from 'vitest';
import { computeCascadeWrites } from '../src/cascade.js';

const match = (id, stage, slot_a, slot_b, extra = {}) => ({
  id, stage, slot_a, slot_b,
  team_a_code: null, team_b_code: null,
  score_a: null, score_b: null, winner_code: null, completed: false,
  ...extra,
});

describe('computeCascadeWrites', () => {
  it('fills a group-slot R32 match when both groups are complete', () => {
    const matches = [match('M73', 'r32', '2A', '2B')];
    const standings = {
      A: { complete: true, first: 'MEX', second: 'KOR', third: 'RSA' },
      B: { complete: true, first: 'CAN', second: 'SUI', third: 'QAT' },
    };
    const writes = computeCascadeWrites(matches, standings);
    expect(writes).toContainEqual({ id: 'M73', team_a_code: 'KOR', team_b_code: 'SUI' });
  });

  it('does not fill when a referenced group is incomplete', () => {
    const matches = [match('M73', 'r32', '2A', '2B')];
    const standings = { A: { complete: false }, B: { complete: true, second: 'SUI' } };
    expect(computeCascadeWrites(matches, standings)).toEqual([]);
  });

  it('fills a wildcard slot using Annex C once all 12 groups are complete', () => {
    // 8 best thirds = groups A..H; lookupAssignment('ABCDEFGH') puts group A's
    // 3rd into M82 and group C's 3rd into M74 (see wildcards-table.js).
    const matches = [match('M74', 'r32', '1E', '3A/B/C/D/F')];
    const standings = {};
    'ABCDEFGHIJKL'.split('').forEach((g) => {
      standings[g] = {
        complete: true, first: `${g}1`, second: `${g}2`, third: `${g}3`,
        thirdStats: { pts: g <= 'H' ? 6 : 1, gd: 0, gf: 0 }, // A..H advance
      };
    });
    standings.E.first = 'GER';
    const writes = computeCascadeWrites(matches, standings);
    const m74 = writes.find((w) => w.id === 'M74');
    expect(m74.team_a_code).toBe('GER');      // 1E
    expect(m74.team_b_code).toBe('C3');       // group C 3rd, per Annex C 'ABCDEFGH'
  });

  it('propagates a knockout winner into the next match', () => {
    const matches = [
      match('M73', 'r32', '2A', '2B', {
        team_a_code: 'KOR', team_b_code: 'SUI',
        score_a: 2, score_b: 1, winner_code: 'KOR', completed: true,
      }),
      match('M90', 'r16', 'W73', 'W75'),
    ];
    const writes = computeCascadeWrites(matches, {});
    const m90 = writes.find((w) => w.id === 'M90');
    expect(m90.team_a_code).toBe('KOR');
    expect(m90.team_b_code).toBe(null); // W75 not yet decided
  });

  it('feeds the 3rd-place match from semifinal losers', () => {
    const matches = [
      match('M101', 'sf', 'W97', 'W98', {
        team_a_code: 'BRA', team_b_code: 'FRA',
        score_a: 1, score_b: 2, winner_code: 'FRA', completed: true,
      }),
      match('M103', 'third', 'L101', 'L102'),
    ];
    const writes = computeCascadeWrites(matches, {});
    const m103 = writes.find((w) => w.id === 'M103');
    expect(m103.team_a_code).toBe('BRA'); // loser of M101
  });

  it('clears a previously cascaded team when the upstream result is voided', () => {
    const matches = [
      // M73 was final and cascaded KOR into M90, then an admin unchecked it.
      match('M73', 'r32', '2A', '2B', {
        team_a_code: 'KOR', team_b_code: 'SUI',
      }),
      match('M90', 'r16', 'W73', 'W75', { team_a_code: 'KOR' }),
    ];
    const writes = computeCascadeWrites(matches, {});
    expect(writes).toContainEqual({ id: 'M90', team_a_code: null, team_b_code: null });
  });

  it('clears R32 teams when a group result becomes incomplete again', () => {
    const matches = [match('M73', 'r32', '2A', '2B', {
      team_a_code: 'KOR', team_b_code: 'SUI',
    })];
    const standings = { A: { complete: false }, B: { complete: true, second: 'SUI' } };
    expect(computeCascadeWrites(matches, standings))
      .toContainEqual({ id: 'M73', team_a_code: null, team_b_code: null });
  });

  it('emits no write when the resolved teams already match the row', () => {
    const matches = [match('M73', 'r32', '2A', '2B', {
      team_a_code: 'KOR', team_b_code: 'SUI',
    })];
    const standings = {
      A: { complete: true, second: 'KOR' }, B: { complete: true, second: 'SUI' },
    };
    expect(computeCascadeWrites(matches, standings)).toEqual([]);
  });
});
