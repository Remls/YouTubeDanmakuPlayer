/* Small DOM + formatting helpers. */

export const $ = (sel, root = document) => root.querySelector(sel);

/* App deep link: #v=<videoId>, optionally &t=<seconds>. */
export const HASH_RE = /^#v=([A-Za-z0-9_-]{11})(?:&t=(\d+))?$/;

export const youtubeUrl = (id, t) => 'https://youtu.be/' + id + (t ? '?t=' + Math.floor(t) : '');

export function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
}

export const fmtInt = (n) => (n == null ? '0' : Number(n).toLocaleString('en-US'));

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Seconds -> "m:ss" or "h:mm:ss". */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/* ISO date -> "3 years ago" style relative label. */
export function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const s = Math.max(1, (Date.now() - t) / 1000);
  const steps = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [span, name] of steps) {
    if (s >= span) { const n = Math.floor(s / span); return `${n} ${name}${n > 1 ? 's' : ''} ago`; }
  }
  return 'just now';
}

/* Timestamps inside comment text: "m:ss" or "h:mm:ss".
   Lookbehind/ahead keep it from matching inside longer digit runs. */
export const TS_RE = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g;

/* All valid timestamps (seconds) in a string, bounded by video duration. */
export function extractStamps(text, duration) {
  const out = [];
  for (const m of (text || '').matchAll(TS_RE)) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10), ss = parseInt(m[3], 10);
    if (mm > 59 || ss > 59) continue;
    const t = h * 3600 + mm * 60 + ss;
    if (duration && t > duration) continue;
    out.push({ index: m.index, length: m[0].length, t });
  }
  return out;
}

/* Binary search: index of first element in arr (asc by .ts) with ts > t. */
export function upperBound(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
