/* Topbar dropdown: the player controls behind one gear button. */

import { STATE } from '../core/state.js';
import { $, el, homeUrl } from '../core/util.js';
import { applyMode, toggleDm } from '../views/player.js';
import { buildShareMenu } from './copy.js';
import { showLanding } from './landing.js';
import { openSettings } from './settings.js';

export function buildTopMenu() {
  const host = $('#menuHost');
  host.innerHTML = '';
  const gear = el('button', { class: 'icon-btn', title: 'Menu', 'aria-label': 'Menu' }, [el('i', { class: 'ph ph-gear-six' })]);
  const pop = el('div', { class: 'menu-pop', hidden: '' });
  const sep = () => el('div', { class: 'menu-sep' });

  const item = (icon, label, extra) => el('button', { class: 'menu-item' }, [
    el('i', { class: 'ph ' + icon }),
    el('span', { class: 'menu-label', text: label }),
    extra,
  ]);

  let tsTimer = null;
  const onDoc = (e) => { if (!host.contains(e.target)) close(); };
  function close() {
    pop.hidden = true;
    clearInterval(tsTimer);
    tsTimer = null;
    document.removeEventListener('click', onDoc);
  }

  /* Toggles keep the menu open; their switches mirror state (see toggleDm
     and applyMode in player.js). */
  const dmItem = item('ph-meteor dm-glyph', 'Toggle danmaku', el('span', { id: 'menuDmSw', class: 'switch on' }));
  dmItem.onclick = (e) => { e.stopPropagation(); toggleDm(); };

  const thItem = item('ph-sidebar-simple', 'Theatre view',
    el('span', { id: 'menuTheaterSw', class: 'switch' + (STATE.mode === 'theater' ? ' on' : '') }));
  thItem.onclick = (e) => { e.stopPropagation(); applyMode(STATE.mode === 'theater' ? 'default' : 'theater'); };

  const fsItem = item('ph-corners-out', 'Fullscreen view');
  fsItem.onclick = () => { close(); $('#stage').requestFullscreen?.(); };

  /* Share: expands in place to the shared share entries (see copy.js). */
  const copyWrap = el('div', { class: 'menu-sub-wrap' });
  const copyToggle = item('ph-share-network', 'Share', el('i', { class: 'ph ph-caret-right menu-caret' }));
  const copySub = el('div', { class: 'menu-sub', hidden: '' });
  const updateShare = buildShareMenu(copySub);
  const updateTs = () => { if (!copySub.hidden) updateShare(); };
  copyToggle.onclick = (e) => {
    e.stopPropagation();
    copySub.hidden = !copySub.hidden;
    updateTs();
    copyToggle.querySelector('.menu-caret').classList.toggle('open', !copySub.hidden);
  };
  copyWrap.append(copyToggle, copySub);

  const loadItem = item('ph-film-strip', 'Load another video');
  loadItem.onclick = () => { close(); history.pushState({}, '', homeUrl()); showLanding(); };

  const setItem = item('ph-gear', 'App settings');
  setItem.onclick = () => { close(); openSettings(); };

  pop.append(dmItem, thItem, fsItem, sep(), copyWrap, sep(), loadItem, setItem);
  host.append(gear, pop);

  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) {
      pop.hidden = false;
      updateTs();
      tsTimer = setInterval(updateTs, 250);
      setTimeout(() => document.addEventListener('click', onDoc), 0);
    } else close();
  });
}
