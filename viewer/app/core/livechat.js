/* Live chat reader. Prefers liveChatMessages.streamList: one long-lived
   request that pushes messages as they arrive, costing a connection instead
   of ~5 quota units per poll. If streaming is refused outright, falls back
   to liveChatMessages.list polling at the interval the server dictates.
   Everything stops when the signal aborts or the broadcast ends. */

import { STATE } from './state.js';
import { api } from './yt.js';

const API = 'https://www.googleapis.com/youtube/v3';

/* liveChatMessages item -> the app's comment shape (no video timestamp:
   live messages exist only "now"). */
function mapMessage(item) {
  return {
    id: item.id,
    parentId: null,
    author: item.authorDetails?.displayName || '',
    avatar: item.authorDetails?.profileImageUrl || '',
    text: item.snippet?.displayMessage || '',
    published: item.snippet?.publishedAt,
    likes: 0,
    isReply: false,
    stamps: [],
    ts: null,
  };
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/* Splits a stream of concatenated JSON documents, calling onDoc per document.
   Tracks brace depth outside strings; anything else between documents
   (whitespace, commas) is ignored. */
function jsonChunker(onDoc) {
  let buf = '', pos = 0, depth = 0, inStr = false, esc = false, start = -1;
  return (text) => {
    buf += text;
    while (pos < buf.length) {
      const c = buf[pos];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"' && depth) {
        inStr = true;
      } else if (c === '{') {
        if (!depth) start = pos;
        depth++;
      } else if (c === '}' && depth) {
        depth--;
        if (!depth && start >= 0) {
          try { onDoc(JSON.parse(buf.slice(start, pos + 1))); } catch { /* malformed: skip */ }
          buf = buf.slice(pos + 1);
          pos = 0;
          start = -1;
          continue;
        }
      }
      pos++;
    }
    if (!depth && start < 0) { buf = ''; pos = 0; }
  };
}

/* One streaming connection. Resolves with { offline } when the server
   closes; throws on an HTTP rejection. */
async function streamChat(liveChatId, onMessages, signal) {
  const qs = new URLSearchParams({
    liveChatId, part: 'id,snippet,authorDetails', key: STATE.apiKey,
  });
  const res = await fetch(`${API}/liveChat/messages/stream?${qs}`, { signal });
  if (!res.ok) throw new Error(`stream rejected (${res.status})`);
  let offline = false;
  const chunk = jsonChunker((doc) => {
    const msgs = (doc.items || []).map(mapMessage);
    if (msgs.length) onMessages(msgs);
    if (doc.offlineAt) offline = true;
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunk(dec.decode(value, { stream: true }));
  }
  return { offline };
}

/* ~5 quota units per request; interval comes from the server (floored so a
   hostile value can't melt the quota). */
async function pollChat(liveChatId, onMessages, signal) {
  let pageToken = '';
  while (!signal.aborted) {
    let body;
    try {
      body = await api('liveChat/messages', {
        liveChatId, part: 'id,snippet,authorDetails', maxResults: '200',
        ...(pageToken ? { pageToken } : {}),
      }, signal);
    } catch {
      return;   /* aborted, quota gone, or the chat closed */
    }
    const msgs = (body.items || []).map(mapMessage);
    if (msgs.length) onMessages(msgs);
    if (body.offlineAt) return;
    pageToken = body.nextPageToken || '';
    await sleep(Math.max(+body.pollingIntervalMillis || 5000, 2000), signal);
  }
}

/* Entry point: stream, reconnecting on clean closes, until the broadcast
   ends or the signal aborts. If the very first connection is refused,
   assume streaming is unavailable for this key and poll instead. */
export async function readLiveChat(liveChatId, { onMessages, signal }) {
  let everStreamed = false;
  while (!signal.aborted) {
    try {
      const { offline } = await streamChat(liveChatId, onMessages, signal);
      everStreamed = true;   /* a 200 connection proves streaming works */
      if (offline) return;
    } catch (err) {
      if (signal.aborted) return;
      if (!everStreamed) break;   /* streaming never worked: try polling */
      return;                     /* it worked before; a rejection now means the chat is over */
    }
    await sleep(1500, signal);    /* server closed the stream mid-broadcast: reconnect */
  }
  if (!signal.aborted) await pollChat(liveChatId, onMessages, signal);
}
