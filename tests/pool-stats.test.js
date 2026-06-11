// ABOUTME: Tests for the Pool Stats aggregators — favorites, matchups, divisiveness,
// ABOUTME: group chaos, and contrarian picks, including ties and degenerate inputs.

import { describe, it, expect } from 'vitest';
import {
  championFavorites, finalMatchups, divisiveMatches, divisiveGroups, contrarianPicks,
} from '../src/pool-stats.js';

// Build Map<playerId, picks> from a compact spec: { p1: { bracket: {...}, groups: {...} } }
function players(spec) {
  const map = new Map();
  for (const [id, p] of Object.entries(spec)) {
    map.set(id, { groups: p.groups || {}, bracket: p.bracket || {}, tiebreaker: null });
  }
  return map;
}

const champ = (code) => ({ bracket: { M104: code } });

describe('championFavorites', () => {
  it('ranks teams by pick count with an Other bucket', () => {
    const picks = players({
      a: champ('BRA'), b: champ('BRA'), c: champ('BRA'),
      d: champ('ARG'), e: champ('ARG'),
      f: champ('FRA'), g: champ('ENG'), h: champ('JPN'), i: champ('MAR'),
    });
    const r = championFavorites(picks, { top: 4 });
    expect(r.totalPickers).toBe(9);
    expect(r.entries.map((e) => e.code)).toEqual(['BRA', 'ARG', 'ENG', 'FRA']);
    expect(r.entries[0].share).toBeCloseTo(3 / 9);
    expect(r.other).toEqual({ count: 2, share: 2 / 9 }); // JPN + MAR
  });

  it('returns other=null when distinct teams fit in top N', () => {
    const r = championFavorites(players({ a: champ('BRA'), b: champ('ARG') }), { top: 4 });
    expect(r.other).toBeNull();
    expect(r.entries).toHaveLength(2);
  });

  it('breaks count ties by code for determinism', () => {
    const r = championFavorites(players({ a: champ('FRA'), b: champ('ARG') }));
    expect(r.entries.map((e) => e.code)).toEqual(['ARG', 'FRA']);
  });

  it('handles zero and one pickers', () => {
    expect(championFavorites(new Map())).toEqual({ totalPickers: 0, entries: [], other: null });
    const r = championFavorites(players({ a: champ('BRA'), b: {} }));
    expect(r.totalPickers).toBe(1);
    expect(r.entries[0]).toEqual({ code: 'BRA', count: 1, share: 1 });
  });
});

describe('finalMatchups', () => {
  it('counts ordered SF-winner pairs', () => {
    const picks = players({
      a: { bracket: { M101: 'BRA', M102: 'ARG' } },
      b: { bracket: { M101: 'BRA', M102: 'ARG' } },
      c: { bracket: { M101: 'FRA', M102: 'ARG' } },
    });
    const r = finalMatchups(picks);
    expect(r.totalPickers).toBe(3);
    expect(r.entries[0]).toEqual({ a: 'BRA', b: 'ARG', count: 2, share: 2 / 3 });
  });

  it('excludes players missing either SF pick', () => {
    const r = finalMatchups(players({
      a: { bracket: { M101: 'BRA' } },
      b: { bracket: { M101: 'BRA', M102: 'ARG' } },
    }));
    expect(r.totalPickers).toBe(1);
  });

  it('handles no pickers', () => {
    expect(finalMatchups(new Map())).toEqual({ totalPickers: 0, entries: [] });
  });
});

describe('divisiveMatches', () => {
  it('ranks an even split above a lopsided one', () => {
    const picks = players({
      a: { bracket: { M89: 'USA', M90: 'BRA' } },
      b: { bracket: { M89: 'GER', M90: 'BRA' } },
      c: { bracket: { M89: 'USA', M90: 'BRA' } },
      d: { bracket: { M89: 'GER', M90: 'NED' } },
    });
    const r = divisiveMatches(picks);
    expect(r[0].matchId).toBe('M89'); // 2-2 split (margin 0) beats 3-1 (margin 0.5)
    expect(r[0].margin).toBe(0);
    expect(r[1].matchId).toBe('M90');
  });

  it('computes 3-way margins from the top two options', () => {
    const spec = {};
    // 5 USA, 4 GER, 3 FRA in M104 → margin (5-4)/12
    for (let i = 0; i < 5; i++) spec[`u${i}`] = champ('USA');
    for (let i = 0; i < 4; i++) spec[`g${i}`] = champ('GER');
    for (let i = 0; i < 3; i++) spec[`f${i}`] = champ('FRA');
    const r = divisiveMatches(players(spec), { top: 1 });
    expect(r[0].matchId).toBe('M104');
    expect(r[0].margin).toBeCloseTo(1 / 12);
    expect(r[0].options).toHaveLength(3);
  });

  it('excludes unanimous matches and single pickers', () => {
    const r = divisiveMatches(players({
      a: { bracket: { M89: 'USA', M90: 'BRA' } },
      b: { bracket: { M89: 'USA' } },
    }));
    expect(r).toEqual([]); // M89 unanimous, M90 single picker
  });

  it('breaks margin ties by deeper stage', () => {
    const picks = players({
      a: { bracket: { M89: 'USA', M104: 'BRA' } },
      b: { bracket: { M89: 'GER', M104: 'ARG' } },
    });
    const r = divisiveMatches(picks);
    expect(r[0].matchId).toBe('M104'); // both margin 0, final outranks r16
  });
});

