// ABOUTME: Core application logic for WC 2026 bracket pick'em.
// ABOUTME: Handles self-signup, picks, lock logic, leaderboard, and bracket rendering.

const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00'; // Mexico vs South Africa kickoff
const STORAGE_KEY_PLAYER = 'wcbracket.player';

const supabase = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY,
);

const state = {
  player: null,
  groups: [],
  teams: [],
  matches: [],
  teamsByGroup: {},
  teamsByCode: {},
  picks: {
    groups: {},  // { groupCode: { first, second } }
    r32: {},     // { matchId: { a: teamCode, b: teamCode } }
    bracket: {}, // { matchId: winnerCode } — for r16+ matches
  },
};

// FIFA 3-letter code → ISO 3166-1 alpha-2 (used by lipis/flag-icons).
// gb-eng/gb-sct are valid library subregion codes.
const FIFA_TO_ISO = {
  MEX: 'mx', RSA: 'za', KOR: 'kr', CZE: 'cz',
  CAN: 'ca', BIH: 'ba', QAT: 'qa', SUI: 'ch',
  BRA: 'br', MAR: 'ma', HAI: 'ht', SCO: 'gb-sct',
  USA: 'us', PAR: 'py', AUS: 'au', TUR: 'tr',
  GER: 'de', CUW: 'cw', CIV: 'ci', ECU: 'ec',
  NED: 'nl', JPN: 'jp', SWE: 'se', TUN: 'tn',
  BEL: 'be', EGY: 'eg', IRN: 'ir', NZL: 'nz',
  ESP: 'es', CPV: 'cv', KSA: 'sa', URU: 'uy',
  FRA: 'fr', SEN: 'sn', IRQ: 'iq', NOR: 'no',
  ARG: 'ar', ALG: 'dz', AUT: 'at', JOR: 'jo',
  POR: 'pt', COD: 'cd', UZB: 'uz', COL: 'co',
  ENG: 'gb-eng', CRO: 'hr', GHA: 'gh', PAN: 'pa',
};

function flagHTML(teamCode) {
  const iso = FIFA_TO_ISO[teamCode];
  return iso ? `<span class="fi fi-${iso}"></span>` : '';
}

function isLocked() {
  return new Date() >= new Date(LOCK_DATE_ISO);
}

function getStoredPlayer() {
  const raw = localStorage.getItem(STORAGE_KEY_PLAYER);
  return raw ? JSON.parse(raw) : null;
}

function setStoredPlayer(player) {
  localStorage.setItem(STORAGE_KEY_PLAYER, JSON.stringify(player));
}

function clearStoredPlayer() {
  localStorage.removeItem(STORAGE_KEY_PLAYER);
}

// ---------- Player picker (signup + switch) ----------

async function loadPlayers() {
  const { data, error } = await supabase
    .from('players')
    .select('id, name')
    .order('name');
  if (error) {
    console.error('Failed to load players', error);
    return [];
  }
  return data;
}

