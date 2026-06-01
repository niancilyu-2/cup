// ABOUTME: Derives the {groupOutcomes, matchResults} scoring shape from raw match rows.
// ABOUTME: Shared by the leaderboard, picks page, and live-scores page.

import { computeGroupStandings, bestEightThirdGroups } from './standings.js';
import { ALL_GROUPS } from './wildcards.js';

// A group contributes outcomes only once all six of its games are complete; the
// eight advancing third-place teams are known only once every group is complete.
export function buildTournamentResults(matches) {
  const byGroup = {};
  for (const m of matches) {
    if (m.stage === 'group' && m.group_code) (byGroup[m.group_code] ||= []).push(m);
  }
  const standings = {};
  for (const [g, ms] of Object.entries(byGroup)) standings[g] = computeGroupStandings(ms);

  const allGroupsComplete = ALL_GROUPS.every((g) => standings[g]?.complete);
  const advancing = allGroupsComplete ? new Set(bestEightThirdGroups(standings)) : new Set();

  const groupOutcomes = {};
  for (const g of ALL_GROUPS) {
    const s = standings[g];
    if (!s || !s.complete) continue;
    groupOutcomes[g] = {
      first: s.first,
      second: s.second,
      third: s.third,
      third_advances: advancing.has(g),
    };
  }

  const matchResults = {};
  for (const m of matches) {
    if (m.stage === 'group') continue;
    if (m.completed && m.winner_code) {
      matchResults[m.id] = { winner: m.winner_code, played: true };
    }
  }
  return { groupOutcomes, matchResults };
}
