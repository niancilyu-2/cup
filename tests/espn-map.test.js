// ABOUTME: Tests for ESPN name→code mapping, status classification, event normalization.
// ABOUTME: Covers teamCodeFromEspn, classifyStatus, normalizeEspnEvent functions.
import { describe, it, expect } from 'vitest';
import { teamCodeFromEspn, classifyStatus, normalizeEspnEvent } from '../src/espn-map.js';

describe('teamCodeFromEspn', () => {
  it('maps canonical names to FIFA codes', () => {
    expect(teamCodeFromEspn('Mexico')).toBe('MEX');
    expect(teamCodeFromEspn('United States')).toBe('USA');
    expect(teamCodeFromEspn('Germany')).toBe('GER');
  });
  it('maps known ESPN aliases', () => {
    expect(teamCodeFromEspn('Korea Republic')).toBe('KOR');
    expect(teamCodeFromEspn('Czechia')).toBe('CZE');
    expect(teamCodeFromEspn('USA')).toBe('USA');
    expect(teamCodeFromEspn('Bosnia-Herzegovina')).toBe('BIH');
  });
  it('returns null for unknown names', () => {
    expect(teamCodeFromEspn('Atlantis')).toBe(null);
  });
});

describe('classifyStatus', () => {
  it('uses state + completed flag', () => {
    expect(classifyStatus({ state: 'pre', completed: false })).toBe('scheduled');
    expect(classifyStatus({ state: 'in', completed: false })).toBe('in_progress');
    expect(classifyStatus({ state: 'post', completed: true })).toBe('final');
  });
  it('treats post-but-not-completed (abandoned) as in_progress, not final', () => {
    expect(classifyStatus({ state: 'post', completed: false })).toBe('in_progress');
  });
});

describe('normalizeEspnEvent', () => {
  const event = {
    date: '2026-06-28T22:00Z',
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { displayName: 'Mexico' }, score: '2', winner: true },
        { homeAway: 'away', team: { displayName: 'Brazil' }, score: '1', winner: false },
      ],
      status: { type: { state: 'post', completed: true } },
    }],
  };
  it('flattens a final event', () => {
    expect(normalizeEspnEvent(event)).toEqual({
      dateUTC: '20260628',
      teamA: 'MEX', teamB: 'BRA',
      scoreA: 2, scoreB: 1,
      status: 'final',
      winnerCode: 'MEX',
    });
  });
  it('returns null winner for a draw', () => {
    const draw = structuredClone(event);
    draw.competitions[0].competitors[0].winner = false;
    draw.competitions[0].competitors[0].score = '1';
    expect(normalizeEspnEvent(draw).winnerCode).toBe(null);
  });
  it('keeps the regulation score but takes the winner flag for a penalty shootout', () => {
    // Real 2022 final: Argentina 3-3 France, decided on penalties. ESPN reports
    // the 3-3 regulation score and flags Argentina as the winner.
    const pens = structuredClone(event);
    pens.competitions[0].competitors[0].team.displayName = 'Argentina';
    pens.competitions[0].competitors[0].score = '3';
    pens.competitions[0].competitors[0].winner = true;
    pens.competitions[0].competitors[1].team.displayName = 'France';
    pens.competitions[0].competitors[1].score = '3';
    pens.competitions[0].competitors[1].winner = false;
    const n = normalizeEspnEvent(pens);
    expect(n.scoreA).toBe(3);
    expect(n.scoreB).toBe(3);
    expect(n.winnerCode).toBe('ARG');
  });
  it('returns null if a team name is unmappable', () => {
    const bad = structuredClone(event);
    bad.competitions[0].competitors[0].team.displayName = 'Atlantis';
    expect(normalizeEspnEvent(bad)).toBe(null);
  });
});