describe('divisiveGroups', () => {
  const TEAMS = { A: ['MEX', 'KOR', 'CZE', 'RSA'] };
  const order = (first, second, third, advances = false) => ({
    groups: { A: { first, second, third, advances } },
  });

  it('scores 0 chaos for a unanimous group', () => {
    const r = divisiveGroups(players({
      a: order('MEX', 'KOR', 'CZE'),
      b: order('MEX', 'KOR', 'CZE'),
    }), TEAMS);
    expect(r[0].chaos).toBe(0);
    expect(r[0].uniqueOrderings).toBe(1);
    expect(r[0].topOrderings[0].order).toEqual(['MEX', 'KOR', 'CZE', 'RSA']);
  });

  it('scores 100 chaos when every ordering differs', () => {
    const r = divisiveGroups(players({
      a: order('MEX', 'KOR', 'CZE'),
      b: order('KOR', 'MEX', 'CZE'),
      c: order('CZE', 'RSA', 'MEX'),
      d: order('RSA', 'CZE', 'KOR'),
    }), TEAMS);
    expect(r[0].chaos).toBe(100);
    expect(r[0].uniqueOrderings).toBe(4);
  });

  it('skips incomplete or invalid orderings and computes the implied 4th', () => {
    const r = divisiveGroups(players({
      a: order('MEX', 'KOR', 'CZE'),
      b: order('MEX', null, 'CZE'),          // incomplete
      c: order('MEX', 'MEX', 'CZE'),         // duplicate
      d: order('MEX', 'BRA', 'CZE'),         // BRA not in group A
    }), TEAMS);
    expect(r[0].totalPickers).toBe(1);
    expect(r[0].chaos).toBe(0); // < 2 valid orderings
    expect(r[0].topOrderings[0].order[3]).toBe('RSA');
  });

  it('reports first favorite, top-two race, and wildcard share', () => {
    const r = divisiveGroups(players({
      a: order('MEX', 'KOR', 'CZE', true),
      b: order('MEX', 'CZE', 'KOR', false),
      c: order('MEX', 'KOR', 'CZE', true),
    }), TEAMS);
    const g = r[0];
    expect(g.firstFavorite).toEqual({ code: 'MEX', share: 1 });
    // top-two counts: MEX 3, KOR 2, CZE 1 → race = ranks 2-3 = KOR, CZE
    expect(g.topTwoRace.map((t) => t.code)).toEqual(['KOR', 'CZE']);
    expect(g.wildcard).toEqual({ code: 'CZE', share: 2 / 3 });
  });

  it('returns wildcard null when nobody flags the group', () => {
    const r = divisiveGroups(players({ a: order('MEX', 'KOR', 'CZE') }), TEAMS);
    expect(r[0].wildcard).toBeNull();
  });
});

describe('contrarianPicks', () => {
  it('includes rare claims and excludes popular ones', () => {
    const spec = {};
    for (let i = 0; i < 9; i++) spec[`p${i}`] = champ('BRA'); // 90% BRA
    spec.solo = champ('JPN');                                 // 10% JPN
    const r = contrarianPicks(players(spec));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: 'JPN', depth: 'champion', count: 1 });
    expect(r[0].pickerIds).toEqual(['solo']);
    expect(r[0].share).toBeCloseTo(0.1);
  });

  it('suppresses shallower claims for the same player+team', () => {
    const spec = {};
    for (let i = 0; i < 9; i++) {
      spec[`p${i}`] = { bracket: { M104: 'BRA', M101: 'BRA', M102: 'ARG' } };
    }
    spec.solo = { bracket: { M104: 'JPN', M101: 'JPN', M102: 'ARG' } };
    const r = contrarianPicks(players(spec));
    // solo's JPN final claim is subsumed by the champion claim: JPN appears once.
    const jpn = r.filter((e) => e.code === 'JPN');
    expect(jpn).toHaveLength(1);
    expect(jpn[0].depth).toBe('champion');
  });

  it('sorts by rarity then depth and respects the cap', () => {
    const spec = {};
    for (let i = 0; i < 8; i++) {
      spec[`p${i}`] = { bracket: { M104: 'BRA', M89: 'USA' } };
    }
    spec.x = { bracket: { M104: 'JPN', M89: 'HAI' } };
    spec.y = { bracket: { M104: 'JPN', M89: 'CUW' } };
    const r = contrarianPicks(players(spec), { top: 2 });
    expect(r).toHaveLength(2);
    // HAI/CUW qf claims (1/10 each) are rarer than JPN champion (2/10).
    expect(r.map((e) => e.code)).toEqual(['CUW', 'HAI']);
  });

  it('handles empty input', () => {
    expect(contrarianPicks(new Map())).toEqual([]);
  });
});
