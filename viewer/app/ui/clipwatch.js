/* Clipboard watcher: reads the clipboard when the app gains focus (and on a
   slow poll while focused), looking for a YouTube link to suggest. Reads fail
   silently without focus or permission. Chromium only: gated on a queryable
   clipboard-read permission, so Safari's per-read paste prompt never fires. */

import { STATE, saveSettings } from '../core/state.js';
import { $, el, routeUrl } from '../core/util.js';
import { parseStartTime, parseVideoId } from '../core/yt.js';
import { loadVideo } from './landing.js';

/* 'done' after a real decision (enabled anywhere, or toggled off in settings);
   otherwise the ms timestamp of the last "Not now", re-asked after REASK_MS. */
const PROMPT_KEY = 'dm.clipPrompt';
const REASK_MS = 30 * 24 * 3600 * 1000;

export const markClipDecided = () => localStorage.setItem(PROMPT_KEY, 'done');
export const resetClipPrompt = () => localStorage.removeItem(PROMPT_KEY);

function shouldAsk() {
  if (STATE.settings.clipWatch) return false;
  const v = localStorage.getItem(PROMPT_KEY);
  if (v === 'done') return false;
  return !v || Date.now() - +v > REASK_MS;
}

export let clipSupported = false;

let lastSeen = null;
let lastFill = null;
let toast = null;
let hideTimer = null;

/* Links only, never bare 11-char strings (parseVideoId accepts those, but any
   copied word of that length would false-positive). */
const URLISH = /https?:\/\/\S+|\b(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S+/gi;

function findLink(text) {
  for (const url of text.match(URLISH) || []) {
    const id = parseVideoId(url);
    if (id) return { id, t: parseStartTime(url) || 0, url };
  }
  return null;
}

export async function checkClipboard() {
  if (!clipSupported || !STATE.settings.clipWatch || !document.hasFocus()) return;
  let text;
  try { text = await navigator.clipboard.readText(); } catch { return; }
  if (!text || text === lastSeen) return;
  lastSeen = text;
  const hit = findLink(text);
  if (!hit || hit.id === STATE.videoId) return;
  suggest(hit);
}

function suggest(hit) {
  if (!$('#landing').hidden) {
    const input = $('#urlInput');
    if ($('#urlSection').hidden || (input.value && input.value !== lastFill)) return;
    if (STATE.settings.clipAutoOpen && STATE.apiKey) return open(hit);
    input.value = lastFill = hit.url;
    input.dispatchEvent(new Event('input'));
    return;
  }
  if ($('#app').hidden) return;   /* search view: nowhere sensible to show it */
  if (STATE.settings.clipAutoOpen) return open(hit);
  showToast(hit);
}

function open(hit) {
  hideToast();
  history.pushState({}, '', routeUrl(hit.id, hit.t));
  loadVideo(hit.id, { startAt: hit.t || null, autoplay: true });
}

/* Lives inside #stage so it still renders while #stage is fullscreen. */
function showToast(hit) {
  if (!toast) {
    toast = el('div', { class: 'clip-toast', hidden: '' });
    $('#stage').append(toast);
  }
  toast.innerHTML = '';
  toast.append(
    el('button', { class: 'clip-play', onclick: () => open(hit) }, [
      el('i', { class: 'ph ph-play' }), 'Play copied video',
    ]),
    el('button', { class: 'clip-dismiss', 'aria-label': 'Dismiss', onclick: hideToast }, [
      el('i', { class: 'ph ph-x' }),
    ]),
  );
  toast.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideToast, 12000);
}

function hideToast() {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (toast) toast.hidden = true;
}

/* Enable ends the prompting for good, "Not now" snoozes it. Enabling here
   (and the first read it triggers) is a user gesture, so the browser's own
   clipboard permission prompt can follow immediately. */
function askToEnable() {
  const bar = el('div', { class: 'clip-ask' }, [
    el('span', { text: 'Watch the clipboard for YouTube links? Change later in App settings.' }),
    el('button', { class: 'btn', text: 'Enable', onclick: () => {
      markClipDecided();
      bar.remove();
      STATE.settings.clipWatch = true;
      saveSettings();
      checkClipboard();
    } }),
    el('button', { class: 'btn secondary', text: 'Not now', onclick: () => {
      localStorage.setItem(PROMPT_KEY, String(Date.now()));
      bar.remove();
    } }),
  ]);
  document.body.append(bar);
}

export async function initClipWatch() {
  if (!navigator.clipboard?.readText) return;
  try { await navigator.permissions.query({ name: 'clipboard-read' }); } catch { return; }
  clipSupported = true;
  window.addEventListener('focus', checkClipboard);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkClipboard(); });
  setInterval(checkClipboard, 1000);
  if (shouldAsk()) askToEnable();
  else checkClipboard();
}
