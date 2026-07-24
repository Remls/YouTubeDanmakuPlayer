/* The stage: player + danmaku layer + side panel, three viewing modes,
   and the 250ms poll loop that drives overlay firing and panel follow. */

import { dropPosition, savedPanelHeight, savedPanelWidth, savedPosition, savePanelHeight, savePanelWidth, savePosition, STATE, setMode } from '../core/state.js';
import { $, fmtTime, upperBound } from '../core/util.js';
import { loadIframeAPI } from '../core/yt.js';
import { wireCopyMenu } from '../ui/copy.js';
import { openSettings } from '../ui/settings.js';
import { Danmaku } from './danmaku.js';
import { panelFollow, panelState, renderPanelList } from './list.js';

let dm = null;
let pollTimer = null;
let lastTime = -1;
let cursor = 0;          // index into STATE.danmaku (asc by ts) of the next comment to fire
let lastPosSave = 0;     // performance.now() of the last position write
let endedCleared = false;

/* Re-aim the firing cursor after STATE.danmaku is rebuilt (settings change). */
export function resyncDanmaku() {
  cursor = upperBound(STATE.danmaku, lastTime);
}

/* Live streams: chat messages fly as they arrive, no timestamp cursor. */
export function spawnLive(comment) {
  dm?.spawn(comment);
}

export function seekTo(t) {
  STATE.player?.seekTo(t, true);
  STATE.player?.playVideo();
}

/* YT.Player replaces the mount div with an iframe and destroy() removes it,
   so every mount starts from a fresh <div id="yt">. */
function freshMount() {
  try { STATE.player?.destroy(); } catch { /* already gone */ }
  STATE.player = null;
  document.getElementById('yt')?.remove();
  const div = document.createElement('div');
  div.id = 'yt';
  $('#playerBox').prepend(div);
}

export async function mountPlayer(videoId, startAt = null) {
  const YT = await loadIframeAPI();
  freshMount();
  dm = new Danmaku($('#dmLayer'));
  dm.enabled = $('#dmToggle').classList.contains('active');

  /* An explicit #t= deep link wins; otherwise resume where this video was
     left, unless that is basically the start or the end. */
  let start = 0;
  const dur = STATE.video?.duration || 0;
  if (startAt != null) {
    start = Math.max(0, Math.floor(startAt));
  } else {
    const saved = savedPosition(videoId);
    if (saved > 5 && (!dur || saved < dur - 10)) start = saved;
  }

  await new Promise((resolve) => {
    STATE.player = new YT.Player('yt', {
      videoId,
      playerVars: { rel: 0, fs: 0, playsinline: 1, start },
      events: { onReady: resolve },
    });
  });
  cursor = 0;
  lastTime = -1;
  lastPosSave = 0;
  endedCleared = false;
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 250);
}

function rememberPosition() {
  if (STATE.videoId && typeof STATE.player?.getCurrentTime === 'function') {
    savePosition(STATE.videoId, STATE.player.getCurrentTime());
  }
}

export function unmountPlayer() {
  clearInterval(pollTimer);
  pollTimer = null;
  rememberPosition();
  try { STATE.player?.destroy(); } catch { /* already gone */ }
  STATE.player = null;
  dm?.clear();
  dm = null;
}

function poll() {
  const p = STATE.player;
  if (!p || typeof p.getCurrentTime !== 'function') return;
  const cur = p.getCurrentTime();
  const playerState = p.getPlayerState?.();
  const playing = playerState === 1;

  if (playing) {
    endedCleared = false;
    if (performance.now() - lastPosSave > 3000) {
      lastPosSave = performance.now();
      savePosition(STATE.videoId, cur);
    }
  } else if (playerState === 0 && !endedCleared) {
    endedCleared = true;   /* watched to the end: next open starts fresh */
    dropPosition(STATE.videoId);
  }

  if (playing && lastTime >= 0) {
    const delta = cur - lastTime;
    if (delta > 0 && delta <= 1.5) {
      /* Normal playback: fire everything in (lastTime, cur]. */
      while (cursor < STATE.danmaku.length && STATE.danmaku[cursor].ts <= cur) {
        if (STATE.danmaku[cursor].ts > lastTime) dm.spawn(STATE.danmaku[cursor]);
        cursor++;
      }
    } else if (Math.abs(delta) > 1.5) {
      /* Seek: resync the cursor, no retro-firing. */
      cursor = upperBound(STATE.danmaku, cur);
    }
  } else if (Math.abs(cur - lastTime) > 1.5) {
    cursor = upperBound(STATE.danmaku, cur);
  }

  updateTimeOverlay(cur);
  panelFollow(cur);
  lastTime = cur;
}

/* Current time / duration, bottom-left of the video; bottom-right when
   bottom-left is where popups spawn. Live streams have no meaningful
   time / duration: a red dot + LIVE instead. */
