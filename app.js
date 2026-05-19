// ABOUTME: Core application logic for WC 2026 bracket pick'em.
// ABOUTME: Handles self-signup, picks, lock logic, leaderboard, and bracket rendering.

// Two-stage model: groups lock at first WC kickoff; bracket opens once
// FIFA-resolved R32 pairings are populated in the matches table and locks
// at the first R32 kickoff. ?stage=X in the URL forces a stage for testing.
const GROUP_LOCK_ISO   = '2026-06-11T13:00:00-06:00'; // Mexico vs South Africa
const BRACKET_LOCK_ISO = '2026-06-28T15:00:00-07:00'; // First R32: SoFi Stadium
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
    bracket: {}, // { matchId: winnerCode } — for r32 onwards
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

function allR32Resolved() {
  return state.matches
    .filter((m) => m.stage === 'r32')
    .every((m) => m.team_a_code && m.team_b_code);
}

function getStage() {
  const override = new URLSearchParams(location.search).get('stage');
  if (override === 'groups-open' || override === 'groups-locked' || override === 'bracket-open' || override === 'all-locked') {
    return override;
  }
  const now = new Date();
  if (now < new Date(GROUP_LOCK_ISO)) return 'groups-open';
  if (now >= new Date(BRACKET_LOCK_ISO)) return 'all-locked';
  return allR32Resolved() ? 'bracket-open' : 'groups-locked';
}

function isGroupsLocked() {
  const s = getStage();
  return s !== 'groups-open';
}

function isBracketLocked() {
  const s = getStage();
  return s !== 'bracket-open';
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
  const [groupRes, brktRes] = await Promise.all([
    supabase.from('group_picks').select('*').eq('player_id', state.player.id),
    supabase.from('bracket_picks').select('*').eq('player_id', state.player.id),
  ]);
  state.picks.groups = {};
  state.picks.bracket = {};
  if (!groupRes.error) {
    for (const row of groupRes.data) {
      state.picks.groups[row.group_code] = {
        first: row.first_code,
        second: row.second_code,
      };
    }
  }
  if (!brktRes.error) {
    for (const row of brktRes.data) {
      state.picks.bracket[row.match_id] = row.winner_code;
    }
  }
}

// ---------- Bracket helpers ----------

// Resolve which team is in a given match's a/b slot.
// 1) Use the team populated directly on the match row (group matches, and
//    R32 once FIFA-resolved post-group-stage).
// 2) Otherwise recurse through WXX/LXX labels for R16+, reading user picks.
function teamForSlot(matchId, position) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return null;
  const direct = position === 'a' ? match.team_a_code : match.team_b_code;
  if (direct) return direct;
  const label = position === 'a' ? match.slot_a : match.slot_b;
  if (!label) return null;
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
  // FIFA slot labels (e.g. '1A', '2A', '3A/B/C/D/F') stay unresolved until
  // matches.team_a_code/b_code are populated for that R32 row.
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
    if (!btn || isGroupsLocked()) return;
    saveGroupPick(btn.dataset.group, btn.dataset.slot, btn.dataset.team);
  });
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
  const canAdvance = !!(teamA && teamB) && getStage() === 'bracket-open';
  const winner = effectiveWinner(matchId, teamA, teamB);

  const slotHTML = (position, team) => {
    const isWinner = team && winner === team;
    const pill = teamPillHTML(team, { placeholder: '?' });
    if (!team || !canAdvance) {
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
  const stage = getStage();

  if (stage === 'groups-open') {
    root.innerHTML = `
      <div class="bracket-locked-notice">
        <strong>The bracket opens after group stage ends.</strong>
        <p>Focus on your group standings for now. After the last group match on June 27, the R32 pairings will be set from real qualifying teams and you'll pick winners through the Final.</p>
      </div>`;
    return;
  }
  if (stage === 'groups-locked') {
    root.innerHTML = `
      <div class="bracket-locked-notice">
        <strong>Group stage in progress — bracket unlocks once R32 pairings are confirmed.</strong>
        <p>Match results stream in automatically. As soon as all 16 R32 pairings are known, this section will fill with the real bracket and you can pick winners through the Final.</p>
      </div>`;
    return;
  }

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
    if (isBracketLocked()) return;
    const advance = e.target.closest('[data-action="advance"]');
    if (!advance) return;
    await saveBracketPick(advance.dataset.match, advance.dataset.team);
    renderBracket();
    renderStatusBar();
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
  const stage = getStage();
  const groupLock = new Date(GROUP_LOCK_ISO);
  const bracketLock = new Date(BRACKET_LOCK_ISO);
  const now = new Date();

  const groupsPicked = Object.values(state.picks.groups).filter(
    (p) => p.first && p.second,
  ).length;
  const winnersPicked = state.matches
    .filter((m) => m.stage !== 'group')
    .filter((m) => effectiveWinner(m.id, teamForSlot(m.id, 'a'), teamForSlot(m.id, 'b'))).length;

  let phaseLabel;
  let phaseSub;
  if (stage === 'groups-open') {
    phaseLabel = `Group picks lock in ${formatCountdown(groupLock - now)}`;
    phaseSub = groupLock.toLocaleString();
  } else if (stage === 'groups-locked') {
    phaseLabel = 'Group stage in progress — bracket opens after R32 pairings are set';
    phaseSub = `R32 starts ${bracketLock.toLocaleString()}`;
  } else if (stage === 'bracket-open') {
    phaseLabel = `Bracket locks in ${formatCountdown(bracketLock - now)}`;
    phaseSub = bracketLock.toLocaleString();
  } else {
    phaseLabel = 'All picks locked';
    phaseSub = '';
  }

  bar.innerHTML = `
    <div class="status-card">
      <div>
        <strong>${phaseLabel}</strong>
        <div class="status-sub">${phaseSub}</div>
      </div>
      <div>
        <strong>Group picks: ${groupsPicked} / 12</strong>
      </div>
      <div>
        <strong>Winner picks: ${winnersPicked} / 32</strong>
      </div>
    </div>
  `;
}

function renderLeaderboardPlaceholder() {
  const lb = document.getElementById('leaderboard');
  const stage = getStage();
  if (stage === 'groups-open') {
    lb.innerHTML = '<p>Leaderboard goes live at first kickoff on June 11.</p>';
  } else {
    lb.innerHTML = '<p>Scores update as matches complete.</p>';
  }
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
