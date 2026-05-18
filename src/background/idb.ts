const DB_NAME = 'tg-archive';
const DB_VERSION = 1;
const STORE = 'ndjson';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const r = fn(s);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        t.oncomplete = () => db.close();
        t.onabort = () => {
          db.close();
          reject(t.error);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      })
  );
}

export function readNdjson(peerId: number): Promise<string> {
  return tx<string | undefined>('readonly', (s) => s.get(String(peerId))).then((v) => v ?? '');
}

export function writeNdjson(peerId: number, content: string): Promise<unknown> {
  return tx('readwrite', (s) => s.put(content, String(peerId)));
}

export function deleteNdjson(peerId: number): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(String(peerId)));
}