function updateTimeOverlay(cur) {
  const s = STATE.settings;
  const box = $('#timeOverlay');
  box.hidden = !s.showTime;
  if (box.hidden) return;
  box.classList.toggle('right', s.style === 'popup' && s.popupV === 'bottom' && s.popupH === 'left');
  if (STATE.video?.live) {
    if (box.dataset.live !== '1') {
      box.dataset.live = '1';
      box.innerHTML = '<span class="live-dot"></span>LIVE';
    }
    return;
  }
  delete box.dataset.live;
  const dur = STATE.video?.duration || STATE.player?.getDuration?.() || 0;
  box.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
}

/* ---------------- resizable side panel ---------------- */

const PANEL_MIN = 170;     // px, narrowest useful side panel
const PLAYER_MIN = 320;    // px, never squeeze the video narrower than this
const PANEL_MIN_H = 140;   // px, column layout: shortest useful panel
const PLAYER_MIN_H = 220;  // px, column layout: room kept for the video
const SNAP_PX = 24;        // snap when a drag ends within this of a target

let reclampPanel = () => {};

function initPanelResize(stage) {
  const grip = $('#panelResize');
  const panel = $('#panel');
  /* Side layout resizes width; the narrow below-video layout resizes height. */
  const column = () => getComputedStyle(stage).flexDirection === 'column';
  const applyW = (w) => stage.style.setProperty('--panel-w', Math.round(w) + 'px');
  const applyH = (h) => stage.style.setProperty('--panel-h', Math.round(h) + 'px');
  const clampW = (w) => {
    const max = stage.getBoundingClientRect().width - PLAYER_MIN;
    return Math.min(Math.max(w, PANEL_MIN), Math.max(PANEL_MIN, max));
  };
  const clampH = (h) => {
    const max = window.innerHeight - PLAYER_MIN_H;
    return Math.min(Math.max(h, PANEL_MIN_H), Math.max(PANEL_MIN_H, max));
  };

  if (savedPanelWidth()) applyW(savedPanelWidth());
  if (savedPanelHeight()) applyH(savedPanelHeight());

  /* Delta from the drag start; in the column layout the video absorbs what
     the panel gives up, so edge-relative math would feed back. */
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, w: panel.offsetWidth, h: panel.offsetHeight, col: column() };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const track = (e) => (drag.col ? clampH(drag.h + (drag.y - e.clientY)) : clampW(drag.w + (drag.x - e.clientX)));
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.col) applyH(track(e)); else applyW(track(e));
  });
  const end = (e) => {
    if (!drag) return;
    let v = track(e);
    const r = stage.getBoundingClientRect();
    if (drag.col) {
      /* Snap target: the layout's default, video at exactly 16:9. */
      const def = r.height - r.width * (9 / 16);
      if (Math.abs(v - def) <= SNAP_PX) v = def;
      applyH(v);
      savePanelHeight(Math.round(v));
    } else {
      /* Snap targets: fill (16:9 video exactly fills the stage height, no
         letterbox), the default width, and minimum. */
      for (const t of [r.width - r.height * (16 / 9), 360, PANEL_MIN]) {
        if (t >= PANEL_MIN && t <= r.width - PLAYER_MIN && Math.abs(v - t) <= SNAP_PX) { v = t; break; }
      }
      applyW(v);
      savePanelWidth(Math.round(v));
    }
    drag = null;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  /* Bounds change with viewport, fullscreen, and mode switches. */
  reclampPanel = () => {
    if (!panel.offsetWidth) return;   /* panel not in layout */
    if (column()) applyH(clampH(panel.offsetHeight));
    else applyW(clampW(panel.offsetWidth));
  };
  window.addEventListener('resize', reclampPanel);
}

/* ---------------- viewing modes ---------------- */

/* mode is 'default' or 'theater'; fullscreen is orthogonal, handled via
   the is-fullscreen class in wireStage. */
export function applyMode(mode) {
  setMode(mode);
  const wrap = $('#stageWrap');
  wrap.classList.toggle('mode-theater', mode === 'theater');
  wrap.classList.toggle('mode-default', mode === 'default');
  $('#btnMode').classList.toggle('active', mode === 'theater');
  if (mode === 'theater' && panelState.tsOnly) panelState.follow = true;
  requestAnimationFrame(() => {
    reclampPanel();
    dm?.clear();
    /* The panel only has real dimensions once visible; re-render so lists
       that anchor to the bottom (live chat) land in the right place. */
    if (mode === 'theater') renderPanelList();
  });
}

/* YouTube-style shortcuts, forwarded to the player API (the iframe itself
   never has focus, so keys land on our document). */
const SEEK_KEYS = { ArrowLeft: -5, ArrowRight: 5, j: -10, J: -10, l: 10, L: 10 };

