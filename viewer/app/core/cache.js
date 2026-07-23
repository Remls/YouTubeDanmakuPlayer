/* Per-video comment cache (IndexedDB), so a page reload doesn't respend
   API quota. Every failure degrades to "no cache"; the app never depends on it. */

const DB = 'dm-cache';
const STORE = 'videos';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, run) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/* -> { video, comments, allReplies, savedAt } or null */
export const getCached = (videoId) => tx('readonly', (s) => s.get(videoId)).catch(() => null);
export const putCached = (videoId, data) => tx('readwrite', (s) => s.put(data, videoId)).catch(() => {});
export const dropCached = (videoId) => tx('readwrite', (s) => s.delete(videoId)).catch(() => {});
export const clearCache = () => tx('readwrite', (s) => s.clear()).catch(() => {});
export const countCached = () => tx('readonly', (s) => s.count()).catch(() => 0);
