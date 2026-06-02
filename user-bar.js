// ABOUTME: Shared header chip showing the active player + switch button.
// ABOUTME: Loaded on every page so the identity travels across tabs.

(function () {
  const KEY = 'wcbracket.player';

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        <svg class="user-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 14 C3 11 5 9.5 8 9.5 C11 9.5 13 11 13 14" />
        </svg>
        <span class="user-name">${escapeHTML(player.name)}</span>
      </span>
      <button id="switch-user" class="link-button" type="button">switch</button>
    `;
    document.getElementById('switch-user').addEventListener('click', () => {
      localStorage.removeItem(KEY);
      // Redirect to the picks page (directory root) so the player picker shows.
      location.href = './';
    });
  }

  window.renderUserBar = render;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
