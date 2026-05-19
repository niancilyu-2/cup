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
  picks: { groups: {} }, // { groupCode: { first, second } }
};

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
    supabase.from('matches').select('*').order('kickoff_at'),
  ]);
  state.groups = groups;
  state.teams = teams;
  state.matches = matches;
  state.teamsByGroup = teams.reduce((acc, t) => {
    (acc[t.group_code] ||= []).push(t);
    return acc;
  }, {});
}

async function loadMyPicks() {
  const { data: groupPicks, error } = await supabase
    .from('group_picks')
    .select('*')
    .eq('player_id', state.player.id);
  if (error) {
    console.error('Failed to load group picks', error);
    return;
  }
  state.picks.groups = {};
  for (const row of groupPicks) {
    state.picks.groups[row.group_code] = {
      first: row.first_code,
      second: row.second_code,
    };
  }
}

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
          <span class="team-flag">${t.flag_emoji}</span>
          <span class="team-name">${t.name}</span>
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
  existing.outerHTML = groupCardHTML(groupCode);
  wireRankButtons();
}

function renderGroupPicks() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = state.groups.map((g) => groupCardHTML(g.code)).join('');
  wireRankButtons();
}

function wireRankButtons() {
  document.querySelectorAll('.rank-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isLocked()) return;
      saveGroupPick(btn.dataset.group, btn.dataset.slot, btn.dataset.team);
    });
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
  bar.innerHTML = `
    <div class="status-card">
      <div>
        <strong>${locked ? 'Picks locked' : `Picks lock in ${formatCountdown(lockMoment - new Date())}`}</strong>
        <div class="status-sub">${lockMoment.toLocaleString()}</div>
      </div>
      <div>
        <strong>Group picks: ${groupsPicked} / 12</strong>
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
  renderLeaderboardPlaceholder();
}

document.addEventListener('DOMContentLoaded', init);
