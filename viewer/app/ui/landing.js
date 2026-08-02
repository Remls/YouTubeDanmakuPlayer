/* Landing: API key entry (first run) + YouTube link entry, then the load flow. */

import { dropCached, getCached, putCached } from '../core/cache.js';
import { readLiveChat } from '../core/livechat.js';
import { rebuildDanmaku, STATE, setApiKey } from '../core/state.js';
import { $, currentRoute, fmtTime, routeUrl, searchUrl, youtubeUrl } from '../core/util.js';
import { fetchComments, getVideo, parseVideoId } from '../core/yt.js';
import { buildBrowser, buildPanel, refreshBrowser, refreshPanel } from '../views/list.js';
import { showSearch } from './search.js';
import { videoCard } from './videocard.js';
import { applyMode, mountPlayer, resyncDanmaku, spawnLive, unmountPlayer, wireStage } from '../views/player.js';

let stageWired = false;

/* Above this many comments, the fetch waits for an opt-in from the comment
   list (~200 sequential requests, about a minute, ~1% of daily quota per
   10k comments). The video itself plays right away. */
const BIG_COMMENTS = 20000;

export function showLanding() {
  cancelFetch();
  unmountPlayer();
  $('#app').hidden = true;
  $('#searchView').hidden = true;
  $('#landing').hidden = false;
  $('#keySection').hidden = !!STATE.apiKey;
  $('#keySaved').hidden = !STATE.apiKey;
  setLandingError('');
  setLandingLoading('');
  document.title = 'YouTube Danmaku Player';

  /* Deep link but no API key: swap the link input for a preview of the shared
     video (fetched keylessly) and offer the plain YouTube route. */
  const r = currentRoute();
  const deep = r?.page === 'watch' && !STATE.apiKey ? r : null;
  $('#deepPreview').hidden = !deep;
  $('#urlSection').hidden = !!deep;
  if (deep) {
    showYtDirect(deep.id, deep.t);
    fillPreview(deep.id, deep.t);
    $('#keyInput').focus();
  } else {
    $('#ytDirect').hidden = true;
    $('#urlInput').focus();
  }
}

function showYtDirect(id, t) {
  $('#ytLink').href = youtubeUrl(id, t);
  $('#ytDirect').hidden = false;
}

/* Title via YouTube's keyless oEmbed endpoint, thumbnail straight from
   i.ytimg.com. Both are best-effort decoration. */
let previewId = null;
async function fillPreview(id, t) {
  previewId = id;
  const box = $('#deepPreview');
  const note = t ? 'Starts at ' + fmtTime(t) : null;
  const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const render = (v) => { box.innerHTML = ''; box.append(videoCard(v, { note })); };
  render({ thumb });
  try {
    const res = await fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json');
    if (!res.ok) return;
    const meta = await res.json();
    if (previewId === id && meta.title) render({ thumb, title: meta.title, channel: meta.author_name });
  } catch { /* offline or blocked: thumbnail alone is fine */ }
}

export function setLandingError(msg) {
  const e = $('#landingError');
  e.textContent = msg;
  e.hidden = !msg;
}

function setLandingLoading(msg) {
  const bar = $('#loadingBar');
  bar.hidden = !msg;
  $('#loadingText').textContent = msg;
  $('#watchBtn').disabled = !!msg;
}

export function wireLanding() {
  $('#watchForm').onsubmit = (e) => { e.preventDefault(); startLoad(); };
  /* The input takes links and search terms; the button says which it got. */
  $('#urlInput').oninput = (e) => {
    const search = e.target.value.trim() && !parseVideoId(e.target.value);
    $('#watchBtnIcon').className = 'ph ' + (search ? 'ph-magnifying-glass' : 'ph-play');
    $('#watchBtnLabel').textContent = search ? 'Search' : 'Watch';
  };
  $('#keyChange').onclick = (e) => {
    e.preventDefault();
    $('#keySection').hidden = false;
    $('#keySaved').hidden = true;
    $('#keyInput').focus();
  };
}

async function startLoad() {
  setLandingError('');
  const keyField = $('#keyInput');
  if (!$('#keySection').hidden) {
    const k = keyField.value.trim();
    if (!k) return setLandingError('Paste your API key.');
    setApiKey(k);
  }
  let id, startAt = null;
  if ($('#urlSection').hidden) {
    /* Deep-link landing: the video came from the URL, not the input. */
    const r = currentRoute();
    id = r?.id;
    startAt = r?.t || null;
    if (!id) return;
  } else {
    const raw = $('#urlInput').value;
    id = parseVideoId(raw);
    if (!id) {
      /* Not a link: treat it as a search. */
      const q = raw.trim();
      if (!q) return setLandingError('Paste a link, or type a search.');
      history.pushState({}, '', searchUrl(q));
      return showSearch(q);
    }
    history.pushState({}, '', routeUrl(id, 0));
  }
  await loadVideo(id, { startAt });
}

