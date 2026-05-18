import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ArchiveItem } from '../../src/shared/types';
import { packSeenIds } from '../../src/shared/seenIds';

const storage = vi.hoisted(() => {
  const states = new Map<number, any>();
  const cloneState = (state: any) => ({
    ...state,
    cursor: { ...state.cursor },
    counts: { ...state.counts },
    seenIds: new Set(state.seenIds),
  });
  return {
    states,
    readArchive: vi.fn(async (peerId: number) => {
      const state = states.get(peerId);
      return state ? cloneState(state) : null;
    }),
    writeArchive: vi.fn(async (state: any) => {
      states.set(state.peerId, cloneState(state));
    }),
    newArchiveState: vi.fn((opts: { peerId: number; title: string; username: string | null }) => ({
      peerId: opts.peerId,
      title: opts.title,
      username: opts.username,
      startedAt: '2026-05-18T00:00:00.000Z',
      lastUpdatedAt: '2026-05-18T00:00:00.000Z',
      cursor: { offsetId: 0 },
      seenIds: new Set<number>(),
      counts: { downloaded: 0, skipped: 0, failed: 0 },
      status: 'in_progress',
    })),
  };
});
const downloads = vi.hoisted(() => ({
  downloadBlob: vi.fn(async () => ({ downloadId: 77, relPath: 'TelegramArchive/news__42/photo.jpg', filename: 'photo.jpg' })),
}));
const manifest = vi.hoisted(() => ({
  writeManifest: vi.fn(async () => undefined),
}));
const ndjson = vi.hoisted(() => ({
  rows: [] as ArchiveItem[],
  appendItem: vi.fn(async (_state: unknown, archiveItem: ArchiveItem) => {
    ndjson.rows.push(archiveItem);
  }),
  flushItemsToDisk: vi.fn(async () => undefined),
}));
const notifications = vi.hoisted(() => ({
  notify: vi.fn(async () => 'notification-id'),
}));
const idb = vi.hoisted(() => {
  const failures = new Map<number, any[]>();
  return {
    failures,
    appendFailure: vi.fn(async (peerId: number, failure: any) => {
      failures.set(peerId, [...(failures.get(peerId) ?? []), failure]);
    }),
    readFailures: vi.fn(async (peerId: number) => failures.get(peerId) ?? []),
  };
});

vi.mock('../../src/background/storage', () => storage);
vi.mock('../../src/background/downloads', () => downloads);
vi.mock('../../src/background/manifest-writer', () => manifest);
vi.mock('../../src/background/ndjson-writer', () => ndjson);
vi.mock('../../src/background/notifications', () => notifications);
vi.mock('../../src/background/idb', () => idb);

const item: ArchiveItem = {
  messageId: 100,
  albumGroupedId: null,
  dateUtc: '2026-05-18T10:00:00.000Z',
  fromId: null,
  fromName: null,
  caption: '',
  kind: 'photo',
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  byteSize: 3,
  qualityTier: 'x',
  downloadedAt: '',
};

