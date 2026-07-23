/* Comment lists: the full browser under the video (default mode) and the
   compact side panel (theater + fullscreen). Both render the same data. */

import { STATE } from '../core/state.js';
import { $, el, fmtInt, relTime } from '../core/util.js';
import { reloadComments } from '../ui/landing.js';
import { seekTo } from './player.js';

const PAGE = 100;

/* Refetch button: first click arms it ("Fetch again?"), second click reloads.
   Arms back down after 5s so a stray tap can't spend quota. */
function reloadChip() {
  const label = el('span', { text: 'Reload' });
  const btn = el('button', { class: 'chip-toggle', title: 'Fetch comments again from YouTube' }, [
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

/* Comment text with every timestamp turned into a seek chip. */
function textWithStamps(c) {
  const wrap = el('div', { class: 'item-text' });
  let pos = 0;
  for (const st of c.stamps) {
    if (st.index > pos) wrap.append(document.createTextNode(c.text.slice(pos, st.index)));
    wrap.append(el('button', {
      class: 'ts-chip', text: c.text.slice(st.index, st.index + st.length),
      onclick: () => seekTo(st.t),
    }));
    pos = st.index + st.length;
  }
  if (pos < c.text.length) wrap.append(document.createTextNode(c.text.slice(pos)));
  return wrap;
}

function card(c, compact) {
  const meta = el('div', { class: 'item-meta' }, [
    c.isReply ? el('span', { class: 'reply-mark', title: 'Reply' }, [el('i', { class: 'ph ph-arrow-bend-down-right' })]) : null,
    el('b', { text: c.author }),
    el('span', { text: relTime(c.published) }),
    c.likes ? el('span', {}, [el('i', { class: 'ph ph-thumbs-up' }), document.createTextNode(' ' + fmtInt(c.likes))]) : null,
  ]);
  const kids = [meta, textWithStamps(c)];
  const item = el('div', { class: 'item comment' + (compact ? ' compact' : '') + (c.isReply ? ' reply' : '') });
  if (!compact && c.avatar) {
    item.append(el('div', { class: 'avatar' }, [el('img', { src: c.avatar, alt: '', loading: 'lazy' })]));
  }
  item.append(el('div', { class: 'item-main' }, kids));
  if (c.ts != null) item.dataset.ts = c.ts;
  return item;
}

/* ---------------- sorting helpers ---------------- */

const byPosted = (dir) => (a, b) => dir * (new Date(a.published) - new Date(b.published));

const matches = (c, q) => c.text.toLowerCase().includes(q) || c.author.toLowerCase().includes(q);

function browserData() {
  let list = STATE.comments;
  if (B.tsOnly) list = list.filter((c) => c.ts != null);
  const q = B.query.toLowerCase();
  if (q) list = list.filter((c) => matches(c, q));
  return [...list].sort(byPosted(B.sort === 'oldest' ? 1 : -1));
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

function sortChip(state, rerender) {
  const btn = el('button', { class: 'chip-toggle', onclick: () => {
    state.sort = state.sort === 'newest' ? 'oldest' : 'newest';
    btn.querySelector('span').textContent = state.sort === 'newest' ? 'Newest' : 'Oldest';
    rerender();
  } }, [el('i', { class: 'ph ph-sort-descending' }), el('span', { text: state.sort === 'newest' ? 'Newest' : 'Oldest' })]);
  return btn;
}

function tsChipToggle(state, rerender) {
  const btn = el('button', { class: 'chip-toggle' + (state.tsOnly ? ' on' : ''), onclick: () => {
    state.tsOnly = !state.tsOnly;
    btn.classList.toggle('on', state.tsOnly);
    rerender();
  } }, [el('i', { class: 'ph ph-clock' }), document.createTextNode(' Timestamped')]);
  return btn;
}

/* ---------------- full browser (default mode) ---------------- */

const B = { sort: 'newest', tsOnly: false, query: '', shown: 0, data: [] };

export function buildBrowser() {
  const root = $('#browser');
  root.innerHTML = '';

  if (STATE.commentsError) {
    const msg = STATE.commentsError === 'disabled'
      ? 'Comments are turned off for this video'
      : 'API quota used up. Resets at midnight Pacific';
    root.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-slash' }), el('span', { text: msg }), reloadChip()]));
    return;
  }

  const count = el('span', { class: 'count-pill', id: 'browserCount' });

  root.append(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tb-row1' }, [searchInput(B, renderBrowserList)]),
    el('div', { class: 'tb-controls' }, [
      sortChip(B, renderBrowserList), tsChipToggle(B, renderBrowserList), reloadChip(),
      el('span', { class: 'spacer' }), count,
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
  $('#browserCount').textContent = fmtInt(B.data.length);
  $('#loadMore').parentElement.hidden = B.shown >= B.data.length;
  if (!B.data.length) list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-circle' }), el('span', { text: 'No comments match' })]));
}

/* ---------------- side panel (theater + fullscreen) ---------------- */

const P = { sort: 'newest', tsOnly: false, query: '', shown: 0, data: [], follow: true, progScroll: 0, anchor: -1 };
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

  const collapse = el('button', { class: 'icon-btn panel-collapse', title: 'Hide comments', onclick: () => {
    $('#stage').classList.add('panel-hidden');
  } }, [el('i', { class: 'ph ph-caret-double-right' })]);

  bar.append(
    el('div', { class: 'tb-row1' }, [searchInput(P, renderPanelList), collapse]),
    el('div', { class: 'tb-controls' }, [
      sortBtn, tsBtn, reloadChip(),
      el('span', { class: 'spacer' }), el('span', { class: 'count-pill', id: 'panelCount' }),
    ]),
  );

  const list = $('#panelList');
  list.onscroll = () => {
    if (P.progScroll > performance.now()) return;
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
    list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-slash' }),
      el('span', { text: STATE.commentsError === 'disabled' ? 'Comments are turned off' : 'API quota used up' })]));
    return;
  }
  if (!more) { list.innerHTML = ''; P.shown = 0; P.anchor = -1; $('#jumpLive').hidden = true; }

  const q = P.query.toLowerCase();

  if (P.tsOnly) {
    /* Video-timestamp order, latest first; the whole list renders so follow can scroll to any point. */
    P.data = STATE.comments.filter((c) => c.ts != null && (!q || matches(c, q)))
      .sort((a, b) => b.ts - a.ts || b.likes - a.likes);
    setPanelCount();
    const frag = document.createDocumentFragment();
    for (const c of P.data) frag.append(card(c, true));
    list.append(frag);
    if (!P.data.length) list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-clock' }), el('span', { text: q ? 'No comments match' : 'No timestamped comments' })]));
    return;
  }

  if (!more) {
    P.data = (q ? STATE.comments.filter((c) => matches(c, q)) : [...STATE.comments]).sort(byPosted(P.sort === 'oldest' ? 1 : -1));
    setPanelCount();
  }
  const next = Math.min(P.data.length, P.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (let i = P.shown; i < next; i++) frag.append(card(P.data[i], true));
  list.append(frag);
  P.shown = next;
  if (P.shown < P.data.length) {
    const btn = el('button', { class: 'panel-more', text: 'Load more', onclick: () => { btn.remove(); renderPanelList(true); } });
    list.append(btn);
  }
  if (!P.data.length) list.append(el('div', { class: 'empty-state' }, [el('i', { class: 'ph ph-chat-circle' }), el('span', { text: q ? 'No comments match' : 'No comments' })]));
}

function setPanelCount() {
  const n = $('#panelCount');
  if (n) n.textContent = fmtInt(P.data.length);
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
  P.progScroll = performance.now() + 700;
  list.scrollTo({ top: node.offsetTop - 6, behavior: 'smooth' });
}