export async function loadVideo(id, { refresh = false, startAt = null } = {}) {
  setLandingError('');
  $('#ytDirect').hidden = true;

  let cached = null;
  if (!refresh) {
    cached = await getCached(id);
    /* A cache written without full replies can't serve a session that wants them. */
    if (cached && STATE.settings.allReplies && !cached.allReplies) cached = null;
  }

  let video;
  if (cached) {
    video = cached.video;
  } else {
    setLandingLoading('Checking video\u2026');
    try {
      video = await getVideo(id);
    } catch (err) {
      setLandingLoading('');
      if (err.code === 'key') {
        $('#keySection').hidden = false;
        $('#keySaved').hidden = true;
        showYtDirect(id, startAt || 0);   /* broken key shouldn't strand the viewer */
      }
      return setLandingError(err.message);
    }
  }

  /* Active live stream with a chat: danmaku comes from the chat, not the
     comment archive, so there is nothing to bulk-fetch or cache. */
  const liveChat = !cached && video.live && video.liveChatId ? video.liveChatId : null;

  const bigLoad = !cached && !liveChat && video.commentCount > BIG_COMMENTS;

  cancelFetch();
  const gen = loadGen;
  STATE.videoId = id;
  STATE.video = video;
  STATE.comments = cached ? cached.comments : [];
  STATE.danmaku = [];
  STATE.commentsError = null;
  STATE.commentsPending = bigLoad;
  STATE.commentsLoading = !cached && !liveChat && !bigLoad;
  rebuildDanmaku();

  setLandingLoading('');
  $('#landing').hidden = true;
  $('#searchView').hidden = true;
  $('#app').hidden = false;
  $('#videoTitle').textContent = video.title;
  document.title = video.title + ' - YouTube Danmaku Player';

  if (!stageWired) { wireStage(); stageWired = true; }
  applyMode('default');
  buildBrowser();
  buildPanel();
  if (liveChat) readChatInBackground(liveChat, gen);
  else if (!cached && !bigLoad) fetchInBackground(id, video, gen);
  await mountPlayer(id, startAt);
}

/* "Load comments" in the big-video warning: start the fetch loadVideo held back. */
export function startPendingLoad() {
  if (!STATE.commentsPending || !STATE.videoId) return;
  cancelFetch();
  STATE.commentsPending = false;
  STATE.commentsLoading = true;
  fetchInBackground(STATE.videoId, STATE.video, loadGen);
  buildBrowser();
  buildPanel();
}

/* ---------------- background comment fetch ---------------- */

let loadGen = 0;        // bumps on every load/cancel; stale fetches see it and stop
let fetchCtrl = null;   // AbortController of the in-flight fetch
let liveTimer = null;   // pending live-repaint throttle

/* Also called from the search page when it tears the watch page down. */
export function cancelFetch() {
  loadGen++;
  clearTimeout(liveTimer);
  liveTimer = null;
  fetchCtrl?.abort();
  fetchCtrl = null;
  STATE.commentsLoading = false;
}

/* Live chat -> comment list + overlay. Messages append as regular comments
   (no timestamp), the lists repaint at most once a second, and the overlay
   fires immediately. Nothing is cached; chat exists only while it happens. */
const MAX_LIVE = 3000;   // keep the list bounded on long streams

async function readChatInBackground(liveChatId, gen) {
  const live = () => gen === loadGen;
  fetchCtrl = new AbortController();
  const seen = new Set();
  let dirty = false;
  const flush = () => {
    if (!dirty || !live()) return;
    dirty = false;
    refreshBrowser();
    refreshPanel();
  };
  const flushTimer = setInterval(flush, 1000);
  try {
    await readLiveChat(liveChatId, {
      signal: fetchCtrl.signal,
      onMessages: (msgs) => {
        if (!live()) return;
        for (const m of msgs) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          STATE.comments.push(m);
          spawnLive(m);
        }
        if (STATE.comments.length > MAX_LIVE) STATE.comments.splice(0, STATE.comments.length - MAX_LIVE);
        dirty = true;
      },
    });
  } finally {
    clearInterval(flushTimer);
    flush();
  }
}

/* Stop button in the toolbars: keep what has loaded, stop fetching more.
   Reload starts over from scratch. */
export function stopCommentsLoad() {
  if (!STATE.commentsLoading) return;
  cancelFetch();
  rebuildDanmaku();
  resyncDanmaku();
  refreshBrowser();
  refreshPanel();
}

/* Comments stream in while the video already plays: pages land in STATE as
   they arrive, the lists repaint at most once a second, and only a complete
   set is cached. */
async function fetchInBackground(id, video, gen) {
  const live = () => gen === loadGen && STATE.videoId === id;
  const repaint = () => {
    rebuildDanmaku();
    resyncDanmaku();
    refreshBrowser();
    refreshPanel();
  };
  fetchCtrl = new AbortController();
  try {
    const comments = await fetchComments(id, video.duration, {
      allReplies: STATE.settings.allReplies,
      signal: fetchCtrl.signal,
      onProgress: (n, sofar) => {
        if (!live()) return;
        STATE.comments = sofar;
        if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = null; if (live()) repaint(); }, 1000);
      },
    });
    if (!live()) return;
    STATE.comments = comments;
    putCached(id, { video, comments, allReplies: STATE.settings.allReplies, savedAt: Date.now() });
  } catch (err) {
    if (!live() || err.code === 'aborted') return;
    /* Partial results stay usable; only a fetch that got nothing shows an error. */
    if (!STATE.comments.length) {
      STATE.commentsError = err.code === 'disabled' || err.code === 'quota' ? err.code : 'error';
    }
  } finally {
    if (live()) {
      STATE.commentsLoading = false;
      clearTimeout(liveTimer);
      liveTimer = null;
      if (STATE.commentsError) { buildBrowser(); buildPanel(); }
      else repaint();
    }
  }
}

/* Drop the cache for the current video and fetch everything fresh.
   Callers confirm with the user first. */
export async function reloadComments() {
  const id = STATE.videoId;
  if (!id) return;
  if (document.fullscreenElement) document.exitFullscreen();
  await dropCached(id);
  showLanding();
  await loadVideo(id, { refresh: true });
}
