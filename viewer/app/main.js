/* Boot: wire the chrome, honor a #v= deep link, register the service worker. */

import { STATE } from './core/state.js';
import { $, HASH_RE, youtubeUrl } from './core/util.js';
import { loadVideo, showLanding, wireLanding } from './ui/landing.js';
import { closeSettings, openSettings } from './ui/settings.js';

wireLanding();

$('#btnHome').onclick = () => { location.hash = ''; showLanding(); };
$('#btnSettings').onclick = openSettings;
$('#settingsClose').onclick = closeSettings;
$('#settingsView').onclick = (e) => { if (e.target.id === 'settingsView') closeSettings(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

window.addEventListener('hashchange', () => {
  const m = location.hash.match(HASH_RE);
  if (!m) showLanding();
  else if (m[1] !== STATE.videoId) route();
});

function route() {
  const m = location.hash.match(HASH_RE);
  if (m && STATE.apiKey) loadVideo(m[1], { startAt: m[2] ? +m[2] : null });
  else showLanding();
}
route();

/* Copy link menu: the app's own URL for the current video, with or without
   the current playback position. */
const copyMenu = $('#copyMenu');
$('#btnCopy').onclick = () => { copyMenu.hidden = !copyMenu.hidden; };
document.addEventListener('click', (e) => {
  if (!copyMenu.hidden && !e.target.closest('.copy-wrap')) copyMenu.hidden = true;
});

async function copyLink(url) {
  if (!STATE.videoId) return;
  try {
    await navigator.clipboard.writeText(url);
    const icon = $('#btnCopy i');
    icon.className = 'ph ph-check';
    setTimeout(() => { icon.className = 'ph ph-link'; }, 1200);
  } catch { /* clipboard unavailable (insecure context) */ }
  copyMenu.hidden = true;
}
const appUrl = (t) => location.origin + location.pathname + '#v=' + STATE.videoId + (t ? '&t=' + Math.floor(t) : '');
const curTime = () => STATE.player?.getCurrentTime?.() || 0;
$('#copyAtTime').onclick = () => copyLink(appUrl(curTime()));
$('#copyPlain').onclick = () => copyLink(appUrl(0));
$('#copyYtAtTime').onclick = () => copyLink(youtubeUrl(STATE.videoId, curTime()));
$('#copyYt').onclick = () => copyLink(youtubeUrl(STATE.videoId, 0));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}