function onKeydown(e) {
  const p = STATE.player;
  if (!p || typeof p.getPlayerState !== 'function') return;
  if ($('#app').hidden || !$('#settingsView').hidden) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;

  const k = e.key;
  if (k === ' ' && t.tagName === 'BUTTON') return;   /* space still activates a focused button */

  if (k === ' ' || k === 'k' || k === 'K') {
    if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo();
  } else if (Object.hasOwn(SEEK_KEYS, k)) {
    p.seekTo(Math.max(0, p.getCurrentTime() + SEEK_KEYS[k]), true);
  } else if (k === 'ArrowUp' || k === 'ArrowDown') {
    p.setVolume(Math.min(100, Math.max(0, p.getVolume() + (k === 'ArrowUp' ? 5 : -5))));
  } else if (k === 'm' || k === 'M') {
    if (p.isMuted()) p.unMute(); else p.mute();
  } else if (k === 'f' || k === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#stage').requestFullscreen?.();
  } else if (/^[0-9]$/.test(k)) {
    const d = STATE.video?.duration;
    if (d) p.seekTo(d * (+k / 10), true);
  } else {
    return;
  }
  e.preventDefault();
}

export function wireStage() {
  $('#btnMode').onclick = () => applyMode(STATE.mode === 'theater' ? 'default' : 'theater');
  document.addEventListener('keydown', onKeydown);

  const stage = $('#stage');
  initPanelResize(stage);
  $('#btnFullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen?.();
  };

  /* Fade the floating fullscreen controls after a few idle seconds; any
     tap or mouse movement brings them back. While faded they stay clickable,
     but that first interaction only wakes them (mousemove over a button on
     desktop reveals it before the click, so clicks act immediately there). */
  let idleTimer = null;
  let idleAtPress = false;
  const wakeControls = () => {
    stage.classList.remove('controls-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stage.classList.add('controls-idle'), 2500);
  };
  stage.addEventListener('mousemove', wakeControls, { passive: true });
  stage.addEventListener('pointerdown', () => {
    idleAtPress = stage.classList.contains('controls-idle');
    wakeControls();
  }, { passive: true });
  const wakeOrRun = (fn) => () => { if (!idleAtPress) fn(); };

  /* Fullscreen control cluster: floating on the video's right edge.
     #fsPanel toggles the comments panel; its caret mirrors the state. */
  const syncPanelBtn = () => {
    const hidden = stage.classList.contains('panel-hidden');
    $('#fsPanel .ph').className = 'ph ' + (hidden ? 'ph-caret-double-left' : 'ph-caret-double-right');
    $('#fsPanel').title = hidden ? 'Show comments' : 'Hide comments';
  };
  $('#fsExit').onclick = wakeOrRun(() => document.exitFullscreen());
  $('#fsPanel').onclick = wakeOrRun(() => { stage.classList.toggle('panel-hidden'); syncPanelBtn(); });
  $('#fsDm').onclick = wakeOrRun(toggleDm);
  $('#fsSettings').onclick = wakeOrRun(openSettings);
  wireCopyMenu($('#fsCopy'), $('#fsCopyMenu'));
  const copyToggle = $('#fsCopy').onclick;
  $('#fsCopy').onclick = wakeOrRun(copyToggle);

  document.addEventListener('fullscreenchange', () => {
    const fs = document.fullscreenElement === stage;
    stage.classList.toggle('is-fullscreen', fs);
    stage.classList.remove('panel-hidden');
    syncPanelBtn();
    /* Fullscreen starts with the panel toolbar tucked away; scrolling the
       list down reveals it (see the panel scroll handler). */
    $('#panel').classList.toggle('bar-collapsed', fs);
    if (fs) { renderPanelList(); if (panelState.tsOnly) panelState.follow = true; }
    /* Best-effort landscape on phones; 'landscape' (not -primary) still lets
       gravity flip between the two orientations. Unsupported (iOS, desktop)
       throws or rejects: ignore. */
    try {
      if (fs) screen.orientation?.lock?.('landscape').catch(() => {});
      else screen.orientation?.unlock?.();
    } catch { /* unsupported */ }
    wakeControls();
    reclampPanel();
    dm?.clear();
  });

  window.addEventListener('pagehide', rememberPosition);

  $('#dmToggle').onclick = toggleDm;
}

/* Danmaku on/off, keeping the topbar and fullscreen-cluster buttons in sync.
   Off state draws a CSS slash over the icon (see .dm-btn). */
function toggleDm() {
  if (!dm) return;
  dm.enabled = !dm.enabled;
  for (const btn of [$('#dmToggle'), $('#fsDm')]) {
    btn.classList.toggle('active', dm.enabled);
    btn.setAttribute('aria-pressed', String(dm.enabled));
  }
  if (!dm.enabled) dm.clear();
}