function showPlayerPicker() {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');

    const renderPickerList = (players) => {
      root.innerHTML = `
        <div class="modal-overlay">
          <div class="modal">
            <h2>Who are you?</h2>
            ${
              players.length
                ? `<p>Pick yourself from the list, or add a new player.</p>
                   <ul class="player-list">
                     ${players
                       .map(
                         (p) => `
                       <li><button type="button" class="player-pick" data-id="${p.id}" data-name="${p.name}">${p.name}</button></li>`,
                       )
                       .join('')}
                   </ul>
                   <hr class="modal-divider" />`
                : `<p>No players yet. Add yourself to get started.</p>`
            }
            <button type="button" class="link-button" id="add-new-player">+ New player</button>
          </div>
        </div>
      `;
      root.querySelectorAll('.player-pick').forEach((btn) => {
        btn.addEventListener('click', () => {
          const player = { id: btn.dataset.id, name: btn.dataset.name };
          setStoredPlayer(player);
          root.innerHTML = '';
          resolve(player);
        });
      });
      document.getElementById('add-new-player').addEventListener('click', renderNewForm);
    };

    const renderNewForm = () => {
      root.innerHTML = `
        <div class="modal-overlay">
          <div class="modal">
            <h2>New player</h2>
            <p>Pick a display name. Names are unique across the site.</p>
            <form id="signup-form">
              <input id="signup-name" type="text" maxlength="30" placeholder="Your name" required autofocus />
              <button type="submit">Enter</button>
              <p id="signup-error" class="error" hidden></p>
            </form>
            <button type="button" class="link-button" id="back-to-list">← back to list</button>
          </div>
        </div>
      `;
      const form = document.getElementById('signup-form');
      const errorEl = document.getElementById('signup-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const name = document.getElementById('signup-name').value.trim();
        if (!name) return;
        const { data, error } = await supabase
          .from('players')
          .insert({ name })
          .select()
          .single();
        if (error) {
          errorEl.textContent =
            error.code === '23505'
              ? `"${name}" is already taken. Try another name.`
              : `Couldn't add you: ${error.message}`;
          errorEl.hidden = false;
          return;
        }
        setStoredPlayer({ id: data.id, name: data.name });
        root.innerHTML = '';
        resolve(data);
      });
      document.getElementById('back-to-list').addEventListener('click', async () => {
        renderPickerList(await loadPlayers());
      });
    };

    loadPlayers().then(renderPickerList);
  });
}

// ---------- Data loading ----------

async function loadReferenceData() {
  const [{ data: groups }, { data: teams }, { data: matches }] = await Promise.all([
    supabase.from('groups').select('*').order('code'),
    supabase.from('teams').select('*').order('code'),
    supabase.from('matches').select('*').order('id'),
  ]);
  state.groups = groups;
  state.teams = teams;
  state.matches = matches;
  state.teamsByGroup = teams.reduce((acc, t) => {
    (acc[t.group_code] ||= []).push(t);
    return acc;
  }, {});
  state.teamsByCode = Object.fromEntries(teams.map((t) => [t.code, t]));
}

async function loadMyPicks() {
  const [groupRes, r32Res, brktRes] = await Promise.all([
    supabase.from('group_picks').select('*').eq('player_id', state.player.id),
    supabase.from('r32_draft').select('*').eq('player_id', state.player.id),
    supabase.from('bracket_picks').select('*').eq('player_id', state.player.id),
  ]);
  state.picks.groups = {};
  state.picks.r32 = {};
  state.picks.bracket = {};
  if (!groupRes.error) {
    for (const row of groupRes.data) {
      state.picks.groups[row.group_code] = {
        first: row.first_code,
        second: row.second_code,
      };
    }
  }
  if (!r32Res.error) {
    for (const row of r32Res.data) {
      const { matchId, position } = slotToMatch(row.slot_index);
      (state.picks.r32[matchId] ||= { a: null, b: null })[position] = row.team_code;
    }
  }
  if (!brktRes.error) {
    for (const row of brktRes.data) {
      state.picks.bracket[row.match_id] = row.winner_code;
    }
  }
}

// ---------- Bracket helpers ----------

// Map between the r32_draft slot_index (1..32) and (matchId, position).
// Slot 1 = M73.a, 2 = M73.b, 3 = M74.a, 4 = M74.b, ..., 31 = M88.a, 32 = M88.b.
function slotToMatch(slotIndex) {
  const matchIndex = Math.floor((slotIndex - 1) / 2); // 0..15
  const position = (slotIndex - 1) % 2 === 0 ? 'a' : 'b';
  return { matchId: `M${73 + matchIndex}`, position };
}

function matchToSlot(matchId, position) {
  const matchIndex = parseInt(matchId.slice(1), 10) - 73;
  return matchIndex * 2 + (position === 'a' ? 1 : 2);
}

