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
      const existing = failures.get(peerId) ?? [];
      const withoutSameMessage = existing.filter((stored) => stored.messageId !== failure.messageId);
      failures.set(peerId, [...withoutSameMessage, failure]);
      return withoutSameMessage.length === existing.length;
    }),
    removeFailuresByMessageId: vi.fn(async (peerId: number, messageId: number) => {
      const existing = failures.get(peerId) ?? [];
      const kept = existing.filter((failure) => failure.messageId !== messageId);
      failures.set(peerId, kept);
      return existing.length - kept.length;
    }),
    readFailures: vi.fn(async (peerId: number) => failures.get(peerId) ?? []),
  };
});
const install = vi.hoisted(() => ({
  registerBridge: vi.fn(async () => undefined),
}));

vi.mock('../../src/background/storage', () => storage);
vi.mock('../../src/background/downloads', () => downloads);
vi.mock('../../src/background/manifest-writer', () => manifest);
vi.mock('../../src/background/ndjson-writer', () => ndjson);
vi.mock('../../src/background/notifications', () => notifications);
vi.mock('../../src/background/idb', () => idb);
vi.mock('../../src/background/install', () => install);

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
  const onInstalled = { addListener: vi.fn() };
  const onStartup = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    runtime: {
      onConnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onInstalled,
      onStartup,
    },
  });
  vi.resetModules();
  const worker = await import('../../src/background/service-worker');
  return { ...worker, onInstalled, onStartup };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function recordViaTransfer(
  swHandler: (req: any, sender: any) => Promise<any>,
  opts: { transferId: string; peerId: number; item: ArchiveItem; bytes: Uint8Array; mimeType: string }
) {
  const send = (req: any) => swHandler(JSON.parse(JSON.stringify(req)), {});
  await send({
    kind: 'beginItemTransfer',
    transferId: opts.transferId,
    peerId: opts.peerId,
    item: opts.item,
    mimeType: opts.mimeType,
    totalBytes: opts.bytes.byteLength,
  });
  await send({ kind: 'appendItemTransferChunk', transferId: opts.transferId, index: 0, data: bytesToBase64(opts.bytes) });
  return send({ kind: 'recordItemFromTransfer', transferId: opts.transferId });
}

