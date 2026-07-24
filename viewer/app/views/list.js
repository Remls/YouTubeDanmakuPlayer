/* Comment lists: the full browser under the video (default mode) and the
   compact side panel (theater + fullscreen). Both render the same data. */

import { STATE } from '../core/state.js';
import { $, el, fmtCompact, fmtInt, relTime, segmentText } from '../core/util.js';
import { reloadComments, stopCommentsLoad } from '../ui/landing.js';
import { seekTo } from './player.js';

const PAGE = 100;

/* Refetch button: first click arms it ("Fetch again?"), second click reloads.
   Arms back down after 5s so a stray tap can't spend quota. */
function reloadChip() {
  const label = el('span', { text: 'Reload' });
  const btn = el('button', { class: 'chip-toggle reload-chip', title: 'Fetch comments again from YouTube' }, [
    el('i', { class: 'ph ph-arrow-clockwise' }), label,
  ]);
  let timer = null;
  const disarm = () => { timer = null; btn.classList.remove('confirm'); label.textContent = 'Reload'; };
  btn.onclick = () => {
    if (timer == null) {
      btn.classList.add('confirm');
      label.textContent = 'Fetch again?';
      timer = setTimeout(disarm, 5000);
    } else {
      clearTimeout(timer);
      disarm();
      reloadComments();
    }
  };
  return btn;
}

/* ---------------- shared card ---------------- */

/* Comment text with every timestamp turned into a seek chip and every
   @mention highlighted. */
function textWithStamps(c) {
  const wrap = el('div', { class: 'item-text' });
  for (const seg of segmentText(c.text, c.stamps)) {
    if (seg.type === 'ts') wrap.append(el('button', { class: 'ts-chip', text: seg.str, onclick: () => seekTo(seg.t) }));
    else if (seg.type === 'mention') wrap.append(el('span', { class: 'mention', text: seg.str }));
    else wrap.append(document.createTextNode(seg.str));
  }
  return wrap;
}

function card(c, compact) {
  /* Avatar lives in the header row; the text below spans the full card. */
  const meta = el('div', { class: 'item-meta' }, [
    c.avatar ? el('div', { class: 'avatar' }, [el('img', {
      src: c.avatar, alt: '', loading: 'lazy',
      /* Avatar URLs go stale (channel changed its picture); show a person
         glyph instead of the browser's broken-image icon. */
      onerror: (e) => e.target.replaceWith(el('i', { class: 'ph ph-user' })),
    })]) : null,
    el('b', { text: c.author }),
    el('span', { text: relTime(c.published) }),
    c.likes ? el('span', {}, [el('i', { class: 'ph ph-thumbs-up' }), document.createTextNode(' ' + fmtInt(c.likes))]) : null,
    el('a', {
      class: 'perma', title: 'Open on YouTube', target: '_blank', rel: 'noopener noreferrer',
      href: `https://www.youtube.com/watch?v=${STATE.videoId}&lc=${c.id}`,
    }, [el('i', { class: 'ph ph-arrow-square-out' })]),
  ]);
  const item = el('div', { class: 'item comment' + (compact ? ' compact' : '') + (c.isReply ? ' reply' : '') });
  if (c.isReply) {
    item.append(el('span', { class: 'reply-mark', title: 'Reply' }, [el('i', { class: 'ph ph-arrow-bend-down-right' })]));
  }
  item.append(el('div', { class: 'item-main' }, [meta, textWithStamps(c)]));
  if (c.ts != null) item.dataset.ts = c.ts;
  return item;
}

/* ---------------- sorting helpers ---------------- */

const byPosted = (dir) => (a, b) => dir * (new Date(a.published) - new Date(b.published));

/* Comparator for a sort key; 'liked' ties break to newest. */
const cmpFor = (sort) =>
  sort === 'liked'
    ? (a, b) => b.likes - a.likes || byPosted(-1)(a, b)
    : byPosted(sort === 'oldest' ? 1 : -1);

const matches = (c, q) => c.text.toLowerCase().includes(q) || c.author.toLowerCase().includes(q);

/* Threads: parents ordered by cmp, each directly followed by its replies,
   earliest reply first. A query keeps a whole thread if the parent or any
   reply matches. */
