// ABOUTME: Projects each player's still-reachable maximum score from real results.
// ABOUTME: A knockout pick only counts toward the max if that team can still reach the match.

import { lookupAssignment, WILDCARD_SLOTS, ALL_GROUPS } from './wildcards.js';
import { STAGE_POINTS } from './scoring.js';

const FINAL_MATCH_ID = 'M104';

// For each knockout match, the set of teams that could still appear in it given
// the results so far. A decided feeder collapses to its winner; an undecided
// feeder expands to every team still able to fill it. Group slots resolve to the
// finishing team once the group is complete, otherwise to every team in that
// group; wildcard slots resolve once all groups are complete.
export function buildReachability(matches, results) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));

  const groupTeams = {};
  for (const m of matches) {
    if (m.stage === 'group' && m.group_code) {
      const set = (groupTeams[m.group_code] ||= new Set());
      if (m.team_a_code) set.add(m.team_a_code);
      if (m.team_b_code) set.add(m.team_b_code);
    }
  }

  let wildcardSlotForGroup = {};
  const allGroupsDecided = Object.keys(results.groupOutcomes).length === 12;
  if (allGroupsDecided) {
    const advancing = ALL_GROUPS.filter((g) => results.groupOutcomes[g]?.third_advances).sort();
    if (advancing.length === 8) {
      const assignment = lookupAssignment(advancing);
      if (assignment) {
        for (const [mid, g] of Object.entries(assignment)) wildcardSlotForGroup[g] = mid;
      }
    }
  }

  const cache = {};
  function participants(matchId) {
    if (matchId in cache) return cache[matchId];
    cache[matchId] = new Set(); // cycle guard; overwritten below
    const m = byId[matchId];
    const set = new Set();
    if (m && m.stage !== 'group') {
      for (const t of slotTeams(matchId, m.slot_a)) set.add(t);
      for (const t of slotTeams(matchId, m.slot_b)) set.add(t);
    }
    cache[matchId] = set;
    return set;
  }

  function winnersOf(matchId) {
    const r = results.matchResults[matchId];
    if (r && r.played && r.winner) return new Set([r.winner]);
    return participants(matchId);
  }

  function losersOf(matchId) {
    const ps = participants(matchId);
    const r = results.matchResults[matchId];
    if (r && r.played && r.winner) {
      const out = new Set(ps);
      out.delete(r.winner);
      return out;
    }
    return ps;
  }

  function slotTeams(matchId, label) {
    if (!label) return [];
    if (/^[12][A-L]$/.test(label)) {
      const g = label[1];
      const o = results.groupOutcomes[g];
      if (o) return [label[0] === '1' ? o.first : o.second].filter(Boolean);
      return [...(groupTeams[g] || [])];
    }
    if (label.startsWith('3')) {
      const slot = WILDCARD_SLOTS.find((s) => s.matchId === matchId);
      if (!slot) return [];
      if (allGroupsDecided) {
        for (const g of slot.eligible) {
          if (wildcardSlotForGroup[g] === matchId) {
            return [results.groupOutcomes[g]?.third].filter(Boolean);
          }
        }
        return [];
      }
      const out = [];
      for (const g of slot.eligible) out.push(...(groupTeams[g] || []));
      return out;
    }
    if (label.startsWith('W')) return [...winnersOf(`M${label.slice(1)}`)];
    if (label.startsWith('L')) return [...losersOf(`M${label.slice(1)}`)];
    return [];
  }

  return { participants };
}

// A team is out of contention once it can no longer reach the final.
export function isOutOfContention(reach, teamCode) {
  if (!teamCode) return false;
  return !reach.participants(FINAL_MATCH_ID).has(teamCode);
}

// Points already banked, plus every still-winnable point on viable picks:
// filled group slots in undecided groups, wildcard upside before the group stage
// resolves, and knockout picks whose team can still reach that match.
export function maxPossible({ breakdown, picks, results, matches, reach }) {
  let max = breakdown.total;

  const decidedGroups = new Set(Object.keys(results.groupOutcomes));
  for (const g of ALL_GROUPS) {
    if (decidedGroups.has(g)) continue;
    const gp = picks.groups[g];
    if (!gp) continue;
    if (gp.first) max += 1;
    if (gp.second) max += 1;
  }

  if (decidedGroups.size < 12) {
    const flagged = Object.values(picks.groups).filter((g) => g.advances).length;
    max += Math.min(8, flagged) - (breakdown.wildcards || 0);
  }

  for (const m of matches) {
    if (m.stage === 'group') continue;
    const r = results.matchResults[m.id];
    if (r && r.played) continue;
    const pick = picks.bracket[m.id];
    if (!pick) continue;
    if (!reach.participants(m.id).has(pick)) continue;
    max += STAGE_POINTS[m.stage] || 0;
  }
  return max;
}
