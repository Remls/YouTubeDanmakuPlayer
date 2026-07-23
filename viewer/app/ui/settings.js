/* Settings page: overlay parameters, comment fetching, API key. */

import { clearCache, countCached } from '../core/cache.js';
import { DEFAULTS, rebuildDanmaku, STATE, saveSettings, setApiKey } from '../core/state.js';
import { $, clamp, el } from '../core/util.js';
import { buildBrowser, renderPanelList } from '../views/list.js';
import { resyncDanmaku } from '../views/player.js';

export function openSettings() { buildSettings(); $('#settingsView').hidden = false; }
export function closeSettings() { $('#settingsView').hidden = true; }

function row(label, control, hint) {
  return el('div', { class: 'set-row' }, [
    el('div', { class: 'set-label' }, [el('span', { text: label }), hint ? el('small', { text: hint }) : null]),
    control,
  ]);
}

function range(key, min, max, step, unit) {
  const val = el('span', { class: 'set-val', text: STATE.settings[key] + unit });
  const input = el('input', {
    type: 'range', min, max, step, value: STATE.settings[key],
    oninput: (e) => {
      STATE.settings[key] = clamp(+e.target.value, min, max);
      val.textContent = STATE.settings[key] + unit;
      saveSettings();
    },
  });
  return el('div', { class: 'set-range' }, [input, val]);
}

/* Segmented picker for one settings key. options: [[value, label], ...] */
function seg(key, options, onChange) {
  return el('div', { class: 'seg' }, options.map(([v, label]) =>
    el('button', {
      class: 'seg-btn' + (STATE.settings[key] === v ? ' active' : ''),
      text: label,
      onclick: (e) => {
        STATE.settings[key] = v;
        saveSettings();
        for (const b of e.target.parentElement.children) b.classList.toggle('active', b === e.target);
        onChange?.(v);
      },
    })));
}

function toggle(key, onChange) {
  const sw = el('button', { class: 'switch' + (STATE.settings[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!STATE.settings[key]) });
  sw.onclick = () => {
    STATE.settings[key] = !STATE.settings[key];
    sw.classList.toggle('on', STATE.settings[key]);
    sw.setAttribute('aria-checked', String(STATE.settings[key]));
    saveSettings();
    onChange?.(STATE.settings[key]);
  };
  return sw;
}

function buildSettings() {
  const root = $('#settingsBody');
  root.innerHTML = '';

  /* Overlay */
  root.append(el('h3', { class: 'set-title', text: 'Overlay' }));
  const posRow = row('Popup position', el('div', { class: 'seg-group' }, [
    seg('popupV', [['top', 'Top'], ['bottom', 'Bottom']]),
    seg('popupH', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]),
  ]));
  const widthRow = row('Popup width', range('popupWidth', 200, 600, 10, 'px'), 'capped at 80% of the player');
  const popupOnly = (v) => { posRow.hidden = widthRow.hidden = v !== 'popup'; };
  popupOnly(STATE.settings.style);
  root.append(row('Style', seg('style', [['scroll', 'Scroll'], ['popup', 'Popup']], popupOnly)));
  root.append(posRow, widthRow);
  root.append(row('Scroll speed', range('duration', 4, 16, 1, 's'), 'time to cross the screen'));
  root.append(row('Font size', range('fontSize', 14, 32, 1, 'px')));
  root.append(row('Opacity', range('opacity', 30, 100, 5, '%')));
  root.append(row('Lane coverage', range('coverage', 20, 100, 5, '%'), 'share of video height used'));
  root.append(row('Max on screen', range('maxOnScreen', 3, 50, 1, '')));
  root.append(row('Max length', range('maxLength', 40, 300, 10, ''), 'characters before truncation'));
  root.append(row('Current time', toggle('showTime'), 'time / duration on the video'));

  /* Comments */
  root.append(el('h3', { class: 'set-title', text: 'Comments' }));
  root.append(row('Fetch all replies', toggle('allReplies'), 'slower on big videos, applies on next load'));
  root.append(row('Include replies', toggle('includeReplies', () => {
    if (!STATE.videoId) return;
    rebuildDanmaku();
    resyncDanmaku();
    buildBrowser();
    renderPanelList();
  }), 'in the timed view and danmaku overlay'));

  /* Cached comment data: clear needs a second click to confirm. */
  const clearBtn = el('button', { class: 'btn secondary', text: 'Clear all' });
  let clearTimer = null;
  clearBtn.onclick = async () => {
    if (clearTimer == null) {
      clearBtn.textContent = 'Sure?';
      clearTimer = setTimeout(() => { clearTimer = null; clearBtn.textContent = 'Clear all'; }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearTimer = null;
    await clearCache();
    clearBtn.textContent = 'Cleared';
    clearBtn.disabled = true;
    cacheRow.querySelector('small').textContent = 'nothing stored';
  };
  const cacheRow = row('Cached comment data', clearBtn, 'stored on this device');
  root.append(cacheRow);
  countCached().then((n) => {
    cacheRow.querySelector('small').textContent = n ? `${n} video${n === 1 ? '' : 's'} stored on this device` : 'nothing stored';
    if (!n) clearBtn.disabled = true;
  });

  /* API key */
  root.append(el('h3', { class: 'set-title', text: 'API key' }));
  const masked = STATE.apiKey ? STATE.apiKey.slice(0, 6) + '\u2026' + STATE.apiKey.slice(-4) : 'none';
  const keyRow = el('div', { class: 'set-key' }, [
    el('code', { text: masked }),
    el('button', { class: 'btn secondary', text: 'Change', onclick: () => changeKey(keyRow) }),
    STATE.apiKey ? el('button', { class: 'btn secondary', text: 'Clear', onclick: () => {
      setApiKey(''); location.hash = ''; location.reload();
    } }) : null,
  ]);
  root.append(keyRow);
  root.append(el('p', { class: 'set-note', text: 'Stored in this browser only. Sent only to googleapis.com.' }));

  root.append(el('button', { class: 'btn secondary set-reset', text: 'Reset overlay defaults', onclick: () => {
    Object.assign(STATE.settings, DEFAULTS, { allReplies: STATE.settings.allReplies });
    saveSettings(); buildSettings();
  } }));
}

function changeKey(keyRow) {
  const input = el('input', { class: 'tb-search', type: 'text', placeholder: 'Paste new key', spellcheck: 'false' });
  const save = el('button', { class: 'btn', text: 'Save', onclick: () => {
    const v = input.value.trim();
    if (v) { setApiKey(v); buildSettings(); }
  } });
  keyRow.replaceWith(el('div', { class: 'set-key' }, [input, save]));
  input.focus();
}
