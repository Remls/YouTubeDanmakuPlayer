/* YouTube: link parsing, Data API v3 calls, IFrame player loader.
   The API key comes from the user and only ever goes to googleapis.com. */

import { STATE } from './state.js';
import { extractStamps } from './util.js';

const API = 'https://www.googleapis.com/youtube/v3';

/* Accepts watch/short/embed/live URLs or a bare 11-char ID. Returns the ID or null. */
export function parseVideoId(input) {
  const s = (input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let url;
  try { url = new URL(s.includes('://') ? s : 'https://' + s); } catch { return null; }
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(url.hostname)) return null;
  const v = url.searchParams.get('v');
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  const m = url.pathname.match(/^\/(?:shorts\/|embed\/|live\/|v\/)?([A-Za-z0-9_-]{11})(?:$|\/)/);
  return m ? m[1] : null;
}

/* Start time from a YouTube URL: ?t= / ?start= / #t=, as plain seconds
   ("t=90") or units ("t=1h2m3s"). Returns seconds, 0 if absent. */
export function parseStartTime(input) {
  const s = (input || '').trim();
  let url;
  try { url = new URL(s.includes('://') ? s : 'https://' + s); } catch { return 0; }
  const raw = url.searchParams.get('t') || url.searchParams.get('start')
    || new URLSearchParams(url.hash.slice(1)).get('t') || '';
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

/* Fetch wrapper that turns Google's error envelope into a typed error.
   Also used by livechat.js. */
export async function api(endpoint, params, signal) {
  const qs = new URLSearchParams({ ...params, key: STATE.apiKey });
  let res, body;
  try {
    res = await fetch(`${API}/${endpoint}?${qs}`, { signal });
    body = await res.json();
  } catch {
    if (signal?.aborted) throw makeError('aborted', 'Cancelled.');
    throw makeError('network', 'Network error. Check your connection.');
  }
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || '';
    if (/keyInvalid|badRequest/.test(reason) && res.status === 400) throw makeError('key', 'API key rejected. Check the key.');
    if (reason === 'commentsDisabled') throw makeError('disabled', 'Comments are turned off for this video.');
    if (/quotaExceeded|rateLimitExceeded/.test(reason)) throw makeError('quota', 'API quota used up. Resets at midnight Pacific.');
    if (res.status === 403) throw makeError('key', 'Request blocked. Check the key and its restrictions.');
    throw makeError('api', body?.error?.message || `API error (${res.status}).`);
  }
  return body;
}

function makeError(code, message) { const e = new Error(message); e.code = code; return e; }

function parseDuration(iso) {
  const m = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

/* Validates the key and the video in one call. */
export async function getVideo(id) {
  const body = await api('videos', { part: 'snippet,contentDetails,statistics,liveStreamingDetails', id });
  const item = body.items?.[0];
  if (!item) throw makeError('video', 'Video not found. Check the link.');
  return mapVideo(item);
}

/* videos.list item -> the app's video shape (also used by search results). */
function mapVideo(item) {
  const sn = item.snippet || {};
  const th = sn.thumbnails || {};
  return {
    id: item.id,
    title: sn.title,
    channel: sn.channelTitle,
    published: sn.publishedAt,
    thumb: (th.medium || th.high || th.default)?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    duration: parseDuration(item.contentDetails?.duration),
    commentCount: +(item.statistics?.commentCount || 0),
    viewCount: +(item.statistics?.viewCount || 0),
    likeCount: +(item.statistics?.likeCount || 0),
    live: sn.liveBroadcastContent === 'live',
    liveChatId: item.liveStreamingDetails?.activeLiveChatId || null,
  };
}

function mapComment(id, sn, isReply, duration, parentId = null) {
  const text = sn.textOriginal || '';
  const stamps = extractStamps(text, duration);
  return {
    id,
    parentId: isReply ? (sn.parentId || parentId) : null,
    author: sn.authorDisplayName || '',
    avatar: sn.authorProfileImageUrl || '',
    text,
    published: sn.publishedAt,
    likes: +(sn.likeCount || 0),
    isReply,
    stamps,
    ts: stamps.length ? stamps[0].t : null,
  };
}

/* Video search: search.list costs 100 quota units, plus one 1-unit
   videos.list to fill in durations and stats. -> { videos, nextPageToken } */
export async function searchVideos(q, pageToken = '') {
  const body = await api('search', {
    part: 'snippet', q, type: 'video', maxResults: '25',
    ...(pageToken ? { pageToken } : {}),
  });
  const ids = (body.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { videos: [], nextPageToken: '' };
  const details = await api('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(',') });
  const byId = new Map((details.items || []).map((i) => [i.id, mapVideo(i)]));
  return {
    videos: ids.map((id) => byId.get(id)).filter(Boolean),
    nextPageToken: body.nextPageToken || '',
  };
}

/* All comments for a video, replies flattened after their parents.
   onProgress(loaded, commentsSoFar) fires per page; commentsSoFar is the
   live accumulating array, so callers can render partial results. */
export async function fetchComments(videoId, duration, { allReplies, onProgress, signal }) {
  const comments = [];
  const partial = [];   // threads whose replies were truncated by the API
  let pageToken = '';
  do {
    const body = await api('commentThreads', {
      part: 'snippet,replies', videoId, maxResults: '100',
      order: 'time', textFormat: 'plainText',
      ...(pageToken ? { pageToken } : {}),
    }, signal);
    for (const item of body.items || []) {
      const top = item.snippet.topLevelComment;
      comments.push(mapComment(top.id, top.snippet, false, duration));
      const inline = item.replies?.comments || [];
      const total = +(item.snippet.totalReplyCount || 0);
      if (allReplies && total > inline.length) {
        partial.push(top.id);
      } else {
        for (const r of inline) comments.push(mapComment(r.id, r.snippet, true, duration, top.id));
      }
    }
    pageToken = body.nextPageToken || '';
    onProgress?.(comments.length, comments);
  } while (pageToken);

  /* Full reply fetch for truncated threads (opt-in, costs extra requests). */
  for (const parentId of partial) {
    let token = '';
    do {
      const body = await api('comments', {
        part: 'snippet', parentId, maxResults: '100', textFormat: 'plainText',
        ...(token ? { pageToken: token } : {}),
      }, signal);
      for (const r of body.items || []) comments.push(mapComment(r.id, r.snippet, true, duration, parentId));
      token = body.nextPageToken || '';
      onProgress?.(comments.length, comments);
    } while (token);
  }
  return comments;
}

/* IFrame API loader (idempotent). */
let iframeReady = null;
export function loadIframeAPI() {
  if (iframeReady) return iframeReady;
  iframeReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return iframeReady;
}
