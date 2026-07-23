/* Landing: API key entry (first run) + YouTube link entry, then the load flow. */

import { dropCached, getCached, putCached } from '../core/cache.js';
import { STATE, setApiKey } from '../core/state.js';
import { $, fmtInt, fmtTime, HASH_RE, youtubeUrl } from '../core/util.js';
import { fetchComments, getVideo, parseVideoId } from '../core/yt.js';
import { buildBrowser, buildPanel } from '../views/list.js';
import { applyMode, mountPlayer, unmountPlayer, wireStage } from '../views/player.js';

let stageWired = false;

export function showLanding() {
  unmountPlayer();
  $('#app').hidden = true;
  $('#landing').hidden = false;
  $('#keySection').hidden = !!STATE.apiKey;
  $('#keySaved').hidden = !STATE.apiKey;
  setLandingError('');
  setLandingLoading('');

  /* Deep link but no API key: swap the link input for a preview of the shared
     video (fetched keylessly) and offer the plain YouTube route. */
  const m = location.hash.match(HASH_RE);
  const deep = m && !STATE.apiKey ? { id: m[1], t: m[2] ? +m[2] : 0 } : null;
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
    const m = location.hash.match(HASH_RE);
    id = m?.[1];
    startAt = m?.[2] ? +m[2] : null;
  } else {
    id = parseVideoId($('#urlInput').value);
    if (id) location.hash = 'v=' + id;
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

  STATE.videoId = id;
  STATE.video = video;
  STATE.comments = cached ? cached.comments : [];
  STATE.danmaku = [];
  STATE.commentsError = null;

  if (!cached) {
    try {
      STATE.comments = await fetchComments(id, video.duration, {
        allReplies: STATE.settings.allReplies,
        onProgress: (n) => setLandingLoading(`Loading comments\u2026 ${fmtInt(n)}${video.commentCount ? ' of ~' + fmtInt(video.commentCount) : ''}`),
      });
      putCached(id, {
        video,
        comments: STATE.comments,
        allReplies: STATE.settings.allReplies,
        savedAt: Date.now(),
      });
    } catch (err) {
      if (err.code === 'disabled') STATE.commentsError = 'disabled';
      else if (err.code === 'quota') STATE.commentsError = 'quota';
      else { setLandingLoading(''); return setLandingError(err.message); }
    }
  }
  STATE.danmaku = STATE.comments.filter((c) => c.ts != null).sort((a, b) => a.ts - b.ts);

  setLandingLoading('Starting player\u2026');
  $('#landing').hidden = true;
  $('#app').hidden = false;
  $('#videoTitle').textContent = video.title;
  document.title = video.title + ' - YouTube Danmaku Player';

  if (!stageWired) { wireStage(); stageWired = true; }
  applyMode(STATE.mode);
  buildBrowser();
  buildPanel();
  await mountPlayer(id, startAt);
  setLandingLoading('');
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
