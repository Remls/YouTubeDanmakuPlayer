/* Boot: wire the chrome, honor a ?v= deep link, register the service worker. */

import { STATE } from './core/state.js';
import { $, currentRoute, homeUrl, routeUrl } from './core/util.js';
import { parseVideoId } from './core/yt.js';
import { wireCopyMenu } from './ui/copy.js';
import { loadVideo, showLanding, wireLanding } from './ui/landing.js';
import { showSearch } from './ui/search.js';
import { closeSettings, openSettings } from './ui/settings.js';

wireLanding();

$('#btnHome').onclick = () => { history.pushState({}, '', homeUrl()); showLanding(); };
$('#btnSettings').onclick = openSettings;
$('#settingsClose').onclick = closeSettings;
$('#settingsView').onclick = (e) => { if (e.target.id === 'settingsView') closeSettings(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

window.addEventListener('popstate', () => {
  const r = currentRoute();
  if (r?.page === 'watch' && r.id === STATE.videoId) return;   /* already on this video */
  route();
});

function route() {
  const r = currentRoute();
  if (r?.page === 'watch' && STATE.apiKey) loadVideo(r.id, { startAt: r.t || null });
  else if (r?.page === 'search' && STATE.apiKey) showSearch(r.q);
  else showLanding();
}

/* PWA share target (installed Android): the share sheet opens the app with
   ?url= / ?text= / ?title=. Find a YouTube link in them, rewrite the URL to
   the ?v= route, and fall through to the normal router. */
(function handleShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has('url') && !p.has('text') && !p.has('title')) return;
  for (const key of ['url', 'text', 'title']) {
    const raw = p.get(key) || '';
    for (const candidate of [raw, ...(raw.match(/https?:\/\/\S+/g) || [])]) {
      const id = parseVideoId(candidate);
      if (id) { history.replaceState({}, '', routeUrl(id, 0)); return; }
    }
  }
  history.replaceState({}, '', homeUrl());   /* no video in the share: clean up */
})();
route();

wireCopyMenu($('#btnCopy'), $('#copyMenu'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}
