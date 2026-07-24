/* Search page: /search?q=<term>. A fresh search costs ~101 quota units
   (search.list 100 + one videos.list), so results are cached for an hour;
   revisits and back navigation within that window cost nothing. */

import { getSearch, putSearch } from '../core/cache.js';
import { STATE } from '../core/state.js';
import { $, el, homeUrl, routeUrl, searchUrl } from '../core/util.js';
import { parseVideoId, searchVideos } from '../core/yt.js';
import { videoCard } from './videocard.js';
import { loadVideo, showLanding, stopCommentsLoad } from './landing.js';
import { unmountPlayer } from '../views/player.js';

const S = { q: '', videos: [], nextPageToken: '', loading: false, error: null };
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  $('#searchHome').onclick = () => { history.pushState({}, '', homeUrl()); showLanding(); };
  $('#searchForm').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('#searchInput').value;
    const id = parseVideoId(raw);
    if (id) {
      /* A pasted link in the search box goes straight to the player. */
      history.pushState({}, '', routeUrl(id, 0));
      loadVideo(id, {});
      return;
    }
    const q = raw.trim();
    if (!q || q === S.q) return;
    history.pushState({}, '', searchUrl(q));
    showSearch(q);
  };
  $('#searchMore').onclick = () => runSearch(true);
}

export async function showSearch(q) {
  wire();
  /* Arriving from the watch page (back button, home): tear the player down. */
  stopCommentsLoad();
  unmountPlayer();
  STATE.videoId = null;
  $('#app').hidden = true;
  $('#landing').hidden = true;
  $('#searchView').hidden = false;
  $('#searchInput').value = q;
  document.title = q + ' - YouTube Danmaku Player';

  S.q = q;
  S.videos = [];
  S.nextPageToken = '';
  S.error = null;
  S.loading = true;
  render();
  const cached = await getSearch(q);
  if (S.q !== q) return;   /* user searched again while the cache read ran */
  if (cached) {
    S.videos = cached.videos;
    S.nextPageToken = cached.nextPageToken;
    S.loading = false;
    render();
  } else {
    S.loading = false;
    runSearch();
  }
}

async function runSearch(more = false) {
  if (S.loading) return;
  const q = S.q;
  S.loading = true;
  S.error = null;
  render();
  try {
    const page = await searchVideos(q, more ? S.nextPageToken : '');
    if (S.q !== q) return;
    S.videos = more ? [...S.videos, ...page.videos] : page.videos;
    S.nextPageToken = page.nextPageToken;
    putSearch(q, { videos: S.videos, nextPageToken: S.nextPageToken });
  } catch (err) {
    if (S.q !== q) return;
    S.error = err.message;
  } finally {
    if (S.q === q) {
      S.loading = false;
      render();
    }
  }
}

function render() {
  const st = $('#searchStatus');
  st.textContent = S.error || '';
  st.hidden = !S.error;

  const box = $('#searchResults');
  box.innerHTML = '';
  for (const v of S.videos) {
    box.append(videoCard(v, {
      href: routeUrl(v.id, 0),
      onclick: (e) => {
        e.preventDefault();
        history.pushState({}, '', routeUrl(v.id, 0));
        loadVideo(v.id, {});
      },
    }));
  }
  if (S.loading) {
    box.append(el('div', { class: 'empty-state' }, [el('div', { class: 'spinner' }), el('span', { text: 'Searching…' })]));
  } else if (!S.videos.length && !S.error) {
    box.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-magnifying-glass' }), el('span', { text: 'No results' })]));
  }
  $('#searchMore').hidden = !S.nextPageToken || S.loading;
}
