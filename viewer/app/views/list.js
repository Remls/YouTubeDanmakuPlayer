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

/* ---------------- full browser (default mode) ---------------- */

const B = { sort: 'newest', tsOnly: false, query: '', shown: 0, data: [] };

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

  root.append(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tb-row1' }, [searchInput(B, renderBrowserList)]),
    el('div', { class: 'tb-controls' }, [
      sortChip(B, renderBrowserList), tsChipToggle(B, renderBrowserList),
      el('span', { class: 'tb-end' }, [reloadChip(), stopChip(), count]),
    ]),
  ]));
  root.append(el('div', { class: 'cards', id: 'browserList' }));
  root.append(el('div', { class: 'pager' }, [
    el('button', { id: 'loadMore', text: 'Load more', onclick: () => renderBrowserList(true) }),
  ]));
  renderBrowserList();
}

function renderBrowserList(more = false) {
  const list = $('#browserList');
  if (!list) return;
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
  B.data = browserData();
  B.shown = Math.min(Math.max(B.shown, PAGE), B.data.length);
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < B.shown; i++) frag.append(card(B.data[i], false));
  list.append(frag);
  finishBrowser(list);
}

/* ---------------- side panel (theater + fullscreen) ---------------- */

const P = { sort: 'newest', tsOnly: false, query: '', shown: 0, data: [], follow: true, progTarget: null, progUntil: 0, anchor: -1 };
export const panelState = P;

export function buildPanel() {
  const bar = $('#panelBar');
  bar.innerHTML = '';

  const sortBtn = sortChip(P, renderPanelList);
  sortBtn.hidden = P.tsOnly;
  const tsBtn = tsChipToggle(P, () => {
    sortBtn.hidden = P.tsOnly;
    P.follow = true;
    renderPanelList();
  });

  bar.append(
    el('div', { class: 'tb-row1' }, [searchInput(P, renderPanelList)]),
    el('div', { class: 'tb-controls' }, [
      sortBtn, tsBtn,
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
    if (Math.abs(delta) <= 2) return;   /* residue, not a real user scroll */
    /* Fullscreen: the toolbar floats over the list; scrolling down slides
       it away, scrolling up brings it back. */
    if ($('#stage').classList.contains('is-fullscreen')) {
      $('#panel').classList.toggle('bar-collapsed', delta > 0);
    }
    if (P.tsOnly && P.follow) { P.follow = false; $('#jumpLive').hidden = false; }
  };
  $('#jumpLive').onclick = () => { P.follow = true; $('#jumpLive').hidden = true; P.anchor = -1; };

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
  if (!more) { list.innerHTML = ''; P.shown = 0; P.anchor = -1; $('#jumpLive').hidden = true; }

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
