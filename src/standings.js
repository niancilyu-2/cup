// ABOUTME: Computes a group's final table (FIFA tiebreakers 1-6) and ranks 3rd-place teams.
// ABOUTME: Tiebreakers 7-8 (fair play, drawing of lots) fall back to alphabetical by code.

function emptyRow(code) {
  return { code, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}

function tallyOverall(matches) {
  const rows = {};
  const ensure = (c) => (rows[c] ||= emptyRow(c));
  for (const x of matches) {
    if (!x.completed || x.score_a == null || x.score_b == null) continue;
    const a = ensure(x.team_a_code), b = ensure(x.team_b_code);
    a.played++; b.played++;
    a.gf += x.score_a; a.ga += x.score_b;
    b.gf += x.score_b; b.ga += x.score_a;
    if (x.score_a > x.score_b) { a.won++; b.lost++; a.pts += 3; }
    else if (x.score_a < x.score_b) { b.won++; a.lost++; b.pts += 3; }
    else { a.drawn++; b.drawn++; a.pts += 1; b.pts += 1; }
  }
  for (const r of Object.values(rows)) r.gd = r.gf - r.ga;
  return rows;
}

// Head-to-head mini-table among a set of tied team codes.
function headToHead(matches, codes) {
  const set = new Set(codes);
  const rows = {};
  codes.forEach((c) => (rows[c] = emptyRow(c)));
  for (const x of matches) {
    if (!x.completed || x.score_a == null || x.score_b == null) continue;
    if (!set.has(x.team_a_code) || !set.has(x.team_b_code)) continue;
    const a = rows[x.team_a_code], b = rows[x.team_b_code];
    a.gf += x.score_a; a.ga += x.score_b;
    b.gf += x.score_b; b.ga += x.score_a;
    if (x.score_a > x.score_b) a.pts += 3;
    else if (x.score_a < x.score_b) b.pts += 3;
    else { a.pts += 1; b.pts += 1; }
  }
  for (const r of Object.values(rows)) r.gd = r.gf - r.ga;
  return rows;
}

function compareOverall(a, b) {
  if (b.pts !== a.pts) return b.pts - a.pts;
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return 0; // still tied → caller applies head-to-head
}

function sortGroup(rows, matches) {
  const all = Object.values(rows);
  all.sort(compareOverall);
  // Resolve clusters that are equal on pts/gd/gf via head-to-head, then alpha.
  const out = [];
  let i = 0;
  while (i < all.length) {
    let j = i + 1;
    while (j < all.length && compareOverall(all[i], all[j]) === 0) j++;
    const cluster = all.slice(i, j);
    if (cluster.length === 1) {
      out.push(cluster[0]);
    } else {
      const h2h = headToHead(matches, cluster.map((r) => r.code));
      cluster.sort((x, y) => {
        const hx = h2h[x.code], hy = h2h[y.code];
        if (hy.pts !== hx.pts) return hy.pts - hx.pts;
        if (hy.gd !== hx.gd) return hy.gd - hx.gd;
        if (hy.gf !== hx.gf) return hy.gf - hx.gf;
        return x.code < y.code ? -1 : 1; // tiebreaker 7-8 fallback: alphabetical
      });
      out.push(...cluster);
    }
    i = j;
  }
  return out;
}

export function computeGroupStandings(matches) {
  const completed = matches.filter(
    (x) => x.completed && x.score_a != null && x.score_b != null,
  );
  const complete = completed.length === 6;
  const rows = tallyOverall(matches);
  const table = sortGroup(rows, matches);
  return {
    complete,
    table,
    first:  complete ? table[0]?.code ?? null : null,
    second: complete ? table[1]?.code ?? null : null,
    third:  complete ? table[2]?.code ?? null : null,
    fourth: complete ? table[3]?.code ?? null : null,
    thirdStats: complete && table[2]
      ? { pts: table[2].pts, gd: table[2].gd, gf: table[2].gf }
      : null,
  };
}

// Rank the 3rd-place teams across all 12 complete groups; return the 8 best
// group letters, sorted alphabetically (so the result feeds lookupAssignment).
export function bestEightThirdGroups(standingsByGroup) {
  const entries = Object.entries(standingsByGroup)
    .filter(([, s]) => s.complete && s.thirdStats)
    .map(([g, s]) => ({ g, ...s.thirdStats }));
  entries.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.g < b.g ? -1 : 1; // fair play / lots fallback: alphabetical
  });
  return entries.slice(0, 8).map((e) => e.g).sort();
}