describe('service-worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    storage.states.clear();
    ndjson.rows.length = 0;
    idb.failures.clear();
    install.registerBridge.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('registers the MAIN-world bridge on install and startup events', async () => {
    const { onInstalled, onStartup } = await importWorker();
    const installedListener = onInstalled.addListener.mock.calls[0]?.[0];
    const startupListener = onStartup.addListener.mock.calls[0]?.[0];

    expect(installedListener).toBeTypeOf('function');
    expect(startupListener).toBeTypeOf('function');

    installedListener();
    startupListener();
    await vi.waitFor(() => expect(install.registerBridge).toHaveBeenCalledTimes(2));
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

  test('init restarts an existing archive by persisting in-progress status', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    state.status = 'completed';
    storage.states.set(42, state);

    const response = await swHandler({ kind: 'init', peerId: 42, title: 'News', username: null }, {});

    expect(response).toEqual(expect.objectContaining({ ok: true }));
    expect(storage.states.get(42)).toEqual(expect.objectContaining({ status: 'in_progress' }));
    expect(storage.writeArchive).toHaveBeenCalledWith(expect.objectContaining({ peerId: 42, status: 'in_progress' }));
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

  test('recordSeen adds all message ids but counts skippedIds only', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    state.seenIds = new Set([100]);
    storage.states.set(42, state);

    const response = await swHandler(
      { kind: 'recordSeen', peerId: 42, messageIds: [100, 101, 101, 102, 103], skippedIds: [100, 102], cursor: { offsetId: 88 } },
      {}
    );

    expect(response).toEqual({ ok: true, value: null });
    expect(storage.states.get(42)).toEqual(expect.objectContaining({
      cursor: { offsetId: 88 },
      counts: { downloaded: 0, skipped: 1, failed: 0 },
      seenIds: new Set([100, 101, 102, 103]),
    }));
  });

  test('recordSeen remains backward compatible by treating messageIds as seen only', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);

    const response = await swHandler(
      { kind: 'recordSeen', peerId: 42, messageIds: [201, 202], cursor: { offsetId: 77 } },
      {}
    );

    expect(response).toEqual({ ok: true, value: null });
    expect(storage.states.get(42)).toEqual(expect.objectContaining({
      cursor: { offsetId: 77 },
      counts: { downloaded: 0, skipped: 0, failed: 0 },
      seenIds: new Set([201, 202]),
    }));
  });

  test('recordItemFromTransfer downloads media, appends final item, updates counts, and does not flush first item immediately', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);

    const response = await recordViaTransfer(swHandler, {
      transferId: 'record-item',
      peerId: 42,
      item,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    });

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

  test('records item from JSON-safe chunked transfer after Chrome-style serialization', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    const send = (req: any) => swHandler(JSON.parse(JSON.stringify(req)), {});

    await expect(send({
      kind: 'beginItemTransfer',
      transferId: 'transfer-1',
      peerId: 42,
      item,
      mimeType: 'image/jpeg',
      totalBytes: 3,
    })).resolves.toEqual({ ok: true, value: null });
    await expect(send({ kind: 'appendItemTransferChunk', transferId: 'transfer-1', index: 0, data: 'AQID' })).resolves.toEqual({
      ok: true,
      value: null,
    });
    const response = await send({ kind: 'recordItemFromTransfer', transferId: 'transfer-1' });

    expect(response).toEqual({ ok: true, value: { filename: 'photo.jpg' } });
    expect(downloads.downloadBlob).toHaveBeenCalledWith(expect.objectContaining({
      bytes: expect.any(ArrayBuffer),
      mimeType: 'image/jpeg',
    }));
    expect(downloads.downloadBlob.mock.calls.length).toBeGreaterThan(0);
    const downloadInput = (downloads.downloadBlob as any).mock.calls[0][0] as { bytes: ArrayBuffer };
    expect([...new Uint8Array(downloadInput.bytes)]).toEqual([1, 2, 3]);
  });

  test('overlapping transfer commits preserve both rows, counts, and seen ids', async () => {
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
    const first = recordViaTransfer(swHandler, {
      transferId: 'first-transfer',
      peerId: 42,
      item: { ...item, messageId: 101, filename: 'first.jpg' },
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
    });
    const second = recordViaTransfer(swHandler, {
      transferId: 'second-transfer',
      peerId: 42,
      item: { ...item, messageId: 102, filename: 'second.jpg' },
      bytes: new Uint8Array([2]),
      mimeType: 'image/jpeg',
    });

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

  test('recordItemFromTransfer uses actual Chrome final basename when downloads are uniquified', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    downloads.downloadBlob.mockResolvedValueOnce({
      downloadId: 77,
      relPath: 'TelegramArchive/news__42/photo.jpg',
      filename: 'photo (1).jpg',
    });

    const response = await recordViaTransfer(swHandler, {
      transferId: 'unique-name-transfer',
      peerId: 42,
      item,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    });

    expect(response).toEqual({ ok: true, value: { filename: 'photo (1).jpg' } });
    expect(ndjson.rows[0]).toEqual(expect.objectContaining({ filename: 'photo (1).jpg' }));
  });

  test('recordItemFromTransfer clears prior failures for the same message and decrements failed count', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    const failure = { messageId: item.messageId, reason: 'DOWNLOAD_FAILED', lastTriedAt: '2026-05-18T10:00:00.000Z' };

    await swHandler({ kind: 'recordFailure', peerId: 42, failure }, {});
    const response = await recordViaTransfer(swHandler, {
      transferId: 'retry-success',
      peerId: 42,
      item,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    });
    await swHandler({ kind: 'flushPersist', peerId: 42 }, {});

    expect(response).toEqual({ ok: true, value: { filename: 'photo.jpg' } });
    expect(idb.removeFailuresByMessageId).toHaveBeenCalledWith(42, item.messageId);
    expect(idb.failures.get(42)).toEqual([]);
    expect(storage.states.get(42)).toEqual(expect.objectContaining({
      counts: { downloaded: 1, skipped: 0, failed: 0 },
      seenIds: new Set([item.messageId]),
    }));
    expect(manifest.writeManifest).toHaveBeenLastCalledWith(expect.objectContaining({ peerId: 42 }), []);
  });

  test('recordItemFromTransfer never decrements failed count below zero when clearing duplicate failures', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    idb.failures.set(42, [
      { messageId: item.messageId, reason: 'one', lastTriedAt: '2026-05-18T10:00:00.000Z' },
      { messageId: item.messageId, reason: 'two', lastTriedAt: '2026-05-18T10:01:00.000Z' },
    ]);

    const response = await recordViaTransfer(swHandler, {
      transferId: 'retry-duplicates',
      peerId: 42,
      item,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    });

    expect(response).toEqual({ ok: true, value: { filename: 'photo.jpg' } });
    expect(storage.states.get(42)).toEqual(expect.objectContaining({
      counts: { downloaded: 1, skipped: 0, failed: 0 },
    }));
  });

  test('service-worker item transfers reject oversized totals and chunks', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);

    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'huge',
      peerId: 42,
      item,
      mimeType: 'application/octet-stream',
      totalBytes: 512 * 1024 * 1024 + 1,
    }, {})).resolves.toEqual({ ok: false, error: 'TRANSFER_TOO_LARGE' });

    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'chunk-too-large',
      peerId: 42,
      item,
      mimeType: 'application/octet-stream',
      totalBytes: 100_000,
    }, {})).resolves.toEqual({ ok: true, value: null });
    await expect(swHandler({
      kind: 'appendItemTransferChunk',
      transferId: 'chunk-too-large',
      index: 0,
      data: 'A'.repeat(80 * 1024),
    }, {})).resolves.toEqual({ ok: false, error: 'CHUNK_TOO_LARGE' });
    await expect(swHandler({ kind: 'recordItemFromTransfer', transferId: 'chunk-too-large' }, {})).resolves.toEqual({
      ok: false,
      error: 'UNKNOWN_TRANSFER',
    });
  });

  test('service-worker item transfers enforce max active transfers and release slots on abort', async () => {
    const { swHandler } = await importWorker();

    for (let index = 0; index < 8; index += 1) {
      await expect(swHandler({
        kind: 'beginItemTransfer',
        transferId: `transfer-${index}`,
        peerId: 42,
        item,
        mimeType: 'text/plain',
        totalBytes: 0,
      }, {})).resolves.toEqual({ ok: true, value: null });
    }

    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'transfer-8',
      peerId: 42,
      item,
      mimeType: 'text/plain',
      totalBytes: 0,
    }, {})).resolves.toEqual({ ok: false, error: 'TOO_MANY_TRANSFERS' });

    await expect(swHandler({ kind: 'abortItemTransfer', transferId: 'transfer-0' }, {})).resolves.toEqual({ ok: true, value: null });
    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'transfer-8',
      peerId: 42,
      item,
      mimeType: 'text/plain',
      totalBytes: 0,
    }, {})).resolves.toEqual({ ok: true, value: null });
  });

  test('service-worker item transfers clean up after TTL and permit id reuse', async () => {
    vi.useFakeTimers();
    const { swHandler } = await importWorker();

    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'ttl-transfer',
      peerId: 42,
      item,
      mimeType: 'text/plain',
      totalBytes: 0,
    }, {})).resolves.toEqual({ ok: true, value: null });
    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'ttl-transfer',
      peerId: 42,
      item,
      mimeType: 'text/plain',
      totalBytes: 0,
    }, {})).resolves.toEqual({ ok: false, error: 'TRANSFER_EXISTS' });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(swHandler({
      kind: 'beginItemTransfer',
      transferId: 'ttl-transfer',
      peerId: 42,
      item,
      mimeType: 'text/plain',
      totalBytes: 0,
    }, {})).resolves.toEqual({ ok: true, value: null });
  });

  test('flushPersist can persist an error status before writing the manifest', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    state.status = 'completed';
    storage.states.set(42, state);

    const response = await swHandler({ kind: 'flushPersist', peerId: 42, status: 'error' }, {});

    expect(response).toEqual({ ok: true, value: null });
    expect(storage.states.get(42)).toEqual(expect.objectContaining({ status: 'error' }));
    expect(manifest.writeManifest).toHaveBeenLastCalledWith(expect.objectContaining({ peerId: 42, status: 'error' }), []);
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