function groupThreads(cmp, q) {
  const parents = [];
  const byParent = new Map();
  for (const c of STATE.comments) {
    if (c.isReply && c.parentId) {
      if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
      byParent.get(c.parentId).push(c);
    } else {
      parents.push(c);   /* replies without a known parent fall back to top level */
    }
  }
  for (const rs of byParent.values()) rs.sort(byPosted(1));
  const out = [];
  for (const p of parents.sort(cmp)) {
    const replies = byParent.get(p.id) || [];
    if (q && !matches(p, q) && !replies.some((r) => matches(r, q))) continue;
    out.push(p, ...replies);
  }
  return out;
}

function browserData() {
  const q = B.query.toLowerCase();
  if (B.tsOnly) {
    let list = STATE.comments.filter((c) => c.ts != null && (STATE.settings.includeReplies || !c.isReply));
    if (q) list = list.filter((c) => matches(c, q));
    return [...list].sort(cmpFor(B.sort));
  }
  return groupThreads(cmpFor(B.sort), q);
}

/* Toolbar pieces shared by the browser and the side panel, so both look
   and behave the same. */
function searchInput(state, rerender) {
  return el('input', {
    class: 'tb-search', type: 'search', placeholder: 'Search comments',
    value: state.query || null,
    oninput: (e) => { state.query = e.target.value.trim(); rerender(); },
  });
}

const SORTS = [['newest', 'Newest'], ['oldest', 'Oldest'], ['liked', 'Most liked']];

/* Sort pill that opens a small dropdown (Newest / Oldest / Most liked). */
function sortChip(state, rerender) {
  const label = el('span', { text: SORTS.find(([v]) => v === state.sort)[1] });
  const menu = el('div', { class: 'copy-menu sort-menu', hidden: true }, SORTS.map(([v, name]) =>
    el('button', { text: name, onclick: () => {
      state.sort = v;
      label.textContent = name;
      menu.hidden = true;
      rerender();
    } })));
  const btn = el('button', { class: 'chip-toggle', onclick: () => { menu.hidden = !menu.hidden; } },
    [el('i', { class: 'ph ph-sort-descending' }), label, el('i', { class: 'ph ph-caret-down' })]);
  return el('div', { class: 'sort-wrap' }, [btn, menu]);
}

/* One document-level closer for all sort menus (toolbars get rebuilt per video,
   so per-instance listeners would pile up). */
document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('.sort-menu')) {
    if (!m.hidden && !m.parentElement.contains(e.target)) m.hidden = true;
  }
});

function tsChipToggle(state, rerender) {
  const btn = el('button', { class: 'chip-toggle' + (state.tsOnly ? ' on' : ''), onclick: () => {
    state.tsOnly = !state.tsOnly;
    btn.classList.toggle('on', state.tsOnly);
    rerender();
  } }, [el('i', { class: 'ph ph-clock' }), document.createTextNode(' Timed only')]);
  return btn;
}

/* Count pill: filtered count normally; loaded / ~expected while the
   background fetch is still streaming pages in. Also swaps the Reload
   chips for Stop chips mid-fetch (reloading while loading makes no sense). */
function setCountPill(node, data) {
  if (!node) return;
  const busy = !!STATE.commentsLoading;
  if (busy) {
    const total = STATE.video?.commentCount || 0;
    node.textContent = fmtInt(STATE.comments.length) + (total ? ` of ~${fmtInt(total)}` : '');
  } else {
    node.textContent = fmtInt(data.length);
  }
  node.classList.toggle('busy', busy);
  for (const b of document.querySelectorAll('.stop-chip')) b.hidden = !busy;
  for (const b of document.querySelectorAll('.reload-chip')) b.hidden = busy;
}

/* Cancel the background fetch, keeping what has loaded; the Reload chip
   can start over. */
function stopChip() {
  return el('button', { class: 'chip-toggle stop-chip', title: 'Stop loading comments', hidden: true, onclick: stopCommentsLoad },
    [el('i', { class: 'ph ph-x' }), document.createTextNode(' Stop')]);
}

const loadingState = () =>
  el('div', { class: 'empty-state' }, [el('div', { class: 'spinner' }), el('span', { text: 'Loading comments…' })]);

const errorMsg = (short) =>
  STATE.commentsError === 'disabled' ? (short ? 'Comments are turned off' : 'Comments are turned off for this video')
  : STATE.commentsError === 'quota' ? (short ? 'API quota used up' : 'API quota used up. Resets at midnight Pacific')
  : 'Could not load comments';

/* ---------------- live chat rendering ---------------- */