async function importWorker() {
  vi.stubGlobal('chrome', {
    runtime: {
      onConnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
  });
  vi.resetModules();
  return import('../../src/background/service-worker');
}

describe('service-worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    storage.states.clear();
    ndjson.rows.length = 0;
    idb.failures.clear();
  });

  test('init creates archive state and returns a JSON-safe DTO', async () => {
    const { swHandler } = await importWorker();

    const response = await swHandler({ kind: 'init', peerId: 42, title: 'News', username: 'news' }, {});

    expect(response.ok).toBe(true);
    expect(storage.writeArchive).toHaveBeenCalledWith(expect.objectContaining({ peerId: 42, title: 'News' }));
    if (!response.ok) throw new Error('init failed');
    expect(response.value).toEqual(expect.objectContaining({ peerId: 42, seenIdsPacked: packSeenIds(new Set()) }));
    expect((response.value as { seenIds?: unknown }).seenIds).toBeUndefined();
    expect(JSON.parse(JSON.stringify(response.value))).toEqual(response.value);
  });

  test('getState returns a JSON-safe DTO with packed seen ids', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    state.seenIds = new Set([10, 20]);
    storage.states.set(42, state);

    const response = await swHandler({ kind: 'getState', peerId: 42 }, {});

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('getState failed');
    expect(response.value).toEqual(expect.objectContaining({ seenIdsPacked: packSeenIds(new Set([10, 20])) }));
    expect((response.value as { seenIds?: unknown }).seenIds).toBeUndefined();
    expect(JSON.parse(JSON.stringify(response.value))).toEqual(response.value);
  });

  test('recordSeen increments skipped only for newly seen ids', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    state.seenIds = new Set([100]);
    storage.states.set(42, state);

    const response = await swHandler(
      { kind: 'recordSeen', peerId: 42, messageIds: [100, 101, 101, 102], cursor: { offsetId: 88 } },
      {}
    );

    expect(response).toEqual({ ok: true, value: null });
    expect(storage.states.get(42)).toEqual(expect.objectContaining({
      cursor: { offsetId: 88 },
      counts: { downloaded: 0, skipped: 2, failed: 0 },
      seenIds: new Set([100, 101, 102]),
    }));
  });

  test('recordItem downloads media, appends final item, updates counts, and does not flush first item immediately', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);

    const response = await swHandler(
      { kind: 'recordItem', peerId: 42, item, bytes: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/jpeg' },
      {}
    );

    expect(response).toEqual({ ok: true, value: { filename: 'photo.jpg' } });
    expect(downloads.downloadBlob).toHaveBeenCalledWith({
      bytes: expect.any(ArrayBuffer),
      mimeType: 'image/jpeg',
      channelTitle: 'News',
      peerId: 42,
      filename: 'photo.jpg',
    });
    expect(ndjson.appendItem).toHaveBeenCalledWith(expect.objectContaining({ peerId: 42 }), expect.objectContaining({
      messageId: 100,
      filename: 'photo.jpg',
      downloadedAt: expect.any(String),
    }));
    expect(storage.writeArchive).toHaveBeenCalledWith(expect.objectContaining({
      counts: { downloaded: 1, skipped: 0, failed: 0 },
      seenIds: new Set([100]),
    }));
    expect(ndjson.flushItemsToDisk).not.toHaveBeenCalled();
    expect(manifest.writeManifest).not.toHaveBeenCalled();
  });

  test('overlapping recordItem mutations preserve both rows, counts, and seen ids', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    let releaseFirst!: () => void;
    downloads.downloadBlob
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ downloadId: 77, relPath: 'TelegramArchive/news__42/first.jpg', filename: 'first.jpg' });
          })
      )
      .mockResolvedValueOnce({ downloadId: 78, relPath: 'TelegramArchive/news__42/second.jpg', filename: 'second.jpg' });
    const first = swHandler(
      { kind: 'recordItem', peerId: 42, item: { ...item, messageId: 101, filename: 'first.jpg' }, bytes: new ArrayBuffer(1), mimeType: 'image/jpeg' },
      {}
    );
    const second = swHandler(
      { kind: 'recordItem', peerId: 42, item: { ...item, messageId: 102, filename: 'second.jpg' }, bytes: new ArrayBuffer(1), mimeType: 'image/jpeg' },
      {}
    );

    await vi.waitFor(() => expect(downloads.downloadBlob).toHaveBeenCalledTimes(2));
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, value: { filename: 'first.jpg' } },
      { ok: true, value: { filename: 'second.jpg' } },
    ]);

    expect(ndjson.rows.map((row) => row.messageId).sort((a, b) => a - b)).toEqual([101, 102]);
    expect(storage.states.get(42)).toEqual(expect.objectContaining({
      counts: { downloaded: 2, skipped: 0, failed: 0 },
      seenIds: new Set([101, 102]),
    }));
  });

  test('recordItem uses actual Chrome final basename when downloads are uniquified', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    downloads.downloadBlob.mockResolvedValueOnce({
      downloadId: 77,
      relPath: 'TelegramArchive/news__42/photo.jpg',
      filename: 'photo (1).jpg',
    });

    const response = await swHandler(
      { kind: 'recordItem', peerId: 42, item, bytes: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/jpeg' },
      {}
    );

    expect(response).toEqual({ ok: true, value: { filename: 'photo (1).jpg' } });
    expect(ndjson.rows[0]).toEqual(expect.objectContaining({ filename: 'photo (1).jpg' }));
  });

  test('recordFailure persists failures and complete flushes persisted failures after worker restart', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    const failure = { messageId: 200, reason: 'DOWNLOAD_FAILED', lastTriedAt: '2026-05-18T10:00:00.000Z' };

    await swHandler({ kind: 'recordFailure', peerId: 42, failure }, {});
    const { swHandler: restartedHandler } = await importWorker();
    const response = await restartedHandler({ kind: 'complete', peerId: 42 }, {});

    expect(response).toEqual({ ok: true, value: null });
    expect(idb.appendFailure).toHaveBeenCalledWith(42, failure);
    expect(storage.writeArchive).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      counts: { downloaded: 0, skipped: 0, failed: 1 },
    }));
    expect(manifest.writeManifest).toHaveBeenLastCalledWith(expect.objectContaining({ peerId: 42 }), [failure]);
    expect(notifications.notify).toHaveBeenCalledWith(
      'done-42',
      'Archive complete',
      'News: 0 downloaded, 1 failed.'
    );
  });
});
