// ABOUTME: Core application logic for WC 2026 bracket pick'em.
// ABOUTME: Handles self-signup, picks, lock logic, stage flow, tiebreaker, and bracket rendering.

import { lookupAssignment } from './src/wildcards.js';

// Single-phase model: everything (groups + bracket + tiebreaker) is editable
// until the first WC kickoff on June 11.
const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00'; // Mexico vs South Africa
const STORAGE_KEY_PLAYER = 'wcbracket.player';
const STORAGE_KEY_COLLAPSED = 'wcbracket.collapsed'; // JSON: { groups: bool, wildcards: bool }
const FINAL_MATCH_ID = 'M104';

const supabase = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY,
);

// Two-tier pick state:
//   draft = working copy edited by clicks/auto-pick; never written to DB until Save/Submit.
//   saved = last snapshot persisted to DB.
// isDirty() compares the two; nav guards and Save button rely on the diff.
// Each group pick has { first, second, third, advances } where `advances` flags
// the group's 3rd team as one of the eight R32 wildcards.
function blankPicks() {
  return { groups: {}, bracket: {}, tiebreaker: null };
}

const state = {
  player: null,
  groups: [],
  teams: [],
  matches: [],
  teamsByGroup: {},
  teamsByCode: {},
  picks: {
    draft: blankPicks(),
    saved: blankPicks(),
  },
  // Transient UI: which team is currently selected for a tap-swap.
  selection: null, // { group, code } | null
};

// Latches so each stage-complete transition triggers its auto-advance only
// once. Re-seeded after init and after clear so returning users with full
// picks don't get scrolled or popped a modal on page load.
const stageProgress = { groups: false, wildcards: false, bracket: false };
let tiebreakerPromptShown = false;

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

function isSubmitted() {
  return !!state.player?.groups_submitted_at && !!state.player?.bracket_submitted_at;
}

// Edits are disabled when locked OR when the player has submitted (until Edit).
function isEditingDisabled() {
  return isLocked() || isSubmitted();
}

function isDirty() {
  return JSON.stringify(state.picks.draft) !== JSON.stringify(state.picks.saved);
}

function snapshot(obj) {
  return JSON.parse(JSON.stringify(obj));
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
  // Reverse map: for each match, find the downstream match that consumes its
  // winner (so we can render "→ #89" hints in the bracket).
  state.matchDestinations = {};
  for (const m of matches) {
    for (const slot of [m.slot_a, m.slot_b]) {
      if (slot && slot.startsWith('W')) {
        state.matchDestinations['M' + slot.slice(1)] = m.id;
      }
    }
  }
  // Within each group, default order is by pot (1..4) then alphabetical so the
  // top-seeded team starts at the top of the tap-to-swap list.
  state.teamsByGroup = teams.reduce((acc, t) => {
    (acc[t.group_code] ||= []).push(t);
    return acc;
  }, {});
  for (const code of Object.keys(state.teamsByGroup)) {
    state.teamsByGroup[code].sort((a, b) => {
      const pa = a.pot ?? 99, pb = b.pot ?? 99;
      if (pa !== pb) return pa - pb;
      return a.code.localeCompare(b.code);
    });
  }
  state.teamsByCode = Object.fromEntries(teams.map((t) => [t.code, t]));
}

async function loadCurrentPlayer() {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', state.player.id)
    .single();
  if (error) {
    console.error('Failed to refresh player', error);
    return;
  }
  state.player = { ...state.player, ...data };
}

async function loadMyPicks() {
  const [groupRes, brktRes, tbRes] = await Promise.all([
    supabase.from('group_picks').select('*').eq('player_id', state.player.id),
    supabase.from('bracket_picks').select('*').eq('player_id', state.player.id),
    supabase.from('tiebreaker_picks').select('*').eq('player_id', state.player.id).maybeSingle(),
  ]);
  const saved = blankPicks();
  if (!groupRes.error) {
    for (const row of groupRes.data) {
      saved.groups[row.group_code] = {
        first: row.first_code,
        second: row.second_code,
        third: row.third_code,
        advances: !!row.third_advances,
      };
    }
  }
  if (!brktRes.error) {
    for (const row of brktRes.data) {
      saved.bracket[row.match_id] = row.winner_code;
    }
  }
  if (!tbRes.error && tbRes.data) {
    saved.tiebreaker = tbRes.data.champion_avg_goals == null
      ? null
      : Number(tbRes.data.champion_avg_goals);
  }
  state.picks.saved = saved;
  state.picks.draft = snapshot(saved); // start clean
}

// ---------- Bracket helpers ----------

// FIFA's R32 pairing rules: 1A means "winner of group A", 2A means "runner-up
// of group A", '3wc' means "wildcard 3rd-place team for this slot" (resolved
// via the lookup table once the user has picked their 8 advancing thirds).
// Source: Wikipedia 2026 FIFA World Cup knockout stage.
const R32_SLOT_RULES = {
  M73: { a: '2A', b: '2B' },
  M74: { a: '1E', b: '3wc' },
  M75: { a: '1F', b: '2C' },
  M76: { a: '1C', b: '2F' },
  M77: { a: '1I', b: '3wc' },
  M78: { a: '2E', b: '2I' },
  M79: { a: '1A', b: '3wc' },
  M80: { a: '1L', b: '3wc' },
  M81: { a: '1D', b: '3wc' },
  M82: { a: '1G', b: '3wc' },
  M83: { a: '2K', b: '2L' },
  M84: { a: '1H', b: '2J' },
  M85: { a: '1B', b: '3wc' },
  M86: { a: '1J', b: '2H' },
  M87: { a: '1K', b: '3wc' },
  M88: { a: '2D', b: '2G' },
};

function advancingGroups() {
  return state.groups
    .map((g) => g.code)
    .filter((code) => state.picks.draft.groups[code]?.advances);
}

function currentWildcardAssignment() {
  const groups = advancingGroups();
  if (groups.length !== 8) return null;
  return lookupAssignment(groups);
}

function resolveR32Slot(matchId, position) {
  const rule = R32_SLOT_RULES[matchId];
  if (!rule) return null;
  const slot = position === 'a' ? rule.a : rule.b;
  if (slot === '3wc') {
    const wc = currentWildcardAssignment();
    if (!wc) return null;
    const sourceGroup = wc[matchId];
    return state.picks.draft.groups[sourceGroup]?.third || null;
  }
  // slot is like '1A' or '2B'
  const rank = slot[0];
  const group = slot[1];
  const pick = state.picks.draft.groups[group];
  if (!pick) return null;
  return rank === '1' ? pick.first : pick.second;
}