/* Live streams swap the comment cards for compact chat rows:
   colored @author + text, chronological, pinned to the bottom like any
   chat unless the user scrolls up to read back. */

const CHAT_ROWS = 300;   // rendered rows cap; the data cap lives in landing.js

const isLiveChat = () => !!STATE.video?.live;

/* Stable per-username color: hash -> hue, lightness readable on the dark bg. */
function authorColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% 72%)`;
}

function chatRow(c) {
  const author = el('b', { class: 'chat-author', text: c.author.startsWith('@') ? c.author : '@' + c.author });
  author.style.color = authorColor(c.author);
  return el('div', { class: 'chat-row' }, [author, document.createTextNode(' ' + c.text)]);
}

const nearBottom = (n) => n.scrollTop + n.clientHeight >= n.scrollHeight - 40;

function chatData(S) {
  const q = S.query.toLowerCase();
  return q ? STATE.comments.filter((c) => matches(c, q)) : STATE.comments;
}

/* Full rebuild (new video, search change): the last CHAT_ROWS messages,
   pinned to the bottom. */
function renderChat(list, S, countNode) {
  const data = chatData(S);
  list.classList.add('chat');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of data.slice(-CHAT_ROWS)) frag.append(chatRow(c));
  list.append(frag);
  S.chatLastId = data.length ? data[data.length - 1].id : null;
  S.pinned = true;
  setCountPill(countNode, data);
  if (!data.length) list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-circle' }), el('span', { text: S.query ? 'No messages match' : 'No messages yet' })]));
  list.scrollTop = list.scrollHeight;
}

/* Streaming update: append only the new rows, prune the oldest, and stay
   at the bottom unless the user scrolled up. */
function appendChat(list, S, countNode) {
  if (!list.classList.contains('chat')) return renderChat(list, S, countNode);
  const data = chatData(S);
  let from = -1;
  if (S.chatLastId == null) {
    from = Math.max(0, data.length - CHAT_ROWS);
  } else {
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].id === S.chatLastId) { from = i + 1; break; }
    }
  }
  if (from === -1) return renderChat(list, S, countNode);   /* lost the anchor: rebuild */
  if (from < data.length) {
    if (list.querySelector('.empty-state')) list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = from; i < data.length; i++) frag.append(chatRow(data[i]));
    list.append(frag);
    S.chatLastId = data[data.length - 1].id;
    while (list.children.length > CHAT_ROWS) list.firstChild.remove();
  }
  setCountPill(countNode, data);
  if (S.pinned) list.scrollTop = list.scrollHeight;
}

/* ---------------- full browser (default mode) ---------------- */

const B = { sort: 'newest', tsOnly: false, query: '', shown: 0, data: [], chatLastId: null, pinned: true };

/* Channel, views, likes, age under the player; only fields the video
   object has (older cache entries lack the stats). */
function videoInfoRow() {
  const v = STATE.video || {};
  const kids = [];
  if (v.live) kids.push(el('span', { class: 'live-flag', text: 'LIVE' }));
  if (v.channel) kids.push(el('b', { text: v.channel }));
  if (v.viewCount) kids.push(el('span', {}, [el('i', { class: 'ph ph-eye' }), document.createTextNode(' ' + fmtCompact(v.viewCount) + ' views')]));
  if (v.likeCount) kids.push(el('span', {}, [el('i', { class: 'ph ph-thumbs-up' }), document.createTextNode(' ' + fmtCompact(v.likeCount))]));
  if (v.published) kids.push(el('span', { text: relTime(v.published) }));
  return kids.length ? el('div', { class: 'video-info' }, kids) : null;
}

export function buildBrowser() {
  const root = $('#browser');
  root.innerHTML = '';

  const info = videoInfoRow();
  if (info) root.append(info);

  if (STATE.commentsError) {
    root.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-slash' }), el('span', { text: errorMsg(false) }), reloadChip()]));
    return;
  }

  const count = el('span', { class: 'count-pill', id: 'browserCount' });

  /* Live chat has no timestamps and no like counts: sorting and the timed
     filter are meaningless, so the toolbar drops them. */
  const chips = [];
  if (STATE.video?.live) {
    B.tsOnly = false;
    B.sort = 'newest';
  } else {
    chips.push(sortChip(B, renderBrowserList), tsChipToggle(B, renderBrowserList));
  }

  root.append(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tb-row1' }, [searchInput(B, renderBrowserList)]),
    el('div', { class: 'tb-controls' }, [
      ...chips,
      el('span', { class: 'tb-end' }, [reloadChip(), stopChip(), count]),
    ]),
  ]));
  root.append(el('div', { class: 'cards', id: 'browserList' }));
  root.append(el('div', { class: 'pager' }, [
    el('button', { id: 'loadMore', text: 'Load more', onclick: () => renderBrowserList(true) }),
  ]));
  if (isLiveChat()) {
    const lc = $('#browserList');
    lc.onscroll = () => { B.pinned = nearBottom(lc); };
  }
  renderBrowserList();
}

function renderBrowserList(more = false) {
  const list = $('#browserList');
  if (!list) return;
  if (isLiveChat()) {
    renderChat(list, B, $('#browserCount'));
    $('#loadMore').parentElement.hidden = true;
    return;
  }
  if (!more) { B.data = browserData(); B.shown = 0; list.innerHTML = ''; }
  const next = Math.min(B.data.length, B.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (let i = B.shown; i < next; i++) frag.append(card(B.data[i], false));
  list.append(frag);
  B.shown = next;
  finishBrowser(list);
}

function finishBrowser(list) {
  setCountPill($('#browserCount'), B.data);
  $('#loadMore').parentElement.hidden = B.shown >= B.data.length;
  if (!B.data.length) {
    list.append(STATE.commentsLoading ? loadingState()
      : el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-circle' }), el('span', { text: 'No comments match' })]));
  }
}

/* Live repaint while comments stream in: recompute, keep the paging depth.
   The re-rendered prefix lays out the same, so scroll position holds. */
export function refreshBrowser() {
  const list = $('#browserList');
  if (!list || STATE.commentsError) return;
  if (isLiveChat()) return appendChat(list, B, $('#browserCount'));
  B.data = browserData();
  B.shown = Math.min(Math.max(B.shown, PAGE), B.data.length);
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < B.shown; i++) frag.append(card(B.data[i], false));
  list.append(frag);
  finishBrowser(list);
}

/* ---------------- side panel (theater + fullscreen) ---------------- */

const P = { sort: 'newest', tsOnly: false, query: '', shown: 0, data: [], follow: true, progTarget: null, progUntil: 0, anchor: -1, chatLastId: null, pinned: true };
export const panelState = P;

export function buildPanel() {
  const bar = $('#panelBar');
  bar.innerHTML = '';

  /* Same as the browser: no sort / timed filter for live chat. */
  const chips = [];
  if (STATE.video?.live) {
    P.tsOnly = false;
    P.sort = 'newest';
  } else {
    const sortBtn = sortChip(P, renderPanelList);
    sortBtn.hidden = P.tsOnly;
    const tsBtn = tsChipToggle(P, () => {
      sortBtn.hidden = P.tsOnly;
      P.follow = true;
      renderPanelList();
    });
    chips.push(sortBtn, tsBtn);
  }

  bar.append(
    el('div', { class: 'tb-row1' }, [searchInput(P, renderPanelList)]),
    el('div', { class: 'tb-controls' }, [
      ...chips,
      el('span', { class: 'tb-end' }, [reloadChip(), stopChip(), el('span', { class: 'count-pill', id: 'panelCount' })]),
    ]),
  );

  const list = $('#panelList');
  let lastTop = list.scrollTop;
  list.onscroll = () => {
    const top = list.scrollTop;
    const delta = top - lastTop;
    lastTop = top;
    /* Follow's own smooth scroll: swallow events until it lands on its
       target (a tall comment can make the animation outlast any fixed
       time window), with a timeout in case it never quite gets there. */
    if (P.progTarget != null) {
      if (Math.abs(top - P.progTarget) < 2 || performance.now() > P.progUntil) P.progTarget = null;
      return;
    }
    /* Live chat: pinned = sitting at the bottom; unpinning offers the jump. */
    if (isLiveChat()) {
      P.pinned = nearBottom(list);
      $('#jumpLive').hidden = P.pinned;
    }
    if (Math.abs(delta) <= 2) return;   /* residue, not a real user scroll */
    /* Fullscreen: the toolbar floats over the list; scrolling down slides
       it away, scrolling up brings it back. */
    if ($('#stage').classList.contains('is-fullscreen')) {
      $('#panel').classList.toggle('bar-collapsed', delta > 0);
    }
    if (P.tsOnly && P.follow) { P.follow = false; $('#jumpLive').hidden = false; }
  };
  $('#jumpLive').onclick = () => {
    if (isLiveChat()) {
      P.pinned = true;
      list.scrollTop = list.scrollHeight;
      $('#jumpLive').hidden = true;
      return;
    }
    P.follow = true; $('#jumpLive').hidden = true; P.anchor = -1;
  };

  renderPanelList();
}

export function renderPanelList(more = false) {
  const list = $('#panelList');
  if (!list) return;
  if (STATE.commentsError) {
    list.innerHTML = '';
    list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-slash' }), el('span', { text: errorMsg(true) })]));
    return;
  }
  if (isLiveChat()) {
    renderChat(list, P, $('#panelCount'));
    $('#jumpLive').hidden = true;
    return;
  }
  if (!more) { list.innerHTML = ''; P.shown = 0; P.anchor = -1; $('#jumpLive').hidden = true; list.classList.remove('chat'); }

  const q = P.query.toLowerCase();

  if (P.tsOnly) {
    /* Video-timestamp order, latest first; the whole list renders so follow can scroll to any point. */
    P.data = STATE.comments
      .filter((c) => c.ts != null && (STATE.settings.includeReplies || !c.isReply) && (!q || matches(c, q)))
      .sort((a, b) => b.ts - a.ts || b.likes - a.likes);
    const frag = document.createDocumentFragment();
    for (const c of P.data) frag.append(card(c, true));
    list.append(frag);
    P.shown = P.data.length;
  } else {
    if (!more) P.data = groupThreads(cmpFor(P.sort), q);
    const next = Math.min(P.data.length, P.shown + PAGE);
    const frag = document.createDocumentFragment();
    for (let i = P.shown; i < next; i++) frag.append(card(P.data[i], true));
    list.append(frag);
    P.shown = next;
  }
  finishPanel(list, q);
}

function finishPanel(list, q) {
  setCountPill($('#panelCount'), P.data);
  if (P.shown < P.data.length) {
    const btn = el('button', { class: 'panel-more', text: 'Load more', onclick: () => { btn.remove(); renderPanelList(true); } });
    list.append(btn);
  }
  if (!P.data.length) {
    if (STATE.commentsLoading) list.append(loadingState());
    else if (P.tsOnly) list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-clock' }), el('span', { text: q ? 'No comments match' : 'No timestamped comments' })]));
    else list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-circle' }), el('span', { text: q ? 'No comments match' : 'No comments' })]));
  }
}

/* Live repaint of the panel while comments stream in. Keeps the paging
   depth; the follow anchor re-aims on the next player poll. */
export function refreshPanel() {
  const list = $('#panelList');
  if (!list || STATE.commentsError) return;
  if (isLiveChat()) {
    appendChat(list, P, $('#panelCount'));
    $('#jumpLive').hidden = P.pinned;
    return;
  }
  if (P.tsOnly) {
    const follow = P.follow;
    renderPanelList();
    P.follow = follow;
    $('#jumpLive').hidden = follow;
    return;
  }
  const q = P.query.toLowerCase();
  P.data = groupThreads(cmpFor(P.sort), q);
  P.shown = Math.min(Math.max(P.shown, PAGE), P.data.length);
  P.anchor = -1;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < P.shown; i++) frag.append(card(P.data[i], true));
  list.append(frag);
  finishPanel(list, q);
}

/* Follow playback: keep the most recently triggered comment at the top of the panel.
   Called from the player's poll loop. */
export function panelFollow(currentTime) {
  if (!P.tsOnly || !P.follow || !P.data.length) return;
  /* P.data is ts-desc; the anchor is the first item with ts <= currentTime. */
  let lo = 0, hi = P.data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (P.data[mid].ts > currentTime) lo = mid + 1; else hi = mid;
  }
  if (lo >= P.data.length || lo === P.anchor) return;
  P.anchor = lo;
  const list = $('#panelList');
  const node = list.children[lo];
  if (!node) return;
  const target = Math.max(0, Math.min(node.offsetTop - 6, list.scrollHeight - list.clientHeight));
  if (Math.abs(list.scrollTop - target) < 2) return;   /* already there: no scroll event to swallow */
  P.progTarget = target;
  P.progUntil = performance.now() + 1500;
  list.scrollTo({ top: target, behavior: 'smooth' });
}
