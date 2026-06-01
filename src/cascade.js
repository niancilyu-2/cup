// ABOUTME: Resolves R32/knockout slot labels into concrete team-code writes.
// ABOUTME: Pure — takes current match state + group standings, returns minimal diffs.

import { bestEightThirdGroups } from './standings.js';
import { lookupAssignment } from './wildcards.js';

const GROUP_SLOT = /^([12])([A-L])$/;
const WILDCARD_SLOT = /^3[A-L](?:\/[A-L])*$/;
const WINNER_SLOT = /^W(\d+)$/;
const LOSER_SLOT = /^L(\d+)$/;

function loserCode(match) {
  if (!match.completed || !match.winner_code) return null;
  if (match.team_a_code === match.winner_code) return match.team_b_code || null;
  if (match.team_b_code === match.winner_code) return match.team_a_code || null;
  return null;
}

function resolveSlot(slot, ctx) {
  let g = GROUP_SLOT.exec(slot);
  if (g) {
    const [, rank, group] = g;
    const s = ctx.standingsByGroup[group];
    if (!s || !s.complete) return null;
    return (rank === '1' ? s.first : s.second) || null;
  }
  if (WILDCARD_SLOT.test(slot)) {
    const group = ctx.wildcardAssignment?.[ctx.currentMatchId];
    if (!group) return null;
    const s = ctx.standingsByGroup[group];
    return (s && s.complete && s.third) || null;
  }
  let w = WINNER_SLOT.exec(slot);
  if (w) {
    const src = ctx.byId[`M${w[1]}`];
    return (src && src.completed && src.winner_code) || null;
  }
  let l = LOSER_SLOT.exec(slot);
  if (l) {
    const src = ctx.byId[`M${l[1]}`];
    return src ? loserCode(src) : null;
  }
  return null;
}

export function computeCascadeWrites(matches, standingsByGroup) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));

  // Wildcard assignment is available only once all 12 groups are complete.
  let wildcardAssignment = null;
  const allComplete = 'ABCDEFGHIJKL'.split('')
    .every((g) => standingsByGroup[g] && standingsByGroup[g].complete);
  if (allComplete) {
    const best = bestEightThirdGroups(standingsByGroup);
    wildcardAssignment = lookupAssignment(best);
  }

  const writes = [];
  for (const m of matches) {
    if (m.stage === 'group') continue;
    const ctx = { standingsByGroup, byId, wildcardAssignment, currentMatchId: m.id };
    const a = resolveSlot(m.slot_a, ctx);
    const b = resolveSlot(m.slot_b, ctx);

    // For group-based or wildcard slots, require both to resolve before writing.
    const slotAIsGroupBased = GROUP_SLOT.test(m.slot_a) || WILDCARD_SLOT.test(m.slot_a);
    const slotBIsGroupBased = GROUP_SLOT.test(m.slot_b) || WILDCARD_SLOT.test(m.slot_b);
    if ((slotAIsGroupBased && a == null) || (slotBIsGroupBased && b == null)) continue;

    // Only proceed if at least one slot resolved to a value.
    if (a == null && b == null) continue;
    const nextA = a ?? m.team_a_code ?? null;
    const nextB = b ?? m.team_b_code ?? null;
    // Skip if nothing changed.
    if (nextA === (m.team_a_code ?? null) && nextB === (m.team_b_code ?? null)) continue;
    writes.push({ id: m.id, team_a_code: nextA, team_b_code: nextB });
  }
  return writes;
}
