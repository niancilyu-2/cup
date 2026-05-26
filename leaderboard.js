// ABOUTME: Renders the leaderboard table from a synthetic dataset.
// ABOUTME: Placeholder — gets replaced by real scoring engine in Phase 3.

(() => {
  const STORAGE_KEY_PLAYER = 'wcbracket.player';

  const MOCK = [
    {
      rank: 1, name: 'Reid', champion: { code: 'br', name: 'Brazil' },
      points: 112, tiebreaker: 2.4,
      breakdown: { groups: 19, r32: 26, r16: 26, qf: 15, sf: 16, final: 10 },
    },
    {
      rank: 2, name: 'Nianci', champion: { code: 'fr', name: 'France' },
      points: 111, tiebreaker: 1.8,
      breakdown: { groups: 21, r32: 24, r16: 20, qf: 20, sf: 16, final: 10 },
    },
    {
      rank: 3, name: 'Alex', champion: { code: 'ar', name: 'Argentina' },
      points: 101, tiebreaker: 2.1,
      breakdown: { groups: 18, r32: 22, r16: 20, qf: 15, sf: 16, final: 10 },
    },
    {
      rank: 4, name: 'Sam', champion: { code: 'es', name: 'Spain' },
      points: 100, tiebreaker: 2.0,
      breakdown: { groups: 17, r32: 22, r16: 20, qf: 15, sf: 16, final: 10 },
    },
    {
      rank: 5, name: 'Casey', champion: { code: 'pt', name: 'Portugal' },
      points: 93, tiebreaker: 1.9,
      breakdown: { groups: 16, r32: 20, r16: 16, qf: 15, sf: 16, final: 10 },
    },
    {
      rank: 6, name: 'Jordan', champion: { code: 'br', name: 'Brazil' },
      points: 93, tiebreaker: 2.5,
      breakdown: { groups: 16, r32: 20, r16: 16, qf: 15, sf: 16, final: 10 },
    },
    {
      rank: 7, name: 'Priya', champion: { code: 'gb-eng', name: 'England' },
      points: 90, tiebreaker: 1.7,
      breakdown: { groups: 15, r32: 18, r16: 16, qf: 15, sf: 16, final: 10 },
    },
    {
      rank: 8, name: 'Dosan', champion: { code: 'de', name: 'Germany' },
      points: 80, tiebreaker: 1.5,
      breakdown: { groups: 14, r32: 18, r16: 12, qf: 10, sf: 16, final: 10 },
    },
    {
      rank: 9, name: 'Maria', champion: { code: 'nl', name: 'Netherlands' },
      points: 67, tiebreaker: 2.2,
      breakdown: { groups: 13, r32: 16, r16: 12, qf: 10, sf: 16, final: 0 },
    },
    {
      rank: 10, name: 'Tomás', champion: { code: 'ar', name: 'Argentina' },
      points: 66, tiebreaker: 1.9,
      breakdown: { groups: 12, r32: 14, r16: 12, qf: 10, sf: 8, final: 10 },
    },
  ];

  // Each stage row in the breakdown popover. Order is the same order results
  // come in during the tournament; "max" is the worst-case earned for that
  // stage so users can read "19/24" as a fraction.
  const BREAKDOWN_ROWS = [
    { key: 'groups', label: 'Group standings', max: 24 },
    { key: 'r32',    label: 'R32 winners',     max: 32 },
    { key: 'r16',    label: 'R16 winners',     max: 32 },
    { key: 'qf',     label: 'Quarterfinals',   max: 20 },
    { key: 'sf',     label: 'Semifinals',      max: 16 },
    { key: 'final',  label: 'Final',           max: 10 },
  ];

  const root = document.getElementById('leaderboard');
  if (!root) return;

  let myName = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAYER);
    if (raw) myName = (JSON.parse(raw).name || '').toLowerCase();
  } catch {}

  root.innerHTML = `
    <div class="lb-preview-badge">Preview · synthetic data</div>
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-col-rank">#</th>
          <th class="lb-col-name">Player</th>
          <th class="lb-col-champ">Champion pick</th>
          <th class="lb-col-pts">Pts</th>
          <th class="lb-col-tb">Tiebreaker</th>
        </tr>
      </thead>
      <tbody>
        ${MOCK.map((p) => rowHTML(p, myName)).join('')}
      </tbody>
    </table>
  `;

  function breakdownHTML(p) {
    const b = p.breakdown;
    if (!b) return '';
    const rows = BREAKDOWN_ROWS.map((r) => `
      <div class="lb-bd-row">
        <span class="lb-bd-label">${r.label}</span>
        <span class="lb-bd-val">${b[r.key]} <span class="lb-bd-max">/ ${r.max}</span></span>
      </div>
    `).join('');
    return `
      <div class="lb-breakdown" role="tooltip">
        <div class="lb-bd-title">Score breakdown</div>
        ${rows}
        <div class="lb-bd-total">
          <span>Total</span>
          <span>${p.points}</span>
        </div>
      </div>`;
  }

  function rowHTML(p, myNameLower) {
    const isLeader = p.rank === 1;
    const isMe = myNameLower && p.name.toLowerCase() === myNameLower;
    const classes = ['lb-row'];
    if (isLeader) classes.push('lb-leader');
    if (isMe) classes.push('lb-me');
    return `
      <tr class="${classes.join(' ')}">
        <td class="lb-col-rank"><span class="lb-rank-num">${p.rank}</span></td>
        <td class="lb-col-name">
          ${escapeHtml(p.name)}${isMe ? ' <span class="lb-you-pill">you</span>' : ''}
        </td>
        <td class="lb-col-champ">
          <span class="fi fi-${p.champion.code} lb-flag" aria-hidden="true"></span>
          <span class="lb-champ-name">${escapeHtml(p.champion.name)}</span>
        </td>
        <td class="lb-col-pts" tabindex="0" aria-label="${p.points} points — hover or focus for breakdown">
          <span class="lb-pts-total">${p.points}</span>
          ${breakdownHTML(p)}
        </td>
        <td class="lb-col-tb">${p.tiebreaker.toFixed(1)} <span class="lb-tb-unit">g/g</span></td>
      </tr>
    `;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
