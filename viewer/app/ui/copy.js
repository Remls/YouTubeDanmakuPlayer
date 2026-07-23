/* Copy-link menus: app deep link or plain YouTube URL, with or without the
   current playback position. Used by the topbar and the fullscreen cluster. */

import { STATE } from '../core/state.js';
import { el, youtubeUrl } from '../core/util.js';

const appUrl = (t) => location.origin + location.pathname + '#v=' + STATE.videoId + (t ? '&t=' + Math.floor(t) : '');
const curTime = () => STATE.player?.getCurrentTime?.() || 0;

/* Builds the menu entries into `menu` and wires `btn` to toggle it.
   The button's icon flashes a checkmark as copy feedback. */
export function wireCopyMenu(btn, menu) {
  const entry = (label, urlFn) => el('button', { text: label, onclick: async () => {
    try {
      await navigator.clipboard.writeText(urlFn());
      const icon = btn.querySelector('i');
      icon.className = 'ph ph-check';
      setTimeout(() => { icon.className = 'ph ph-link'; }, 1200);
    } catch { /* clipboard unavailable (insecure context) */ }
    menu.hidden = true;
  } });
  menu.append(
    entry('Copy link at current time', () => appUrl(curTime())),
    entry('Copy link', () => appUrl(0)),
    el('div', { class: 'copy-sep' }),
    entry('YouTube link at current time', () => youtubeUrl(STATE.videoId, curTime())),
    entry('YouTube link', () => youtubeUrl(STATE.videoId, 0)),
  );
  btn.onclick = () => { if (STATE.videoId) menu.hidden = !menu.hidden; };
}

/* One outside-click closer for every copy menu (sort menus have their own). */
document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('.copy-menu:not(.sort-menu)')) {
    if (!m.hidden && !m.parentElement.contains(e.target)) m.hidden = true;
  }
});
