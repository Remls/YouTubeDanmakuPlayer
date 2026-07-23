/* Danmaku overlay engine. Two styles:
   - scroll: right-to-left lanes at a constant pixel speed (constant speed means
     items in a lane can never overtake each other)
   - popup: fade in near the bottom, hold, fade out (three slots)
   The layer is pointer-events: none, so it never blocks the player. */

import { STATE } from '../core/state.js';
import { segmentText } from '../core/util.js';

/* Comment text with timestamps rendered as chips and @mentions highlighted
   (same look as the comment lists), whitespace collapsed, truncated at
   maxLength. Appends into node; returns false if nothing visible remains. */
function appendLine(node, comment, maxLength) {
  const parts = segmentText(comment.text, comment.stamps);
  for (const p of parts) if (p.type === 'text') p.str = p.str.replace(/\s+/g, ' ');
  if (parts.length && parts[0].type === 'text') parts[0].str = parts[0].str.trimStart();
  const tail = parts[parts.length - 1];
  if (tail && tail.type === 'text') tail.str = tail.str.trimEnd();

  let used = 0;
  for (const p of parts) {
    const room = maxLength - used;
    const atomic = p.type !== 'text';   /* chips and mentions never render clipped */
    if (room <= 0 || (atomic && p.str.length > room)) {
      if (used) node.append('…');
      break;
    }
    if (atomic) {
      const span = document.createElement('span');
      span.className = p.type === 'ts' ? 'ts-chip' : 'mention';
      span.textContent = p.str;
      node.append(span);
      used += p.str.length;
    } else {
      const clip = p.str.length > room;
      const str = clip ? p.str.slice(0, room - 1) + '…' : p.str;
      if (str) node.append(document.createTextNode(str));
      used += str.length;
      if (clip) break;
    }
  }
  return used > 0;
}

export class Danmaku {
  constructor(layer) {
    this.layer = layer;
    this.enabled = true;
    this.laneFreeAt = [];        // per-lane: timestamp when the lane can accept the next item
    this.popups = [];            // active popup nodes, oldest first
    this.active = 0;
  }

  clear() {
    this.layer.innerHTML = '';
    this.laneFreeAt = [];
    this.popups = [];
    this.active = 0;
  }

  spawn(comment) {
    if (!this.enabled) return;
    const s = STATE.settings;
    if (this.active >= s.maxOnScreen) return;

    const node = document.createElement('div');
    node.className = 'dm';
    node.style.fontSize = s.fontSize + 'px';
    node.style.opacity = s.opacity / 100;
    if (comment.isReply) {
      const icon = document.createElement('i');
      icon.className = 'ph ph-arrow-bend-down-right dm-reply';
      node.append(icon);
    }
    if (!appendLine(node, comment, s.maxLength)) return;

    if (s.style === 'popup') this.spawnPopup(node);
    else this.spawnScroll(node);
  }

  spawnScroll(node) {
    const s = STATE.settings;
    const W = this.layer.clientWidth;
    const H = this.layer.clientHeight;
    if (!W || !H) return;

    this.layer.append(node);
    const w = node.offsetWidth;
    const laneH = node.offsetHeight + 6;   /* backdrop padding varies with font size, so measure */
    const lanes = Math.max(1, Math.floor((H * s.coverage / 100) / laneH));

    const speed = (W + 200) / s.duration;          // px/s, constant across items
    const now = performance.now();
    let lane = -1;
    for (let i = 0; i < lanes; i++) {
      if ((this.laneFreeAt[i] || 0) <= now) { lane = i; break; }
    }
    if (lane === -1) { node.remove(); return; }    // all lanes busy: drop

    this.laneFreeAt[lane] = now + ((w + 30) / speed) * 1000;   // free once the tail + gap has entered
    node.style.top = (lane * laneH) + 'px';
    this.active++;

    const travel = W + w;
    const anim = node.animate(
      [{ transform: `translateX(${W}px)` }, { transform: `translateX(${-w}px)` }],
      { duration: (travel / speed) * 1000, easing: 'linear' }
    );
    anim.onfinish = () => { node.remove(); this.active--; };
  }

  spawnPopup(node) {
    if (this.popups.length >= 3) return;
    node.classList.add('dm-pop', 'pop-' + STATE.settings.popupH);
    node.style.width = `min(${STATE.settings.popupWidth}px, 80%)`;
    this.layer.append(node);
    this.popups.push(node);
    this.layoutPopups();
    /* Enable the restack transition only after initial placement,
       so a new popup doesn't slide in from the container edge. */
    requestAnimationFrame(() => node.classList.add('pop-settled'));
    this.active++;
    const anim = node.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }],
      { duration: 4500, easing: 'linear' }
    );
    anim.onfinish = () => {
      node.remove();
      this.popups = this.popups.filter((n) => n !== node);
      this.layoutPopups();
      this.active--;
    };
  }

  /* Popups have varying heights (fixed width, wrapped text), so stack them
     from the chosen edge by measured height. */
  layoutPopups() {
    const top = STATE.settings.popupV === 'top';
    let off = 12;
    for (const n of this.popups) {
      if (top) { n.style.top = off + 'px'; n.style.bottom = 'auto'; }
      else { n.style.top = 'auto'; n.style.bottom = off + 'px'; }
      off += n.offsetHeight + 8;
    }
  }
}