// Resolve which team is in a given match's a/b slot, reading from the draft.
function teamForSlot(matchId, position) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return null;
  if (match.stage === 'group') {
    return position === 'a' ? match.team_a_code : match.team_b_code;
  }
  if (match.stage === 'r32') {
    return resolveR32Slot(matchId, position);
  }
  const label = position === 'a' ? match.slot_a : match.slot_b;
  if (!label) return null;
  if (label.startsWith('W')) {
    return state.picks.draft.bracket[`M${label.slice(1)}`] || null;
  }
  if (label.startsWith('L')) {
    const priorId = `M${label.slice(1)}`;
    const winner = state.picks.draft.bracket[priorId];
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

// ---------- Stage progression (auto-scroll + tiebreaker prompt) ----------

function isGroupsComplete() {
  return state.groups.length > 0 && state.groups.every((g) => hasGroupPick(g.code));
}

function isWildcardsComplete() {
  return isGroupsComplete() && advancingGroups().length === 8;
}

// state.matches includes the 72 group-stage matches; bracket picks only cover
// the 32 knockout matches (R32 + R16 + QF + SF + Final + 3rd). Use this helper
// anywhere "the bracket" is being counted or iterated.
function bracketMatches() {
  return state.matches.filter((m) => m.stage !== 'group');
}

function isBracketComplete() {
  const ko = bracketMatches();
  if (!isWildcardsComplete() || !ko.length) return false;
  return ko.every((m) => !!state.picks.draft.bracket[m.id]);
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function seedStageProgress() {
  stageProgress.groups = isGroupsComplete();
  stageProgress.wildcards = isWildcardsComplete();
  stageProgress.bracket = isBracketComplete();
  tiebreakerPromptShown = state.picks.draft.tiebreaker != null;
}

// Called after every user-initiated pick mutation. Each stage's auto-scroll
// fires only on the false→true transition; rolling back lets it fire again.
function maybeAdvanceStage() {
  const groups = isGroupsComplete();
  const wildcards = isWildcardsComplete();
  const bracket = isBracketComplete();

  if (groups && !stageProgress.groups) {
    stageProgress.groups = true;
    scrollToSection('wildcards-section');
  } else if (!groups) {
    stageProgress.groups = false;
  }

  if (wildcards && !stageProgress.wildcards) {
    stageProgress.wildcards = true;
    scrollToSection('bracket-section');
  } else if (!wildcards) {
    stageProgress.wildcards = false;
  }

  if (bracket && !stageProgress.bracket) {
    stageProgress.bracket = true;
    if (!tiebreakerPromptShown && state.picks.draft.tiebreaker == null && !isEditingDisabled()) {
      tiebreakerPromptShown = true;
      showTiebreakerModal();
    }
  } else if (!bracket) {
    stageProgress.bracket = false;
  }
}

function showTiebreakerModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const champCode = predictedChampionCode();
  const champ = champCode ? state.teamsByCode[champCode] : null;
  const currentVal = state.picks.draft.tiebreaker ?? '';
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h2>One last thing &mdash; tiebreaker</h2>
        <p>Bracket's full. Predict your champion's average goals per game across the tournament.</p>
        ${champ ? `<p class="modal-champion">${flagHTML(champ.code)} <strong>${champ.name}</strong></p>` : ''}
        <input type="number" id="tb-modal-input" min="0" max="6" step="0.1"
               placeholder="e.g. 2.3" value="${currentVal}" autofocus />
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="tb-modal-save">Save</button>
          <button type="button" class="btn-link" id="tb-modal-cancel">Skip for now</button>
        </div>
      </div>
    </div>`;
  const input = document.getElementById('tb-modal-input');
  // Numeric inputs ignore range-style autofocus → manually focus.
  setTimeout(() => input.focus(), 0);
  const close = () => { root.innerHTML = ''; };
  document.getElementById('tb-modal-save').addEventListener('click', () => {
    const v = input.value;
    state.picks.draft.tiebreaker = v === '' ? null : Number(v);
    close();
    renderTiebreaker();
    renderActionsBar();
    renderCountdownBanner();
    scrollToSection('tiebreaker-section');
  });
  document.getElementById('tb-modal-cancel').addEventListener('click', () => {
    close();
    scrollToSection('tiebreaker-section');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('tb-modal-save').click();
    if (e.key === 'Escape') document.getElementById('tb-modal-cancel').click();
  });
}

// ---------- Group picks (tap-to-swap) ----------

function emptyGroupPick() {
  return { first: null, second: null, third: null, advances: false };
}

// Returns the 4-team order rendered for this group. We always show all 4
// teams; missing slots in a partial pick get backfilled from the remaining
// teams in default order so the card never loses a row.
function rankedOrder(groupCode) {
  const all = state.teamsByGroup[groupCode] || [];
  const allCodes = all.map((t) => t.code);
  const pick = state.picks.draft.groups[groupCode];
  if (!pick || !pick.first) {
    return { codes: allCodes, isDefault: true };
  }
  const explicit = [pick.first, pick.second, pick.third];
  const used = new Set(explicit.filter(Boolean));
  const remaining = allCodes.filter((c) => !used.has(c));
  const slots = explicit.map((c) => c || remaining.shift());
  if (remaining.length) slots.push(remaining.shift());
  return { codes: slots, isDefault: false };
}

function hasGroupPick(groupCode) {
  const p = state.picks.draft.groups[groupCode];
  return !!(p && p.first && p.second && p.third);
}

// Materialize a group pick from its current (default) order — used right
// before applying the first swap, so subsequent swaps act on a stored order.
function ensureGroupPickFromOrder(groupCode, order) {
  if (!state.picks.draft.groups[groupCode]) {
    state.picks.draft.groups[groupCode] = {
      first: order[0],
      second: order[1],
      third: order[2],
      advances: false,
    };
  }
}

function swapTeamsInGroup(groupCode, codeA, codeB) {
  const { codes } = rankedOrder(groupCode);
  ensureGroupPickFromOrder(groupCode, codes);
  const order = rankedOrder(groupCode).codes.slice();
  const ia = order.indexOf(codeA);
  const ib = order.indexOf(codeB);
  if (ia === -1 || ib === -1) return;
  [order[ia], order[ib]] = [order[ib], order[ia]];
  const prev = state.picks.draft.groups[groupCode];
  state.picks.draft.groups[groupCode] = {
    first: order[0],
    second: order[1],
    third: order[2],
    // If the 3rd team changed, the old `advances` flag no longer makes sense.
    advances: prev.third === order[2] ? prev.advances : false,
  };
}

function tapTeam(groupCode, teamCode) {
  if (isEditingDisabled()) return;
  const sel = state.selection;
  if (sel && sel.group === groupCode && sel.code === teamCode) {
    // Tap same team twice → deselect.
    state.selection = null;
    renderGroupCard(groupCode);
    return;
  }
  if (sel && sel.group === groupCode) {
    // Two taps in same group → swap.
    const swappedA = sel.code;
    const swappedB = teamCode;
    swapTeamsInGroup(groupCode, swappedA, swappedB);
    state.selection = null;
    renderGroupCard(groupCode);
    flashSwappedRows(groupCode, swappedA, swappedB);
    renderWildcardsSection();
    renderBracket();
    renderTiebreaker();
    renderCountdownBanner();
    renderActionsBar();
    maybeAdvanceStage();
    return;
  }
  // First tap (or switching groups): select the new team, clear any prior.
  const prevGroup = sel?.group;
  state.selection = { group: groupCode, code: teamCode };
  if (prevGroup && prevGroup !== groupCode) renderGroupCard(prevGroup);
  renderGroupCard(groupCode);
}

function toggleWildcardAdvance(groupCode) {
  const current = state.picks.draft.groups[groupCode];
  if (!current?.third) return; // can't advance without a 3rd picked
  const wildcardCount = advancingGroups().length;
  if (current.advances) {
    current.advances = false;
  } else {
    if (wildcardCount >= 8) return;
    current.advances = true;
  }
  state.picks.draft.groups[groupCode] = current;
  renderWildcardsSection();
  renderBracket();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

function groupCardHTML(groupCode) {
  const { codes, isDefault } = rankedOrder(groupCode);
  const disabled = isEditingDisabled();
  const sel = state.selection;
  const hasSelection = !disabled && sel && sel.group === groupCode;
  const selectedTeam = hasSelection ? state.teamsByCode[sel.code] : null;
  const rows = codes
    .map((code, idx) => {
      const team = state.teamsByCode[code];
      if (!team) return '';
      const rank = idx + 1;
      const isSelected = hasSelection && sel.code === code;
      const isSwapTarget = hasSelection && !isSelected;
      const classes = [
        'team-row',
        isDefault ? 'is-default' : '',
        isSelected ? 'is-selected' : '',
        isSwapTarget ? 'is-swap-target' : '',
      ].filter(Boolean).join(' ');
      const chipContent = isSelected ? '↕' : rank;
      return `
        <li>
          <button type="button"
                  class="${classes}"
                  data-group="${groupCode}" data-team="${code}"
                  title="${team.name}"
                  ${disabled ? 'disabled' : ''}>
            <span class="rank-chip rank-${rank} ${isSelected ? 'is-selected-chip' : ''}">${chipContent}</span>
            ${flagHTML(code)}
            <span class="team-code">${code}</span>
          </button>
        </li>`;
    })
    .join('');

  let statusLabel;
  if (selectedTeam) {
    statusLabel = `<strong>↕ ${selectedTeam.code}</strong> selected`;
  } else {
    statusLabel = 'Tap two teams to swap their positions.';
  }
  return `
    <div class="group-card ${hasSelection ? 'has-selection' : ''}" data-group-card="${groupCode}">
      <header class="group-card-header">
        <span>Group ${groupCode}</span>
      </header>
      <ul class="team-list">${rows}</ul>
      <footer class="group-card-footer ${selectedTeam ? 'has-selection' : ''}">${statusLabel}</footer>
    </div>`;
}

function renderGroupCard(groupCode) {
  const existing = document.querySelector(`[data-group-card="${groupCode}"]`);
  if (!existing) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = groupCardHTML(groupCode);
  existing.replaceWith(wrapper.firstElementChild);
  renderGroupsToolbar();
  renderSectionToggle('groups');
}

// Briefly flash the two rows that just swapped so the change registers.
function flashSwappedRows(groupCode, codeA, codeB) {
  const card = document.querySelector(`[data-group-card="${groupCode}"]`);
  if (!card) return;
  for (const code of [codeA, codeB]) {
    const row = card.querySelector(`.team-row[data-team="${code}"]`);
    if (!row) continue;
    row.classList.add('just-swapped');
    setTimeout(() => row.classList.remove('just-swapped'), 360);
  }
}

function renderGroupPicks() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = state.groups.map((g) => groupCardHTML(g.code)).join('');
  renderGroupsToolbar();
  renderSectionToggle('groups');
}

function wireGroupsGrid() {
  // Single delegated listener — survives card re-renders.
  document.getElementById('groups-grid').addEventListener('click', (e) => {
    const row = e.target.closest('.team-row');
    if (!row || row.disabled) return;
    tapTeam(row.dataset.group, row.dataset.team);
  });
}

// ---------- Auto-fill empty groups ----------

function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function autoFillEmptyGroups() {
  if (isEditingDisabled()) return;
  let changed = 0;
  for (const group of state.groups) {
    if (hasGroupPick(group.code)) continue;
    const teams = state.teamsByGroup[group.code] || [];
    if (teams.length < 3) continue;
    const order = shuffled(teams);
    state.picks.draft.groups[group.code] = {
      first: order[0].code,
      second: order[1].code,
      third: order[2].code,
      advances: false,
    };
    changed++;
  }
  if (!changed) return;
  state.selection = null;
  renderGroupPicks();
  renderWildcardsSection();
  renderBracket();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

function groupsRankedCount() {
  return state.groups.filter((g) => hasGroupPick(g.code)).length;
}

// ---------- Wildcards picker (8 of 12 thirds advance to R32) ----------

function renderWildcardsSection() {
  const root = document.getElementById('wildcards-grid');
  if (!root) return;
  const disabled = isEditingDisabled();
  const count = advancingGroups().length;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));

  if (!groupsReady) {
    root.innerHTML = `
      <p class="wildcards-empty">Rank all 12 groups before picking wildcards.</p>
    `;
    document.getElementById('wildcards-status').textContent = '';
    renderWildcardsToolbar();
    renderSectionToggle('wildcards');
    return;
  }

  const cards = state.groups
    .map((g) => {
      const p = state.picks.draft.groups[g.code] || emptyGroupPick();
      const team = state.teamsByCode[p.third];
      const active = !!p.advances;
      const atMax = count >= 8 && !active;
      const teamName = team ? team.name : '—';
      return `
        <button type="button" class="wildcard-card ${active ? 'is-active' : ''}"
                data-group="${g.code}"
                ${disabled || atMax ? 'disabled' : ''}
                ${atMax ? 'title="Already 8 picked — deselect another first"' : ''}>
          <header class="wildcard-card-group">Group ${g.code} · 3rd</header>
          <div class="wildcard-card-team">
            ${team ? flagHTML(team.code) : ''}
            <span>${teamName}</span>
          </div>
          <span class="wildcard-card-state">${active ? '✓ Advances' : 'Tap to advance'}</span>
        </button>`;
    })
    .join('');

  root.innerHTML = cards;
  document.getElementById('wildcards-status').innerHTML = `
    <strong>${count} / 8 picked</strong>
    ${count === 8 ? '<span class="wildcards-ready">✓ Bracket ready</span>' : ''}
  `;
  renderWildcardsToolbar();
  renderSectionToggle('wildcards');
}

function wireWildcards() {
  document.getElementById('wildcards-grid').addEventListener('click', (e) => {
    if (isEditingDisabled()) return;
    const btn = e.target.closest('.wildcard-card');
    if (!btn || btn.disabled) return;
    toggleWildcardAdvance(btn.dataset.group);
  });
}

// ---------- Bracket winner pick ----------

function setBracketWinner(matchId, teamCode) {
  if (state.picks.draft.bracket[matchId] === teamCode) {
    delete state.picks.draft.bracket[matchId];
  } else {
    state.picks.draft.bracket[matchId] = teamCode;
  }
}

// ---------- Persistence: flush draft to DB ----------

function groupPickEqual(a, b) {
  return a.first === b.first && a.second === b.second && a.third === b.third && !!a.advances === !!b.advances;
}

async function persistGroupPicks() {
  const saved = state.picks.saved.groups;
  const draft = state.picks.draft.groups;
  const upserts = [];
  const deletes = [];
  for (const code of Object.keys(draft)) {
    const d = draft[code];
    const s = saved[code];
    const empty = !d.first && !d.second && !d.third && !d.advances;
    if (empty) {
      if (s) deletes.push(code);
      continue;
    }
    if (!s || !groupPickEqual(s, d)) {
      upserts.push({
        player_id: state.player.id,
        group_code: code,
        first_code: d.first,
        second_code: d.second,
        third_code: d.third,
        third_advances: !!d.advances,
        updated_at: new Date().toISOString(),
      });
    }
  }
  for (const code of Object.keys(saved)) {
    if (!(code in draft)) deletes.push(code);
  }
  if (upserts.length) {
    const { error } = await supabase
      .from('group_picks')
      .upsert(upserts, { onConflict: 'player_id,group_code' });
    if (error) throw error;
  }
  if (deletes.length) {
    const { error } = await supabase
      .from('group_picks')
      .delete()
      .eq('player_id', state.player.id)
      .in('group_code', deletes);
    if (error) throw error;
  }
}

async function persistBracketPicks() {
  const saved = state.picks.saved.bracket;
  const draft = state.picks.draft.bracket;
  const upserts = [];
  const deletes = [];
  for (const matchId of Object.keys(draft)) {
    if (saved[matchId] !== draft[matchId]) {
      upserts.push({
        player_id: state.player.id,
        match_id: matchId,
        winner_code: draft[matchId],
        updated_at: new Date().toISOString(),
      });
    }
  }
  for (const matchId of Object.keys(saved)) {
    if (!(matchId in draft)) deletes.push(matchId);
  }
  if (upserts.length) {
    const { error } = await supabase
      .from('bracket_picks')
      .upsert(upserts, { onConflict: 'player_id,match_id' });
    if (error) throw error;
  }
  if (deletes.length) {
    const { error } = await supabase
      .from('bracket_picks')
      .delete()
      .eq('player_id', state.player.id)
      .in('match_id', deletes);
    if (error) throw error;
  }
}

async function persistTiebreaker() {
  const draft = state.picks.draft.tiebreaker;
  const saved = state.picks.saved.tiebreaker;
  if (draft === saved) return;
  if (draft === null || draft === undefined) {
    const { error } = await supabase
      .from('tiebreaker_picks')
      .delete()
      .eq('player_id', state.player.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('tiebreaker_picks').upsert(
    {
      player_id: state.player.id,
      champion_avg_goals: draft,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id' },
  );
  if (error) throw error;
}

async function saveDraft() {
  await persistGroupPicks();
  await persistBracketPicks();
  await persistTiebreaker();
  state.picks.saved = snapshot(state.picks.draft);
}

async function submitPicks() {
  await saveDraft();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('players')
    .update({ groups_submitted_at: now, bracket_submitted_at: now })
    .eq('id', state.player.id);
  if (error) throw error;
  state.player.groups_submitted_at = now;
  state.player.bracket_submitted_at = now;
}

async function unsubmitPicks() {
  const { error } = await supabase
    .from('players')
    .update({ groups_submitted_at: null, bracket_submitted_at: null })
    .eq('id', state.player.id);
  if (error) throw error;
  state.player.groups_submitted_at = null;
  state.player.bracket_submitted_at = null;
}

// ---------- Top actions bar (Auto-fill / Save / Submit / Edit) ----------

function renderActionsBar() {
  const bar = document.getElementById('actions-bar');
  if (!bar) return;
  const locked = isLocked();
  const submitted = isSubmitted();
  const dirty = isDirty();

  if (locked) {
    bar.innerHTML = `
      <span class="status-pill submitted">Picks are locked.</span>
    `;
    return;
  }
  if (submitted) {
    bar.innerHTML = `
      <span class="status-pill submitted">✓ Submitted &mdash; you can edit and re-submit</span>
      <button type="button" class="btn-secondary" id="edit-picks-btn">Edit picks</button>
    `;
    return;
  }
  bar.innerHTML = `
    <span class="status-pill ${dirty ? 'dirty' : 'clean'}">
      ${dirty ? '● Unsaved changes' : '✓ All changes saved'}
    </span>
    <button type="button" class="btn-secondary" id="save-picks-btn" ${dirty ? '' : 'disabled'}>Save my picks</button>
    <button type="button" class="btn-primary" id="submit-picks-btn">Submit</button>
  `;
}

function wireActionsBar() {
  document.getElementById('actions-bar').addEventListener('click', async (e) => {
    if (e.target.id === 'save-picks-btn') {
      try {
        await saveDraft();
      } catch (err) {
        console.error('Save failed', err);
        alert('Save failed — see console.');
        return;
      }
      renderActionsBar();
      renderCountdownBanner();
      updateNavigationGuards();
    } else if (e.target.id === 'submit-picks-btn') {
      try {
        await submitPicks();
      } catch (err) {
        console.error('Submit failed', err);
        alert('Submit failed — see console.');
        return;
      }
      renderAll();
    } else if (e.target.id === 'edit-picks-btn') {
      try {
        await unsubmitPicks();
      } catch (err) {
        console.error('Unsubmit failed', err);
        return;
      }
      renderAll();
    }
  });
}

function renderAll() {
  // Full re-render after save/submit/edit drops any in-progress selection so
  // the new disabled state doesn't leave a stale highlight on a team row.
  state.selection = null;
  seedStageProgress();
  renderUserBar();
  renderCountdownBanner();
  renderGroupPicks();
  renderActionsBar();
  renderGroupsToolbar();
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  updateNavigationGuards();
}

// ---------- Per-section toolbars (Auto pick / Clear) ----------

function renderGroupsToolbar() {
  const el = document.getElementById('groups-toolbar');
  if (!el) return;
  if (isLocked() || isSubmitted()) { el.innerHTML = ''; return; }
  const allRanked = state.groups.every((g) => hasGroupPick(g.code));
  el.innerHTML = `
    <button type="button" class="btn-secondary" id="auto-pick-groups-btn" ${allRanked ? 'disabled' : ''} title="${allRanked ? 'All groups already ranked' : 'Fill any groups you haven\'t ranked with a random order'}">🎲 Auto pick</button>
    <button type="button" class="btn-link" id="clear-picks-btn">🗑️ Clear my picks</button>
  `;
}

function renderWildcardsToolbar() {
  const el = document.getElementById('wildcards-toolbar');
  if (!el) return;
  if (isLocked() || isSubmitted()) { el.innerHTML = ''; return; }
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const count = advancingGroups().length;
  const canAutoPick = groupsReady && count < 8;
  const canClear = count > 0;
  const title = !groupsReady
    ? 'Rank all 12 groups first'
    : count >= 8 ? 'All 8 wildcards picked' : `Randomly fill the remaining ${8 - count} wildcard slot${8 - count === 1 ? '' : 's'}`;
  el.innerHTML = `
    <button type="button" class="btn-secondary" id="auto-pick-wildcards-btn" ${canAutoPick ? '' : 'disabled'} title="${title}">🎲 Auto pick</button>
    <button type="button" class="btn-link" id="clear-wildcards-btn" ${canClear ? '' : 'disabled'}>🗑️ Clear my picks</button>
  `;
}

function renderBracketToolbar() {
  const el = document.getElementById('bracket-toolbar');
  if (!el) return;
  if (isLocked() || isSubmitted()) { el.innerHTML = ''; return; }
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const wildcardsReady = advancingGroups().length === 8;
  const ko = bracketMatches();
  const hasUnpicked = ko.some((m) => !state.picks.draft.bracket[m.id]);
  const hasPicked = ko.some((m) => !!state.picks.draft.bracket[m.id]);
  const canAutoPick = groupsReady && wildcardsReady && hasUnpicked;
  const title = !groupsReady
    ? 'Rank all 12 groups first'
    : !wildcardsReady ? 'Pick 8 wildcards first'
    : !hasUnpicked ? 'All matches have a winner'
    : 'Randomly pick a winner for every empty match';
  el.innerHTML = `
    <button type="button" class="btn-secondary" id="auto-pick-bracket-btn" ${canAutoPick ? '' : 'disabled'} title="${title}">🎲 Auto pick</button>
    <button type="button" class="btn-link" id="clear-bracket-btn" ${hasPicked ? '' : 'disabled'}>🗑️ Clear my picks</button>
  `;
}

function wireSectionToolbars() {
  document.getElementById('groups-toolbar').addEventListener('click', (e) => {
    if (e.target.id === 'auto-pick-groups-btn') autoFillEmptyGroups();
    else if (e.target.id === 'clear-picks-btn') clearMyPicks();
  });
  document.getElementById('wildcards-toolbar').addEventListener('click', (e) => {
    if (e.target.id === 'auto-pick-wildcards-btn') autoPickWildcards();
    else if (e.target.id === 'clear-wildcards-btn') clearWildcardsOnly();
  });
  document.getElementById('bracket-toolbar').addEventListener('click', (e) => {
    if (e.target.id === 'auto-pick-bracket-btn') autoPickBracket();
    else if (e.target.id === 'clear-bracket-btn') clearBracketOnly();
  });
}

function clearMyPicks() {
  if (isEditingDisabled()) return;
  const ok = confirm('Clear ALL your picks (groups, wildcards, bracket, tiebreaker)?\n\nThis only resets your in-page draft. Your saved picks in the database stay until you click Save again.');
  if (!ok) return;
  state.picks.draft = blankPicks();
  state.selection = null;
  seedStageProgress();
  renderGroupPicks();
  renderGroupsToolbar();
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
}

function clearWildcardsOnly() {
  if (isEditingDisabled()) return;
  const count = advancingGroups().length;
  if (count === 0) return;
  const ok = confirm('Clear your wildcard picks (the 8 third-place teams)?\n\nYour group rankings stay. Bracket winner picks that depend on cleared wildcards will be dropped.');
  if (!ok) return;
  for (const code of Object.keys(state.picks.draft.groups)) {
    const p = state.picks.draft.groups[code];
    if (p) p.advances = false;
  }
  seedStageProgress();
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
}

function clearBracketOnly() {
  if (isEditingDisabled()) return;
  const hasPicked = bracketMatches().some((m) => !!state.picks.draft.bracket[m.id]);
  if (!hasPicked) return;
  const ok = confirm('Clear all your knockout-bracket winner picks?\n\nYour group rankings and wildcards stay.');
  if (!ok) return;
  state.picks.draft.bracket = {};
  seedStageProgress();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
}

function autoPickWildcards() {
  if (isEditingDisabled()) return;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  if (!groupsReady) return;
  const current = advancingGroups();
  const need = 8 - current.length;
  if (need <= 0) return;
  const candidates = state.groups
    .map((g) => g.code)
    .filter((code) => !state.picks.draft.groups[code]?.advances);
  const chosen = shuffled(candidates).slice(0, need);
  for (const code of chosen) {
    const p = state.picks.draft.groups[code];
    if (p) p.advances = true;
  }
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

function autoPickBracket() {
  if (isEditingDisabled()) return;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const wildcardsReady = advancingGroups().length === 8;
  if (!groupsReady || !wildcardsReady) return;
  // Iterate in match-id order so earlier rounds resolve first and their
  // winners populate downstream slots before we look at later matches.
  const ordered = state.matches
    .slice()
    .sort((a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10));
  let changed = 0;
  for (const m of ordered) {
    if (state.picks.draft.bracket[m.id]) continue;
    const teamA = teamForSlot(m.id, 'a');
    const teamB = teamForSlot(m.id, 'b');
    if (!teamA || !teamB) continue;
    state.picks.draft.bracket[m.id] = Math.random() < 0.5 ? teamA : teamB;
    changed++;
  }
  if (!changed) return;
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

// ---------- Tiebreaker (champion derived from Final pick) ----------

function predictedChampionCode() {
  return state.picks.draft.bracket[FINAL_MATCH_ID] || null;
}

function renderTiebreaker() {
  const root = document.getElementById('tiebreaker');
  if (!root) return;
  const disabled = isEditingDisabled();
  const champCode = predictedChampionCode();
  const champ = champCode ? state.teamsByCode[champCode] : null;
  const value = state.picks.draft.tiebreaker ?? '';

  const championLine = champ
    ? `<div class="tiebreaker-champion">
         <strong>Your champion:</strong>
         ${flagHTML(champ.code)}
         <strong>${champ.name}</strong>
       </div>`
    : `<div class="tiebreaker-champion empty">
         Pick the Final winner in the bracket to set your champion.
       </div>`;

  root.innerHTML = `
    ${championLine}
    <label class="tiebreaker-label">
      <span>Predicted average goals per game:</span>
      <input type="number" id="tiebreaker-input" min="0" max="6" step="0.1"
             value="${value}" ${disabled ? 'disabled' : ''}
             placeholder="e.g. 2.3" />
    </label>
    <p class="tiebreaker-note">If two players tie on points, whoever's predicted average is closest to the real tournament average for the actual champion wins the tiebreaker.</p>
  `;
  document.getElementById('tiebreaker-input').addEventListener('input', (e) => {
    const v = e.target.value;
    state.picks.draft.tiebreaker = v === '' ? null : Number(v);
    renderActionsBar();
    renderCountdownBanner();
  });
}

// ---------- Navigation guards (beforeunload + internal link intercept) ----------

function shouldWarnOnLeave() {
  if (isLocked()) return false;
  return isDirty() || !isSubmitted();
}

function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}

function updateNavigationGuards() {
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  if (shouldWarnOnLeave()) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }
}

function showLeaveSiteModal() {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const dirty = isDirty();
    const submitted = isSubmitted();
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal">
          <h2>You haven't saved your progress</h2>
          <p>${
            dirty
              ? 'You have unsaved picks. Save them now, leave without saving, or stay here.'
              : 'Your picks are saved to the database, but you haven\'t hit <strong>Submit</strong> yet.'
          }</p>
          <div class="modal-actions">
            ${dirty ? `<button type="button" class="btn-primary" id="leave-save">Save &amp; continue</button>` : ''}
            ${!submitted ? `<button type="button" class="btn-primary" id="leave-submit">Submit &amp; continue</button>` : ''}
            <button type="button" class="btn-secondary" id="leave-go">Leave without saving</button>
            <button type="button" class="btn-link" id="leave-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;
    const finish = (decision) => {
      root.innerHTML = '';
      resolve(decision);
    };
    document.getElementById('leave-save')?.addEventListener('click', async () => {
      try { await saveDraft(); } catch (err) { console.error(err); }
      finish('save');
    });
    document.getElementById('leave-submit')?.addEventListener('click', async () => {
      try { await submitPicks(); } catch (err) { console.error(err); }
      finish('submit');
    });
    document.getElementById('leave-go').addEventListener('click', () => finish('go'));
    document.getElementById('leave-cancel').addEventListener('click', () => finish('cancel'));
  });
}

function wireInternalLinkGuards() {
  document.addEventListener('click', async (e) => {
    if (!shouldWarnOnLeave()) return;
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;
    e.preventDefault();
    const decision = await showLeaveSiteModal(href);
    if (decision === 'cancel') return;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    location.href = href;
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

function effectiveWinner(matchId, teamA, teamB) {
  const pick = state.picks.draft.bracket[matchId];
  if (!pick) return null;
  if (pick === teamA || pick === teamB) return pick;
  return null;
}

function formatKickoff(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function venueStadium(venue) {
  return venue ? venue.split(',')[0].trim() : '';
}

function venueCity(venue) {
  if (!venue) return '';
  const parts = venue.split(',').map((s) => s.trim());
  return parts[1] || '';
}

function mockResultFor(matchId) {
  const mock = window.MOCK_TOURNAMENT;
  if (!mock || mock.status === 'not_started') return null;
  const r = mock.matchResults?.[matchId];
  return r && r.played ? r : null;
}

function matchCellHTML(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return '';
  const teamA = teamForSlot(matchId, 'a');
  const teamB = teamForSlot(matchId, 'b');
  const disabled = isEditingDisabled();
  const canAdvance = !!(teamA && teamB);
  const winner = effectiveWinner(matchId, teamA, teamB);
  const dest = state.matchDestinations?.[matchId];
  const num = matchId.slice(1);
  const stadium = venueStadium(match.venue);
  const city = venueCity(match.venue);
  const result = mockResultFor(matchId);

  const slotHTML = (position, team) => {
    const isWinner = team && winner === team;
    let resultClass = '';
    if (result && isWinner) {
      resultClass = team === result.winner ? ' is-correct' : ' is-wrong';
    }
    const pill = teamPillHTML(team, { placeholder: '?' });
    if (!team || !canAdvance || disabled) {
      return `<div class="bracket-slot bracket-slot--readonly ${isWinner ? 'is-winner' : ''}${resultClass}">${pill}</div>`;
    }
    return `
      <button type="button" class="bracket-slot ${isWinner ? 'is-winner' : ''}${resultClass}"
              data-match="${matchId}" data-team="${team}" data-action="advance">
        ${pill}
      </button>`;
  };

  const winnerTeam = result ? state.teamsByCode[result.winner] : null;
  const resultBand = result ? `
    <div class="match-result">
      <span class="match-score">${result.score}</span>
      ${winnerTeam ? `<span class="match-result-winner">${flagHTML(winnerTeam.code)}<span>${winnerTeam.name}</span></span>` : ''}
    </div>` : '';

  return `
    <div class="bracket-match${result ? ' is-played' : ''}" data-match-id="${matchId}">
      <div class="bracket-match-meta">
        <span class="bracket-match-num">#${num}</span>
        <span class="bracket-match-when">${formatKickoff(match.kickoff_at)}</span>
      </div>
      ${stadium ? `<div class="bracket-match-venue" title="${match.venue}">${stadium}${city ? ` &middot; ${city}` : ''}</div>` : ''}
      ${slotHTML('a', teamA)}
      ${slotHTML('b', teamB)}
      ${resultBand}
      ${dest ? `<div class="bracket-feed">winner &rarr; <strong>#${dest.slice(1)}</strong></div>` : ''}
    </div>`;
}

function bracketPairOrder() {
  // Walk the bracket backward from the Final, so that within each column
  // the two matches whose winners meet in the next round are adjacent.
  // Returns { r32: [[M74,M77],...], r16: [[M89,M90],...], qf: [...], sf: [...], final: [[M104]] }.
  const out = { r32: [], r16: [], qf: [], sf: [], final: [] };
  const finalMatch = state.matches.find((m) => m.stage === 'final');
  if (!finalMatch) return out;
  out.final = [[finalMatch.id]];
  const feeds = (id) => {
    const m = state.matches.find((x) => x.id === id);
    if (!m) return [null, null];
    const fa = m.slot_a && m.slot_a.startsWith('W') ? 'M' + m.slot_a.slice(1) : null;
    const fb = m.slot_b && m.slot_b.startsWith('W') ? 'M' + m.slot_b.slice(1) : null;
    return [fa, fb];
  };
  const chain = [
    ['sf', 'final'],
    ['qf', 'sf'],
    ['r16', 'qf'],
    ['r32', 'r16'],
  ];
  for (const [stage, prev] of chain) {
    const prevOrder = out[prev].flat();
    const pairs = [];
    for (const prevId of prevOrder) {
      const [a, b] = feeds(prevId);
      if (a && b) pairs.push([a, b]);
    }
    out[stage] = pairs;
  }
  return out;
}

function bracketColumnHTML(round) {
  const pairs = state.bracketPairs?.[round.id] || [];
  // Final has one match; wrap it in a solo .bracket-pair so it gets the same
  // flex: 1 + space-around centering as every other column's pairs. That puts
  // M104 at body 50%, which is where the SF pair midpoint also lands.
  const isFinal = round.id === 'final';
  return `
    <div class="bracket-column bracket-column--${round.id}">
      <header class="bracket-column-header">${round.label}</header>
      <div class="bracket-column-body">
        ${pairs.map((pair) => `
          <div class="bracket-pair${isFinal ? ' bracket-pair--solo' : ''}">
            ${pair.map((id) => matchCellHTML(id)).join('')}
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderBracket() {
  const root = document.getElementById('bracket');
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const wildcardsReady = advancingGroups().length === 8;

  if (!groupsReady || !wildcardsReady) {
    const missing = [];
    if (!groupsReady) missing.push('rank all 12 groups');
    if (!wildcardsReady) missing.push('pick 8 wildcard 3rd-place teams to advance');
    root.innerHTML = `
      <div class="bracket-locked-notice">
        <strong>The bracket auto-fills once your picks are complete.</strong>
        <p>To populate R32, you still need to ${missing.join(' and ')}.</p>
      </div>`;
    renderBracketToolbar();
    return;
  }

  const thirdMatch = state.matches.find((m) => m.stage === 'third');
  state.bracketPairs = bracketPairOrder();
  const mock = window.MOCK_TOURNAMENT;
  const showPreviewPill = mock && mock.status && mock.status !== 'not_started';
  const previewPill = showPreviewPill ? `
    <div class="bracket-progress-pill" role="status">
      <span class="bracket-progress-dot" aria-hidden="true"></span>
      <span class="bracket-progress-label">Live preview</span>
      <span class="bracket-progress-sep" aria-hidden="true">·</span>
      <span class="bracket-progress-asof">${mock.asOfLabel || 'In progress'}</span>
    </div>` : '';
  root.innerHTML = `
    ${previewPill}
    <div class="bracket-board">
      <div class="bracket-grid">
        ${KNOCKOUT_ROUNDS.map(bracketColumnHTML).join('')}
      </div>
      ${thirdMatch ? `
        <div class="bracket-third-place-row">
          <div class="bracket-third-place">
            <h3>3rd Place</h3>
            ${matchCellHTML(thirdMatch.id)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
  renderBracketToolbar();
}

function wireBracketListener() {
  document.getElementById('bracket').addEventListener('click', (e) => {
    if (isEditingDisabled()) return;
    const advance = e.target.closest('[data-action="advance"]');
    if (!advance) return;
    setBracketWinner(advance.dataset.match, advance.dataset.team);
    renderBracket();
    renderTiebreaker(); // champion may have changed
    renderCountdownBanner();
    renderActionsBar();
    maybeAdvanceStage();
  });
}

// ---------- Countdown banner ----------

function renderUserBar() {
  const bar = document.getElementById('user-bar');
  bar.innerHTML = `
    <span class="user-id">
      <svg class="user-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8" cy="5.5" r="2.5" />
        <path d="M3 14 C3 11 5 9.5 8 9.5 C11 9.5 13 11 13 14" />
      </svg>
      <span class="user-name">${state.player.name}</span>
    </span>
    <button id="switch-user" class="link-button">switch</button>
  `;
  document.getElementById('switch-user').addEventListener('click', () => {
    clearStoredPlayer();
    location.reload();
  });
}

// Each cell of the countdown is two flip-card digits. The 8 digits across all
// four cells are addressed by a stable index [0..7] so the per-second tick can
// update them in place (preserving DOM for the flip animation).
function digitsForRemaining(ms) {
  const total = Math.max(0, ms);
  const days  = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const mins  = Math.floor((total % 3_600_000) / 60_000);
  const secs  = Math.floor((total % 60_000) / 1000);
  const pad = (n) => String(Math.min(99, n)).padStart(2, '0');
  return (pad(days) + pad(hours) + pad(mins) + pad(secs)).split('');
}

function flipDigitHTML(idx, digit) {
  // A flip-digit has 4 layers: two halves (the resting state) and two leaves
  // (the animated halves that fold during a change). The halves are clipping
  // containers — the full digit is rendered in each, but only the top half
  // shows in flip-half--top and only the bottom half shows in flip-half--bottom
  // (via flex alignment + overflow:hidden).
  return `
    <span class="flip-digit" data-flip-id="${idx}" data-digit="${digit}">
      <span class="flip-half flip-half--top"><span class="flip-num">${digit}</span></span>
      <span class="flip-half flip-half--bottom"><span class="flip-num">${digit}</span></span>
      <span class="flip-leaf flip-leaf--top"><span class="flip-num">${digit}</span></span>
      <span class="flip-leaf flip-leaf--bottom"><span class="flip-num">${digit}</span></span>
    </span>`;
}

function countdownCellsHTML(ms) {
  const d = digitsForRemaining(ms);
  const cell = (label, i0, i1) => `
    <span class="countdown-cell">
      <span class="countdown-cell-num">
        ${flipDigitHTML(i0, d[i0])}${flipDigitHTML(i1, d[i1])}
      </span>
      <span class="countdown-cell-label">${label}</span>
    </span>`;
  return `
    <div class="countdown-clock">
      ${cell('Days', 0, 1)}
      ${cell('Hrs',  2, 3)}
      ${cell('Min',  4, 5)}
      ${cell('Sec',  6, 7)}
    </div>`;
}

function flipDigit(slot, newDigit) {
  const oldDigit = slot.dataset.digit;
  if (oldDigit === newDigit) return;
  slot.dataset.digit = newDigit;
  // Both resting halves go to NEW immediately. The OLD frame lives only on
  // the top leaf, which is layered on top during the animation and peels
  // away to reveal the NEW underneath.
  slot.querySelector('.flip-half--top    .flip-num').textContent = newDigit;
  slot.querySelector('.flip-half--bottom .flip-num').textContent = newDigit;
  slot.querySelector('.flip-leaf--top    .flip-num').textContent = oldDigit;
  slot.querySelector('.flip-leaf--bottom .flip-num').textContent = newDigit;
  slot.classList.remove('is-flipping');
  // Force layout so removing + re-adding the class restarts the keyframes.
  void slot.offsetWidth;
  slot.classList.add('is-flipping');
  setTimeout(() => slot.classList.remove('is-flipping'), 480);
}

function tickCountdownDigits(remaining) {
  const slots = document.querySelectorAll('#countdown-banner .flip-digit');
  if (slots.length !== 8) return;
  const digits = digitsForRemaining(remaining);
  slots.forEach((slot, idx) => flipDigit(slot, digits[idx]));
}

function refreshProgressLine() {
  const old = document.querySelector('#countdown-banner .countdown-progress');
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = progressLineHTML();
  const next = tmp.querySelector('.countdown-progress');
  if (next) old.replaceWith(next);
}

function tickCountdown() {
  const banner = document.getElementById('countdown-banner');
  if (!banner) return;
  const remaining = new Date(LOCK_DATE_ISO) - new Date();
  const wasLocked = banner.classList.contains('is-locked');
  const nowLocked = remaining <= 0;
  if (wasLocked !== nowLocked) {
    // Lock state flipped — banner structure differs, so do a full rebuild.
    renderCountdownBanner();
    return;
  }
  if (!nowLocked) tickCountdownDigits(remaining);
  refreshProgressLine();
}

function progressLineHTML() {
  const ranked = groupsRankedCount();
  const wcCount = advancingGroups().length;
  const ko = bracketMatches();
  const bracketWinners = ko
    .filter((m) => effectiveWinner(m.id, teamForSlot(m.id, 'a'), teamForSlot(m.id, 'b'))).length;
  const bracketTotal = ko.length;
  const champCode = predictedChampionCode();
  const champTeam = champCode ? state.teamsByCode[champCode] : null;
  const avg = state.picks.draft.tiebreaker;

  const groupsClass = ranked === 12 ? 'ok' : ranked > 0 ? 'warn' : 'dim';
  const wcClass = wcCount === 8 ? 'ok' : wcCount > 0 ? 'warn' : 'dim';
  const brktClass = bracketWinners === bracketTotal ? 'ok' : bracketWinners > 0 ? 'warn' : 'dim';
  const champClass = champTeam && avg != null ? 'ok' : champTeam || avg != null ? 'warn' : 'dim';

  const dirty = isDirty();
  const submitted = isSubmitted();
  let saveStateLabel;
  if (submitted) saveStateLabel = '<span class="ok">✓ Submitted</span>';
  else if (dirty) saveStateLabel = '<span class="warn">● Unsaved changes</span>';
  else saveStateLabel = '<span class="dim">All changes saved</span>';

  return `
    <div class="countdown-progress">
      <span>Groups: <span class="${groupsClass}">${ranked}/12 ranked</span></span>
      <span>Wildcards: <span class="${wcClass}">${wcCount}/8 picked</span></span>
      <span>Bracket: <span class="${brktClass}">${bracketWinners}/${bracketTotal} winners</span></span>
      <span>Tiebreaker: <span class="${champClass}">${
        champTeam ? `${champTeam.code} · ${avg != null ? avg : '—'} avg` : 'no champion yet'
      }</span></span>
      <span>${saveStateLabel}</span>
    </div>`;
}

function renderCountdownBanner() {
  const banner = document.getElementById('countdown-banner');
  if (!banner) return;
  const lockMoment = new Date(LOCK_DATE_ISO);
  const now = new Date();
  const remaining = lockMoment - now;
  const locked = remaining <= 0;

  const whenStr = lockMoment.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const headline = locked
    ? `<div class="countdown-locked">PICKS ARE LOCKED</div>`
    : `<div class="countdown-headline">Picks lock in</div>
       ${countdownCellsHTML(remaining)}`;

  banner.classList.toggle('is-locked', locked);
  banner.innerHTML = `
    ${headline}
    <div class="countdown-when">${locked ? 'First kickoff: ' : ''}${whenStr}</div>
    ${progressLineHTML()}
  `;
  renderStepper();
}

// ---------- Section collapse (Groups + Wildcards) ----------

const COLLAPSIBLE_SECTIONS = ['groups', 'wildcards'];

function readCollapsedPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return (v && typeof v === 'object') ? v : {};
  } catch { return {}; }
}

function writeCollapsedPref(key, collapsed) {
  const prefs = readCollapsedPrefs();
  prefs[key] = !!collapsed;
  try { localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(prefs)); } catch {}
}

function sectionElForKey(key) {
  return document.getElementById(`${key}-section`);
}

function isSectionComplete(key) {
  if (key === 'groups') return isGroupsComplete();
  if (key === 'wildcards') return isWildcardsComplete();
  return false;
}

function sectionSummaryText(key) {
  if (key === 'groups') {
    const done = groupsRankedCount();
    const total = state.groups.length || 12;
    return done === total ? `✓ All ${total} groups ranked` : `${done} of ${total} groups ranked`;
  }
  if (key === 'wildcards') {
    const done = advancingGroups().length;
    return done === 8 ? `✓ 8 wildcards picked` : `${done} of 8 wildcards picked`;
  }
  return '';
}

function setSectionCollapsed(key, collapsed) {
  const section = sectionElForKey(key);
  if (!section) return;
  section.classList.toggle('is-collapsed', !!collapsed);
  const btn = section.querySelector('.section-toggle');
  if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function renderSectionToggle(key) {
  const section = sectionElForKey(key);
  if (!section) return;
  const summarySpan = section.querySelector(`.section-toggle-summary[data-summary-for="${key}"]`);
  if (!summarySpan) return;
  const text = sectionSummaryText(key);
  summarySpan.textContent = text;
  summarySpan.classList.toggle('is-complete', isSectionComplete(key));
}

function initCollapsedSections() {
  const prefs = readCollapsedPrefs();
  for (const key of COLLAPSIBLE_SECTIONS) {
    renderSectionToggle(key);
    const collapsed = (key in prefs) ? !!prefs[key] : isSectionComplete(key);
    setSectionCollapsed(key, collapsed);
  }
}

function wireSectionToggles() {
  document.querySelector('main')?.addEventListener('click', (e) => {
    // Stepper anchor → ensure target section is expanded before scroll lands.
    const step = e.target.closest('.step');
    if (step) {
      const href = step.getAttribute('href') || '';
      const id = href.startsWith('#') ? href.slice(1) : '';
      const key = id === 'groups-section' ? 'groups' : id === 'wildcards-section' ? 'wildcards' : null;
      if (key) {
        setSectionCollapsed(key, false);
        writeCollapsedPref(key, false);
      }
      return;
    }
    // Section header collapse toggle.
    const toggle = e.target.closest('.section-toggle');
    if (!toggle) return;
    const section = toggle.closest('.pick-section');
    if (!section) return;
    const id = section.id;
    const key = id === 'groups-section' ? 'groups' : id === 'wildcards-section' ? 'wildcards' : null;
    if (!key) return;
    const willCollapse = !section.classList.contains('is-collapsed');
    setSectionCollapsed(key, willCollapse);
    writeCollapsedPref(key, willCollapse);
  });
}

function renderStepper() {
  const el = document.getElementById('pick-stepper');
  if (!el) return;
  const groupsTotal = state.groups.length || 12;
  const groupsDone = groupsRankedCount();
  const groupsComplete = groupsTotal > 0 && groupsDone === groupsTotal;

  const wildcardsTotal = 8;
  const wildcardsDone = advancingGroups().length;
  const wildcardsComplete = wildcardsDone === wildcardsTotal;

  const ko = bracketMatches();
  const bracketTotal = ko.length;
  const bracketDone = ko.filter((m) => state.picks.draft.bracket[m.id]).length;
  const bracketComplete = bracketTotal > 0 && bracketDone === bracketTotal;

  const tbDone = state.picks.draft.tiebreaker != null ? 1 : 0;
  const tbComplete = tbDone === 1;

  let s1, s2, s3, s4;
  s1 = groupsComplete ? 'is-complete' : 'is-current';
  if (!groupsComplete) s2 = 'is-locked';
  else if (wildcardsComplete) s2 = 'is-complete';
  else s2 = 'is-current';
  if (!wildcardsComplete) s3 = 'is-locked';
  else if (bracketComplete) s3 = 'is-complete';
  else s3 = 'is-current';
  if (!bracketComplete) s4 = 'is-locked';
  else if (tbComplete) s4 = 'is-complete';
  else s4 = 'is-current';

  const stepHTML = (n, href, name, done, total, st) => {
    const numContent = st === 'is-complete' ? '✓' : n;
    const countText = st === 'is-locked'
      ? 'Locked'
      : (st === 'is-complete' ? `${done} / ${total} ✓` : `${done} / ${total}`);
    return `
      <a href="${href}" class="step ${st}">
        <span class="step-num">${numContent}</span>
        <div class="step-meta">
          <span class="step-name">${name}</span>
          <span class="step-count">${countText}</span>
        </div>
      </a>`;
  };

  el.innerHTML = `
    ${stepHTML(1, '#groups-section', 'Group Stage', groupsDone, groupsTotal, s1)}
    <span class="step-arrow" aria-hidden="true">→</span>
    ${stepHTML(2, '#wildcards-section', 'Wildcards', wildcardsDone, wildcardsTotal, s2)}
    <span class="step-arrow" aria-hidden="true">→</span>
    ${stepHTML(3, '#bracket-section', 'Bracket', bracketDone, bracketTotal, s3)}
    <span class="step-arrow" aria-hidden="true">→</span>
    ${stepHTML(4, '#tiebreaker-section', 'Tiebreaker', tbDone, 1, s4)}
  `;
}

function startCountdownTicker() {
  // Tick once per second. tickCountdown() updates only the digits in place
  // (preserving the flip-card DOM so the flip animation can play) plus the
  // progress line. Full re-renders happen only when the lock state changes.
  setInterval(tickCountdown, 1000);
}

// ---------- Init ----------

async function init() {
  let player = getStoredPlayer();
  if (!player) player = await showPlayerPicker();
  state.player = player;

  renderUserBar();
  await Promise.all([loadReferenceData(), loadCurrentPlayer()]);
  await loadMyPicks();
  renderAll();
  initCollapsedSections();
  wireGroupsGrid();
  wireWildcards();
  wireBracketListener();
  wireActionsBar();
  wireSectionToolbars();
  wireSectionToggles();
  wireInternalLinkGuards();
  startCountdownTicker();
}

document.addEventListener('DOMContentLoaded', init);
