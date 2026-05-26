// ABOUTME: Renders the leaderboard table from a synthetic dataset.
// ABOUTME: Placeholder — gets replaced by real scoring engine in Phase 3.

(() => {
  const STORAGE_KEY_PLAYER = 'wcbracket.player';

  const MOCK = [
    { rank: 1,  name: 'Reid',    champion: { code: 'br',     name: 'Brazil' },      points: 142, tiebreaker: 2.4 },
    { rank: 2,  name: 'Nianci',  champion: { code: 'fr',     name: 'France' },      points: 138, tiebreaker: 1.8 },
    { rank: 3,  name: 'Alex',    champion: { code: 'ar',     name: 'Argentina' },   points: 131, tiebreaker: 2.1 },
    { rank: 4,  name: 'Sam',     champion: { code: 'es',     name: 'Spain' },       points: 124, tiebreaker: 2.0 },
    { rank: 5,  name: 'Jordan',  champion: { code: 'br',     name: 'Brazil' },      points: 118, tiebreaker: 2.5 },
    { rank: 6,  name: 'Casey',   champion: { code: 'pt',     name: 'Portugal' },    points: 112, tiebreaker: 1.9 },
    { rank: 7,  name: 'Priya',   champion: { code: 'gb-eng', name: 'England' },     points: 108, tiebreaker: 1.7 },
    { rank: 8,  name: 'Dosan',   champion: { code: 'de',     name: 'Germany' },     points: 99,  tiebreaker: 1.5 },
    { rank: 9,  name: 'Maria',   champion: { code: 'nl',     name: 'Netherlands' }, points: 88,  tiebreaker: 2.2 },
    { rank: 10, name: 'Tomás',   champion: { code: 'ar',     name: 'Argentina' },   points: 76,  tiebreaker: 1.9 },
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
        <td class="lb-col-pts">${p.points}</td>
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
