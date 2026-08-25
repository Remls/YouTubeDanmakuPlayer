/* Share menus: YouTube Danmaku or plain YouTube link, with an optional
   current-time timestamp. Used by the topbar dropdown and the fullscreen
   cluster; the timestamp toggle state is shared between them. */

import { STATE } from '../core/state.js';
import { el, fmtTime, routeUrl, youtubeUrl } from '../core/util.js';

const appUrl = (t) => location.origin + routeUrl(STATE.videoId, t);
const curTime = () => STATE.player?.getCurrentTime?.() || 0;

let withTs = false;
const switches = new Set();

/* Builds the share entries into `menu` and returns an updater that refreshes
   the timestamp label; call it while the menu is visible. Copy feedback
   flashes the entry label; entries keep the menu open. */
export function buildShareMenu(menu) {
  const tsLabel = el('span', { class: 'menu-label', text: 'With timestamp' });
  const tsSw = el('span', { class: 'switch' + (withTs ? ' on' : '') });
  switches.add(tsSw);
  const tsItem = el('button', { class: 'menu-item' }, [tsLabel, tsSw]);
  tsItem.onclick = (e) => {
    e.stopPropagation();
    withTs = !withTs;
    for (const sw of switches) sw.classList.toggle('on', withTs);
  };

  const entry = (label, urlFn) => {
    const b = el('button', { class: 'menu-item' }, [el('span', { text: label })]);
    b.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(urlFn());
        b.firstChild.textContent = 'Copied ✓';
        setTimeout(() => { b.firstChild.textContent = label; }, 1200);
      } catch { /* clipboard unavailable (insecure context) */ }
    };
    return b;
  };

  menu.append(
    tsItem,
    entry('YouTube Danmaku link', () => appUrl(withTs ? curTime() : 0)),
    entry('YouTube link', () => youtubeUrl(STATE.videoId, withTs ? curTime() : 0)),
  );
  return () => { tsLabel.textContent = `With timestamp (${fmtTime(curTime())})`; };
}

/* Wires `btn` to toggle the share flyout `menu`, refreshing the timestamp
   label while it is open. */
export function wireShareMenu(btn, menu) {
  const update = buildShareMenu(menu);
  setInterval(() => { if (!menu.hidden) update(); }, 250);
  btn.onclick = () => {
    if (!STATE.videoId) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) update();
  };
}

/* One outside-click closer for every share flyout (sort menus have their own). */
document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('.copy-menu:not(.sort-menu)')) {
    if (!m.hidden && !m.parentElement.contains(e.target)) m.hidden = true;
  }
});
