/* Boot: wire the chrome, honor a #v= deep link, register the service worker. */

import { STATE } from './core/state.js';
import { $, HASH_RE } from './core/util.js';
import { wireCopyMenu } from './ui/copy.js';
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

wireCopyMenu($('#btnCopy'), $('#copyMenu'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}