// Resolve which team is in a given match's a/b slot.
// Recurses for R16+ via the WXX / LXX labels in the matches table.
function teamForSlot(matchId, position) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return null;
  if (match.stage === 'r32') {
    return state.picks.r32[matchId]?.[position] || null;
  }
  const label = position === 'a' ? match.slot_a : match.slot_b;
  if (label.startsWith('W')) {
    const priorId = `M${label.slice(1)}`;
    return state.picks.bracket[priorId] || null;
  }
  if (label.startsWith('L')) {
    const priorId = `M${label.slice(1)}`;
    const winner = state.picks.bracket[priorId];
    if (!winner) return null;
    const a = teamForSlot(priorId, 'a');
    const b = teamForSlot(priorId, 'b');
    if (winner === a) return b;
    if (winner === b) return a;
    return null;
  }
  return null;
}

const KNOCKOUT_ROUNDS = [
  { id: 'r32',   label: 'Round of 32' },
  { id: 'r16',   label: 'Round of 16' },
  { id: 'qf',    label: 'Quarterfinals' },
  { id: 'sf',    label: 'Semifinals' },
  { id: 'final', label: 'Final' },
];

// ---------- Group picks ----------

async function saveGroupPick(groupCode, slot, teamCode) {
  const current = state.picks.groups[groupCode] || { first: null, second: null };
  const other = slot === 'first' ? 'second' : 'first';

  // Toggling off the same team in the same slot clears it.
  if (current[slot] === teamCode) {
    current[slot] = null;
  } else {
    // Clicking a team that's currently in the other slot moves it (no duplicates).
    if (current[other] === teamCode) current[other] = null;
    current[slot] = teamCode;
  }

  state.picks.groups[groupCode] = current;
  renderGroupCard(groupCode);
  renderStatusBar();

  const isEmpty = current.first === null && current.second === null;
  if (isEmpty) {
    const { error } = await supabase
      .from('group_picks')
      .delete()
      .eq('player_id', state.player.id)
      .eq('group_code', groupCode);
    if (error) console.error('Delete group pick failed', error);
    return;
  }
  const { error } = await supabase.from('group_picks').upsert(
    {
      player_id: state.player.id,
      group_code: groupCode,
      first_code: current.first,
      second_code: current.second,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id,group_code' },
  );
  if (error) console.error('Save group pick failed', error);
}

function groupCardHTML(groupCode) {
  const teams = state.teamsByGroup[groupCode] || [];
  const pick = state.picks.groups[groupCode] || { first: null, second: null };
  const rows = teams
    .map((t) => {
      const isFirst = pick.first === t.code;
      const isSecond = pick.second === t.code;
      return `
        <li class="team-row">
          ${flagHTML(t.code)}
          <span class="team-name" title="${t.name}">${t.name}</span>
          <button type="button" class="rank-btn ${isFirst ? 'is-active' : ''}"
                  data-group="${groupCode}" data-slot="first" data-team="${t.code}">1st</button>
          <button type="button" class="rank-btn ${isSecond ? 'is-active' : ''}"
                  data-group="${groupCode}" data-slot="second" data-team="${t.code}">2nd</button>
        </li>`;
    })
    .join('');

  const statusText =
    pick.first && pick.second
      ? `<span class="pick-status saved">✓ Saved</span>`
      : pick.first || pick.second
      ? `<span class="pick-status partial">Pick the other slot to save</span>`
      : `<span class="pick-status empty">No picks yet</span>`;

  return `
    <div class="group-card" data-group-card="${groupCode}">
      <header class="group-card-header">Group ${groupCode}</header>
      <ul class="team-list">${rows}</ul>
      <footer class="group-card-footer">${statusText}</footer>
    </div>`;
}

function renderGroupCard(groupCode) {
  const existing = document.querySelector(`[data-group-card="${groupCode}"]`);
  if (!existing) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = groupCardHTML(groupCode);
  existing.replaceWith(wrapper.firstElementChild);
}

function renderGroupPicks() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = state.groups.map((g) => groupCardHTML(g.code)).join('');
  // Single delegated listener — survives card re-renders without leaking.
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.rank-btn');
    if (!btn || isLocked()) return;
    saveGroupPick(btn.dataset.group, btn.dataset.slot, btn.dataset.team);
  });
}

