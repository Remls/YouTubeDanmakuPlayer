/* Shared video metadata card: thumbnail with a duration badge, then title,
   channel, views and age. Every field is optional, so keyless previews and
   videos cached before the richer metadata existed degrade to what they have.
   Used by the landing deep-link preview and the search results. */

import { el, fmtCompact, fmtTime, relTime } from '../core/util.js';

export function videoCard(v, { href, onclick, note } = {}) {
  const thumb = el('div', { class: 'vc-thumb' }, [
    v.thumb ? el('img', { src: v.thumb, alt: '', loading: 'lazy' }) : null,
    v.duration ? el('span', { class: 'vc-badge', text: fmtTime(v.duration) }) : null,
  ]);
  const stats = [];
  if (v.viewCount) stats.push(fmtCompact(v.viewCount) + ' views');
  if (v.published) stats.push(relTime(v.published));
  const info = el('div', { class: 'vc-info' }, [
    el('strong', { class: 'vc-title', text: v.title || 'YouTube video' }),
    v.channel ? el('span', { class: 'vc-channel', text: v.channel }) : null,
    stats.length ? el('span', { class: 'vc-stats', text: stats.join(', ') }) : null,
    note ? el('span', { class: 'vc-note', text: note }) : null,
  ]);
  const card = el(href ? 'a' : 'div', { class: 'video-card', href: href || null }, [thumb, info]);
  if (onclick) card.onclick = onclick;
  return card;
}
