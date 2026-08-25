/* Score-based spam detector. Signals add points; a comment is spam at
   SPAM_AT points or more. The verdict is cached per comment and reset by
   rescanSpamAuthors when the comment set changes. */

const SPAM_AT = 2;

/* ---- Stamps that are not video moments: clock times and scripture verses ---- */

const BOOKS = new Set([
  'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges',
  'ruth', 'samuel', 'kings', 'chronicles', 'ezra', 'nehemiah', 'esther', 'job',
  'psalm', 'psalms', 'proverbs', 'ecclesiastes', 'isaiah', 'jeremiah',
  'lamentations', 'ezekiel', 'daniel', 'hosea', 'joel', 'amos', 'obadiah',
  'jonah', 'micah', 'nahum', 'habakkuk', 'zephaniah', 'haggai', 'zechariah',
  'malachi', 'matthew', 'mark', 'luke', 'john', 'acts', 'romans', 'corinthians',
  'galatians', 'ephesians', 'philippians', 'colossians', 'thessalonians',
  'timothy', 'titus', 'philemon', 'hebrews', 'james', 'peter', 'jude',
  'revelation', 'revelations',
]);

function suspectStamp(text, st) {
  const after = text.slice(st.index + st.length);
  if (/^\s*(a\.?m\.?|p\.?m\.?|o'?clock)\b/i.test(after)) return true;
  const before = text.slice(0, st.index);
  if (/\b(watching|streaming|listening)\s+(this\s+)?at\s*$|\b(it'?s|its|time\s+is|currently)\s*$/i.test(before)) return true;
  const word = before.match(/([A-Za-z']+)\s*$/);
  return !!word && /^[A-Z]/.test(word[1]) && BOOKS.has(word[1].toLowerCase());
}

/* ---- Religious vocabulary ---- */

const RELIGIOUS = /\b(jesus|christ|god|lord|amen|hallelujah|bible|gospel|pray(?:s|er|ers|ing)?|bless(?:ed|ing|ings)?|savio(?:u)?r|repent(?:s|ance)?|holy|scriptures?|psalms?|sermon|worship)\b/gi;

/* ---- Authors reposting the same text ---- */

let spamAuthors = new Set();

/* Call whenever STATE.comments changes: rebuilds the repeat-poster set and
   drops every cached verdict (they depend on it). Texts compare equal after
   lowercasing and stripping everything but letters and digits. */
export function rescanSpamAuthors(comments) {
  spamAuthors = new Set();
  const byAuthor = new Map();
  for (const c of comments) {
    if (!c.author) continue;
    const norm = (c.text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!norm) continue;
    let texts = byAuthor.get(c.author);
    if (!texts) byAuthor.set(c.author, texts = new Set());
    if (texts.has(norm)) spamAuthors.add(c.author);
    else texts.add(norm);
  }
  for (const c of comments) { delete c._spam; delete c._spamWhy; }
}

function evaluate(c) {
  const reasons = [];
  let pts = 0;
  if (spamAuthors.has(c.author)) {
    pts += SPAM_AT;
    reasons.push(`author posts the same text repeatedly (+${SPAM_AT})`);
  }
  if (c.stamps.length && c.stamps.every((st) => suspectStamp(c.text, st))) {
    pts += SPAM_AT;
    reasons.push(`timestamps read as clock times or scripture verses (+${SPAM_AT})`);
  }
  const rel = ((c.text || '').match(RELIGIOUS) || []).length;
  if (rel) {
    const p = rel >= 3 ? SPAM_AT : 1;
    pts += p;
    reasons.push(`religious wording, ${rel} ${rel > 1 ? 'words' : 'word'} (+${p})`);
  }
  c._spam = pts >= SPAM_AT;
  c._spamWhy = c._spam ? `Suspected spam, score ${pts} ≥ threshold ${SPAM_AT}: ${reasons.join('; ')}` : '';
  return c;
}

export const isSpam = (c) => (c._spam ?? evaluate(c)._spam);
export const spamReason = (c) => (c._spamWhy ?? evaluate(c)._spamWhy);
