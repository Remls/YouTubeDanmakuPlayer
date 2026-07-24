/* Landing: API key entry (first run) + YouTube link entry, then the load flow. */

import { dropCached, getCached, putCached } from '../core/cache.js';
import { rebuildDanmaku, STATE, setApiKey } from '../core/state.js';
import { $, currentRoute, fmtInt, fmtTime, routeUrl, youtubeUrl } from '../core/util.js';
import { fetchComments, getVideo, parseVideoId } from '../core/yt.js';
import { buildBrowser, buildPanel, refreshBrowser, refreshPanel } from '../views/list.js';
import { applyMode, mountPlayer, resyncDanmaku, unmountPlayer, wireStage } from '../views/player.js';

let stageWired = false;

/* Above this many comments, ask before fetching: ~200 sequential requests
   (about a minute) and ~1% of daily quota per 10k comments. */
const BIG_COMMENTS = 20000;

function confirmBigLoad(count) {
  return new Promise((resolve) => {
    const box = $('#bigWarn');
    $('#bigWarnText').textContent =
      `This video has ${fmtInt(count)} comments. Fetching them all uses ` +
      `about ${fmtInt(Math.ceil(count / 100))} of your 10,000 daily API ` +
      `quota units. They load in the background while you watch. Load them?`;
    box.hidden = false;
    $('#watchBtn').disabled = true;
    const done = (ok) => { box.hidden = true; $('#watchBtn').disabled = false; resolve(ok); };
    $('#bigWarnGo').onclick = () => done(true);
    $('#bigWarnCancel').onclick = () => done(false);
  });
}

export function showLanding() {
  cancelFetch();
  unmountPlayer();
  $('#app').hidden = true;
  $('#landing').hidden = false;
  $('#keySection').hidden = !!STATE.apiKey;
  $('#keySaved').hidden = !STATE.apiKey;
  setLandingError('');
  setLandingLoading('');

  /* Deep link but no API key: swap the link input for a preview of the shared
     video (fetched keylessly) and offer the plain YouTube route. */
  const r = currentRoute();
  const deep = r && !STATE.apiKey ? r : null;
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
  $('#dpThumb').src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  $('#dpTitle').textContent = 'YouTube video';
  const timeEl = $('#dpTime');
  timeEl.hidden = !t;
  if (t) timeEl.textContent = 'Starts at ' + fmtTime(t);
  try {
    const res = await fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json');
    if (!res.ok) return;
    const meta = await res.json();
    if (previewId === id && meta.title) $('#dpTitle').textContent = meta.title;
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
  } else {
    id = parseVideoId($('#urlInput').value);
    if (id) history.pushState({}, '', routeUrl(id, 0));
  }
  if (!id) return setLandingError('That is not a YouTube link or video ID.');
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

  if (!cached && video.commentCount > BIG_COMMENTS) {
    setLandingLoading('');
    if (!(await confirmBigLoad(video.commentCount))) return;
  }

  cancelFetch();
  const gen = loadGen;
  STATE.videoId = id;
  STATE.video = video;
  STATE.comments = cached ? cached.comments : [];
  STATE.danmaku = [];
  STATE.commentsError = null;
  STATE.commentsLoading = !cached;
  rebuildDanmaku();

  setLandingLoading('');
  $('#landing').hidden = true;
  $('#app').hidden = false;
  $('#videoTitle').textContent = video.title;
  document.title = video.title + ' - YouTube Danmaku Player';

  if (!stageWired) { wireStage(); stageWired = true; }
  applyMode('default');
  buildBrowser();
  buildPanel();
  if (!cached) fetchInBackground(id, video, gen);
  await mountPlayer(id, startAt);
}

/* ---------------- background comment fetch ---------------- */

let loadGen = 0;        // bumps on every load/cancel; stale fetches see it and stop
let fetchCtrl = null;   // AbortController of the in-flight fetch
let liveTimer = null;   // pending live-repaint throttle

function cancelFetch() {
  loadGen++;
  clearTimeout(liveTimer);
  liveTimer = null;
  fetchCtrl?.abort();
  fetchCtrl = null;
  STATE.commentsLoading = false;
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
