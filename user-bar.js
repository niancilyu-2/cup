// ABOUTME: Shared header chip showing the active player + switch button.
// ABOUTME: Loaded on every page so the identity travels across tabs.

(function () {
  const KEY = 'wcbracket.player';

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Deterministic auto-avatar from the player id (stable across renames).
  function avatarUrl(id) {
    return `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(id)}`;
  }

  function render() {
    const bar = document.getElementById('user-bar');
    if (!bar) return;
    let player = null;
    try {
      const raw = localStorage.getItem(KEY);
      player = raw ? JSON.parse(raw) : null;
    } catch (_) { player = null; }
    if (!player || !player.name) {
      bar.innerHTML = '';
      return;
    }
    bar.innerHTML = `
      <span class="user-id">
        <img class="user-avatar" src="${avatarUrl(player.id)}" alt="" />
        <span class="user-name">${escapeHTML(player.name)}</span>
      </span>
      <button id="switch-user" class="link-button" type="button">switch</button>
    `;
    document.getElementById('switch-user').addEventListener('click', () => {
      // Open the login picker on the picks page WITHOUT clearing the session,
      // so the user can close it and stay signed in as themselves.
      location.href = './?login=1';
    });
  }

  window.renderUserBar = render;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
