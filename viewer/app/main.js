/* Boot: wire the chrome, honor a ?v= deep link, register the service worker. */

import { STATE } from './core/state.js';
import { $, currentRoute } from './core/util.js';
import { wireCopyMenu } from './ui/copy.js';
import { loadVideo, showLanding, wireLanding } from './ui/landing.js';
import { closeSettings, openSettings } from './ui/settings.js';

wireLanding();

$('#btnHome').onclick = () => { history.pushState({}, '', location.pathname); showLanding(); };
$('#btnSettings').onclick = openSettings;
$('#settingsClose').onclick = closeSettings;
$('#settingsView').onclick = (e) => { if (e.target.id === 'settingsView') closeSettings(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

window.addEventListener('popstate', () => {
  const r = currentRoute();
  if (!r) showLanding();
  else if (r.id !== STATE.videoId) route();
});

function route() {
  const r = currentRoute();
  if (r && STATE.apiKey) loadVideo(r.id, { startAt: r.t || null });
  else showLanding();
}
route();

wireCopyMenu($('#btnCopy'), $('#copyMenu'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}
