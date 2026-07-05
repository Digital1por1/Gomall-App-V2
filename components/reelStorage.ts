// Persistencia local del Editor de Reels (IndexedDB): guarda los blobs de media (video/música/voz)
// y un snapshot del proyecto, para que el trabajo no se pierda al cerrar o recargar la pestaña.
// Todo client-side, sin costo ni servidor.

const DB_NAME = 'gomall-reel';
const DB_VERSION = 1;
const STORE_MEDIA = 'media';
const STORE_PROJ = 'projects';
const PROJECT_KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEDIA)) db.createObjectStore(STORE_MEDIA);
      if (!db.objectStoreNames.contains(STORE_PROJ)) db.createObjectStore(STORE_PROJ);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

export const putMedia = (id: string, blob: Blob) => run<void>(STORE_MEDIA, 'readwrite', s => s.put(blob, id));
export const getMedia = (id: string) => run<Blob | undefined>(STORE_MEDIA, 'readonly', s => s.get(id));
export const allMediaKeys = () => run<IDBValidKey[]>(STORE_MEDIA, 'readonly', s => s.getAllKeys());
export const delMedia = (id: string) => run<void>(STORE_MEDIA, 'readwrite', s => s.delete(id));

export const putProject = (p: unknown) => run<void>(STORE_PROJ, 'readwrite', s => s.put(p, PROJECT_KEY));
export const getProject = <T = unknown>() => run<T | undefined>(STORE_PROJ, 'readonly', s => s.get(PROJECT_KEY));
export const clearProject = () => run<void>(STORE_PROJ, 'readwrite', s => s.delete(PROJECT_KEY));

// Variantes por-clave (para proyectos con distinto esquema, ej. el editor V2).
export const putProjectAt = (key: string, p: unknown) => run<void>(STORE_PROJ, 'readwrite', s => s.put(p, key));
export const getProjectAt = <T = unknown>(key: string) => run<T | undefined>(STORE_PROJ, 'readonly', s => s.get(key));
export const clearProjectAt = (key: string) => run<void>(STORE_PROJ, 'readwrite', s => s.delete(key));

// Borra los blobs de media que ya no referencia ningún proyecto (evita que la base crezca sin control).
export async function pruneMedia(keepIds: Set<string>): Promise<void> {
  try {
    const keys = await allMediaKeys();
    for (const k of keys) {
      if (!keepIds.has(String(k))) await delMedia(String(k));
    }
  } catch { /* no-op */ }
}

let idCounter = 0;
export function newMediaId(): string {
  idCounter += 1;
  return `m_${Date.now().toString(36)}_${idCounter}`;
}