// ---------- R32 team picker modal ----------

function showR32TeamPicker(matchId, position) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const groupRows = state.groups
      .map((g) => {
        const teams = state.teamsByGroup[g.code] || [];
        return `
          <div class="picker-group">
            <h4>Group ${g.code}</h4>
            <ul>
              ${teams
                .map((t) => {
                  const placedAt = locationOfTeam(t.code);
                  const here = placedAt && placedAt.matchId === matchId && placedAt.position === position;
                  const elsewhere = placedAt && !here;
                  return `
                    <li>
                      <button type="button" class="picker-team ${here ? 'is-here' : ''} ${elsewhere ? 'is-elsewhere' : ''}"
                              data-team="${t.code}" ${elsewhere ? 'title="Already placed in M' + placedAt.matchId.slice(1) + '. Clicking moves it here."' : ''}>
                        ${flagHTML(t.code)}
                        <span>${t.name}</span>
                        ${elsewhere ? `<small>in M${placedAt.matchId.slice(1)}</small>` : ''}
                        ${here ? `<small>(currently here)</small>` : ''}
                      </button>
                    </li>`;
                })
                .join('')}
            </ul>
          </div>`;
      })
      .join('');

    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal picker-modal">
          <h2>Pick a team for ${matchId} (slot ${position.toUpperCase()})</h2>
          <p>Each team can occupy only one R32 slot. Picking one already placed moves it here.</p>
          <div class="picker-grid">${groupRows}</div>
          <div class="picker-actions">
            <button type="button" class="link-button" id="picker-clear">Clear this slot</button>
            <button type="button" class="link-button" id="picker-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    const cleanup = (result) => {
      root.innerHTML = '';
      resolve(result);
    };

    root.querySelectorAll('.picker-team').forEach((btn) => {
      btn.addEventListener('click', () => cleanup({ action: 'pick', team: btn.dataset.team }));
    });
    document.getElementById('picker-clear').addEventListener('click', () => cleanup({ action: 'clear' }));
    document.getElementById('picker-cancel').addEventListener('click', () => cleanup({ action: 'cancel' }));
  });
}

function locationOfTeam(teamCode) {
  for (const [matchId, slots] of Object.entries(state.picks.r32)) {
    if (slots.a === teamCode) return { matchId, position: 'a' };
    if (slots.b === teamCode) return { matchId, position: 'b' };
  }
  return null;
}

// ---------- R32 slot persistence ----------

