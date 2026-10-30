/**
 * Tiny IndexedDB key-value store for the desk snapshot, with a
 * localStorage fallback (private browsing, blocked IDB).
 */
const DB = 'deska';
const STORE = 'desk';
const KEY = 'main';
const LS_KEY = 'deska:desk';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function loadRaw(): Promise<unknown> {
  const db = await open();
  if (db) {
    const v = await new Promise<unknown>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (v) return v;
  }
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function saveRaw(value: unknown): Promise<void> {
  const db = await open();
  if (db) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the desk still works this session */
  }
}

export async function clearAll(): Promise<void> {
  const db = await open();
  if (db) {
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
