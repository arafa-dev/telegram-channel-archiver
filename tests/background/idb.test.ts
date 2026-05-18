import { IDBFactory } from 'fake-indexeddb';
import { deleteNdjson, readNdjson, writeNdjson } from '../../src/background/idb';

describe('background IndexedDB wrappers', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('readNdjson returns an empty string when no content is stored', async () => {
    await expect(readNdjson(123)).resolves.toBe('');
  });

  test('writeNdjson persists content for later reads', async () => {
    await writeNdjson(123, '{"messageId":1}\n');

    await expect(readNdjson(123)).resolves.toBe('{"messageId":1}\n');
  });

  test('deleteNdjson removes stored content', async () => {
    await writeNdjson(123, '{"messageId":1}\n');
    await deleteNdjson(123);

    await expect(readNdjson(123)).resolves.toBe('');
  });

  test('writeNdjson waits for transaction completion after request success', async () => {
    const putReq: any = { result: 'put-result', error: null, onsuccess: null, onerror: null };
    const store: any = { put: vi.fn(() => putReq) };
    const tx: any = {
      objectStore: vi.fn(() => store),
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    const db: any = {
      objectStoreNames: { contains: vi.fn(() => true) },
      transaction: vi.fn(() => tx),
      close: vi.fn(),
    };
    const openReq: any = {
      result: db,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    };
    vi.stubGlobal('indexedDB', { open: vi.fn(() => openReq) });

    const promise = writeNdjson(123, '{"messageId":1}\n');
    let settled = false;
    promise.then(() => {
      settled = true;
    });

    openReq.onsuccess(new Event('success'));
    await Promise.resolve();
    putReq.onsuccess(new Event('success'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);

    tx.oncomplete(new Event('complete'));

    await expect(promise).resolves.toBe('put-result');
    expect(db.close).toHaveBeenCalledOnce();
  });
});