async function saveR32Slot(matchId, position, teamCode) {
  const slotIndex = matchToSlot(matchId, position);
  if (teamCode === null) {
    state.picks.r32[matchId] ||= { a: null, b: null };
    state.picks.r32[matchId][position] = null;
    const { error } = await supabase
      .from('r32_draft')
      .delete()
      .eq('player_id', state.player.id)
      .eq('slot_index', slotIndex);
    if (error) console.error('Delete R32 slot failed', error);
    return;
  }

  // If team is currently in another R32 slot, vacate that slot first (state + DB).
  const existing = locationOfTeam(teamCode);
  if (existing && !(existing.matchId === matchId && existing.position === position)) {
    state.picks.r32[existing.matchId][existing.position] = null;
    await supabase
      .from('r32_draft')
      .delete()
      .eq('player_id', state.player.id)
      .eq('slot_index', matchToSlot(existing.matchId, existing.position));
  }

  state.picks.r32[matchId] ||= { a: null, b: null };
  state.picks.r32[matchId][position] = teamCode;
  const { error } = await supabase.from('r32_draft').upsert(
    {
      player_id: state.player.id,
      slot_index: slotIndex,
      team_code: teamCode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id,slot_index' },
  );
  if (error) console.error('Save R32 slot failed', error);
}

// ---------- Bracket rendering ----------

function teamPillHTML(teamCode, opts = {}) {
  if (!teamCode) {
    return `<span class="team-pill team-pill--empty">${opts.placeholder || '— pick team —'}</span>`;
  }
  const team = state.teamsByCode[teamCode];
  if (!team) return `<span class="team-pill">${teamCode}</span>`;
  return `<span class="team-pill">${flagHTML(team.code)}<span>${team.name}</span></span>`;
}

// Bracket winner is only meaningful when it matches one of the current teams in
// the match (the underlying R32 draft can change after a winner was saved).
function effectiveWinner(matchId, teamA, teamB) {
  const saved = state.picks.bracket[matchId];
  if (!saved) return null;
  if (saved === teamA || saved === teamB) return saved;
  return null;
}

function matchCellHTML(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return '';
  const teamA = teamForSlot(matchId, 'a');
  const teamB = teamForSlot(matchId, 'b');
  const isR32 = match.stage === 'r32';
  const canAdvance = !!(teamA && teamB);
  const winner = effectiveWinner(matchId, teamA, teamB);

  const slotHTML = (position, team) => {
    const isWinner = team && winner === team;
    const pill = teamPillHTML(team, { placeholder: isR32 ? '— pick team —' : '?' });

    if (isR32 && !team) {
      return `
        <button type="button" class="bracket-slot is-empty"
                data-match="${matchId}" data-position="${position}" data-action="r32-pick">
          ${pill}
        </button>`;
    }

    if (isR32) {
      // Filled R32 slot: clickable team area (when both teams present) + small edit icon.
      const teamEl = canAdvance
        ? `<button type="button" class="slot-team" data-match="${matchId}" data-team="${team}" data-action="advance">${pill}</button>`
        : `<div class="slot-team slot-team--readonly">${pill}</div>`;
      return `
        <div class="bracket-slot bracket-slot--filled ${isWinner ? 'is-winner' : ''}">
          ${teamEl}
          <button type="button" class="slot-edit" data-match="${matchId}" data-position="${position}" data-action="r32-edit" title="Change team">✎</button>
        </div>`;
    }

    // R16 and later: not directly editable; clickable only when both teams determined.
    if (!team) {
      return `<div class="bracket-slot bracket-slot--readonly">${pill}</div>`;
    }
    if (!canAdvance) {
      return `<div class="bracket-slot bracket-slot--readonly ${isWinner ? 'is-winner' : ''}">${pill}</div>`;
    }
    return `
      <button type="button" class="bracket-slot ${isWinner ? 'is-winner' : ''}"
              data-match="${matchId}" data-team="${team}" data-action="advance">
        ${pill}
      </button>`;
  };

  return `
    <div class="bracket-match" data-match-id="${matchId}">
      <div class="bracket-match-label">${matchId.slice(1)}</div>
      ${slotHTML('a', teamA)}
      ${slotHTML('b', teamB)}
    </div>`;
}

function bracketColumnHTML(round) {
  const matches = state.matches
    .filter((m) => m.stage === round.id)
    .sort((a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10));
  return `
    <div class="bracket-column bracket-column--${round.id}">
      <header class="bracket-column-header">${round.label}</header>
      <div class="bracket-column-body">
        ${matches.map((m) => matchCellHTML(m.id)).join('')}
      </div>
    </div>`;
}

function renderBracket() {
  const root = document.getElementById('bracket');
  const thirdMatch = state.matches.find((m) => m.stage === 'third');
  root.innerHTML = `
    <div class="bracket-grid">
      ${KNOCKOUT_ROUNDS.map(bracketColumnHTML).join('')}
    </div>
    <div class="bracket-aside">
      <h3>3rd Place</h3>
      ${thirdMatch ? matchCellHTML(thirdMatch.id) : ''}
    </div>
  `;
}

async function saveBracketPick(matchId, teamCode) {
  const current = state.picks.bracket[matchId];
  if (current === teamCode) {
    // Toggle off: un-pick this winner.
    delete state.picks.bracket[matchId];
    const { error } = await supabase
      .from('bracket_picks')
      .delete()
      .eq('player_id', state.player.id)
      .eq('match_id', matchId);
    if (error) console.error('Delete bracket pick failed', error);
    return;
  }
  state.picks.bracket[matchId] = teamCode;
  const { error } = await supabase.from('bracket_picks').upsert(
    {
      player_id: state.player.id,
      match_id: matchId,
      winner_code: teamCode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id,match_id' },
  );
  if (error) console.error('Save bracket pick failed', error);
}

function wireBracketListener() {
  // Attached once to #bracket; survives any number of innerHTML re-renders.
  document.getElementById('bracket').addEventListener('click', async (e) => {
    if (isLocked()) return;

    const advance = e.target.closest('[data-action="advance"]');
    if (advance) {
      await saveBracketPick(advance.dataset.match, advance.dataset.team);
      renderBracket();
      renderStatusBar();
      return;
    }

    const pickBtn = e.target.closest('[data-action="r32-pick"], [data-action="r32-edit"]');
    if (pickBtn) {
      const { match, position } = pickBtn.dataset;
      const result = await showR32TeamPicker(match, position);
      if (result.action === 'cancel') return;
      const newTeam = result.action === 'clear' ? null : result.team;
      await saveR32Slot(match, position, newTeam);
      renderBracket();
      renderStatusBar();
    }
  });
}

// ---------- Status & leaderboard placeholders ----------

function renderUserBar() {
  const bar = document.getElementById('user-bar');
  bar.innerHTML = `
    <span class="user-name">${state.player.name}</span>
    <button id="switch-user" class="link-button">switch</button>
  `;
  document.getElementById('switch-user').addEventListener('click', () => {
    clearStoredPlayer();
    location.reload();
  });
}

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function renderStatusBar() {
  const bar = document.getElementById('status-bar');
  const locked = isLocked();
  const lockMoment = new Date(LOCK_DATE_ISO);
  const groupsPicked = Object.values(state.picks.groups).filter(
    (p) => p.first && p.second,
  ).length;
  const r32Filled = Object.values(state.picks.r32).reduce(
    (n, slot) => n + (slot.a ? 1 : 0) + (slot.b ? 1 : 0),
    0,
  );
  // Count only winner picks that are still valid (team still in the match).
  const winnersPicked = state.matches
    .filter((m) => m.stage !== 'group')
    .filter((m) => effectiveWinner(m.id, teamForSlot(m.id, 'a'), teamForSlot(m.id, 'b')))
    .length;
  bar.innerHTML = `
    <div class="status-card">
      <div>
        <strong>${locked ? 'Picks locked' : `Picks lock in ${formatCountdown(lockMoment - new Date())}`}</strong>
        <div class="status-sub">${lockMoment.toLocaleString()}</div>
      </div>
      <div>
        <strong>Group picks: ${groupsPicked} / 12</strong>
      </div>
      <div>
        <strong>R32 slots: ${r32Filled} / 32</strong>
      </div>
      <div>
        <strong>Winner picks: ${winnersPicked} / 32</strong>
      </div>
    </div>
  `;
}

function renderLeaderboardPlaceholder() {
  const lb = document.getElementById('leaderboard');
  const locked = isLocked();
  lb.innerHTML = locked
    ? '<p>Scores will appear here as matches complete.</p>'
    : '<p>Leaderboard appears at first kickoff on June 11.</p>';
}

// ---------- Init ----------

async function init() {
  let player = getStoredPlayer();
  if (!player) player = await showPlayerPicker();
  state.player = player;

  renderUserBar();
  await loadReferenceData();
  await loadMyPicks();
  renderStatusBar();
  renderGroupPicks();
  renderBracket();
  wireBracketListener();
  renderLeaderboardPlaceholder();
}

document.addEventListener('DOMContentLoaded', init);
