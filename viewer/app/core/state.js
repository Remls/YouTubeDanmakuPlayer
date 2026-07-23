/* Global state + persisted settings (localStorage only, nothing leaves the browser). */

const KEY_API = 'dm.key';
const KEY_SETTINGS = 'dm.settings';
const KEY_MODE = 'dm.mode';
const KEY_POS = 'dm.pos';
const MAX_POSITIONS = 100;

export const DEFAULTS = {
  style: 'scroll',      // 'scroll' | 'popup'
  popupV: 'top',        // popup vertical side: 'top' | 'bottom'
  popupH: 'right',      // popup horizontal position: 'left' | 'center' | 'right'
  popupWidth: 340,      // popup box width, px (capped at 80% of the player)
  duration: 8,          // seconds to cross the screen
  fontSize: 20,         // px
  opacity: 85,          // %
  coverage: 40,         // % of video height used for scroll lanes
  maxOnScreen: 15,
  maxLength: 120,       // chars before overlay truncation
  allReplies: false,    // fetch replies beyond the 5 the API inlines
};

export const STATE = {
  apiKey: localStorage.getItem(KEY_API) || '',
  settings: loadSettings(),
  mode: localStorage.getItem(KEY_MODE) === 'theater' ? 'theater' : 'default',
  videoId: null,
  video: null,          // { title, channel, duration, thumb }
  comments: [],         // all comments, replies flattened in
  danmaku: [],          // timestamped subset, sorted asc by ts
  commentsError: null,  // 'disabled' | 'quota' | null
  player: null,         // YT.Player
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings() {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(STATE.settings));
}

export function setApiKey(key) {
  STATE.apiKey = key || '';
  if (key) localStorage.setItem(KEY_API, key);
  else localStorage.removeItem(KEY_API);
}

/* Last playback position per video, so a video resumes where it was left.
   Best-effort: any storage failure just means starting from 0. */
export function savedPosition(videoId) {
  try { return JSON.parse(localStorage.getItem(KEY_POS) || '{}')[videoId]?.t || 0; } catch { return 0; }
}

export function savePosition(videoId, t) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_POS) || '{}');
    if (t == null) delete all[videoId];
    else all[videoId] = { t: Math.floor(t), at: Date.now() };
    const ids = Object.keys(all);
    if (ids.length > MAX_POSITIONS) {
      ids.sort((a, b) => all[a].at - all[b].at);
      for (const old of ids.slice(0, ids.length - MAX_POSITIONS)) delete all[old];
    }
    localStorage.setItem(KEY_POS, JSON.stringify(all));
  } catch { /* storage full or blocked */ }
}

export const dropPosition = (videoId) => savePosition(videoId, null);

export function setMode(mode) {
  STATE.mode = mode;
  if (mode === 'default' || mode === 'theater') localStorage.setItem(KEY_MODE, mode);
}
