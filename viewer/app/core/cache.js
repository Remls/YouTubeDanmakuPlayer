/* IndexedDB caches, so reloads and repeat searches don't respend API quota:
   per-video comments, plus search results with a 1-hour shelf life.
   Every failure degrades to "no cache"; the app never depends on it. */

const DB = 'dm-cache';
const VIDEOS = 'videos';
const SEARCHES = 'searches';
const SEARCH_TTL = 60 * 60 * 1000;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const store of [VIDEOS, SEARCHES]) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, run) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = run(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/* -> { video, comments, allReplies, savedAt } or null */
export const getCached = (videoId) => tx(VIDEOS, 'readonly', (s) => s.get(videoId)).catch(() => null);
export const putCached = (videoId, data) => tx(VIDEOS, 'readwrite', (s) => s.put(data, videoId)).catch(() => {});
export const dropCached = (videoId) => tx(VIDEOS, 'readwrite', (s) => s.delete(videoId)).catch(() => {});

const searchKey = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/* -> { videos, nextPageToken, savedAt } or null; stale entries self-delete. */
export async function getSearch(q) {
  const hit = await tx(SEARCHES, 'readonly', (s) => s.get(searchKey(q))).catch(() => null);
  if (!hit) return null;
  if (Date.now() - (hit.savedAt || 0) > SEARCH_TTL) {
    tx(SEARCHES, 'readwrite', (s) => s.delete(searchKey(q))).catch(() => {});
    return null;
  }
  return hit;
}

export const putSearch = (q, data) =>
  tx(SEARCHES, 'readwrite', (s) => s.put({ ...data, savedAt: Date.now() }, searchKey(q))).catch(() => {});

/* Settings "clear cache" wipes both stores. */
export const clearCache = () => Promise.all([
  tx(VIDEOS, 'readwrite', (s) => s.clear()).catch(() => {}),
  tx(SEARCHES, 'readwrite', (s) => s.clear()).catch(() => {}),
]);

/* -> { videos, searches } entry counts for the settings label. */
export const countCached = async () => ({
  videos: await tx(VIDEOS, 'readonly', (s) => s.count()).catch(() => 0),
  searches: await tx(SEARCHES, 'readonly', (s) => s.count()).catch(() => 0),
});
