import type { ArchiveFailure } from '../shared/types';

const DB_NAME = 'tg-archive';
const DB_VERSION = 2;
const NDJSON_STORE = 'ndjson';
const FAILURES_STORE = 'failures';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NDJSON_STORE)) db.createObjectStore(NDJSON_STORE);
      if (!db.objectStoreNames.contains(FAILURES_STORE)) db.createObjectStore(FAILURES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const s = t.objectStore(storeName);
        const r = fn(s);

        let result: T | undefined;
        let settled = false;
        const fail = () => {
          if (settled) return;
          settled = true;
          db.close();
          reject(t.error ?? r.error ?? new Error('IndexedDB transaction failed'));
        };

        r.onsuccess = () => {
          result = r.result;
        };
        t.oncomplete = () => {
          if (settled) return;
          settled = true;
          db.close();
          resolve(result as T);
        };
        t.onerror = fail;
        t.onabort = fail;
      })
  );
}

export function readNdjson(peerId: number): Promise<string> {
  return tx<string | undefined>(NDJSON_STORE, 'readonly', (s) => s.get(String(peerId))).then((v) => v ?? '');
}

export function writeNdjson(peerId: number, content: string): Promise<unknown> {
  return tx(NDJSON_STORE, 'readwrite', (s) => s.put(content, String(peerId)));
}

export function deleteNdjson(peerId: number): Promise<unknown> {
  return tx(NDJSON_STORE, 'readwrite', (s) => s.delete(String(peerId)));
}

export function readFailures(peerId: number): Promise<ArchiveFailure[]> {
  return tx<ArchiveFailure[] | undefined>(FAILURES_STORE, 'readonly', (s) => s.get(String(peerId))).then((failures) => [
    ...(failures ?? []),
  ]);
}

export function writeFailures(peerId: number, failures: ArchiveFailure[]): Promise<unknown> {
  return tx(FAILURES_STORE, 'readwrite', (s) => s.put([...failures], String(peerId)));
}

export async function appendFailure(peerId: number, failure: ArchiveFailure): Promise<void> {
  const failures = await readFailures(peerId);
  failures.push(failure);
  await writeFailures(peerId, failures);
}
