import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ArchiveItem } from '../../src/shared/types';

const storage = vi.hoisted(() => {
  const states = new Map<number, any>();
  return {
    states,
    readArchive: vi.fn(async (peerId: number) => states.get(peerId) ?? null),
    writeArchive: vi.fn(async (state: any) => {
      states.set(state.peerId, { ...state, seenIds: new Set(state.seenIds) });
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
  downloadBlob: vi.fn(async () => ({ downloadId: 77, relPath: 'TelegramArchive/news__42/photo.jpg' })),
}));
const manifest = vi.hoisted(() => ({
  writeManifest: vi.fn(async () => undefined),
}));
const ndjson = vi.hoisted(() => ({
  appendItem: vi.fn(async () => undefined),
  flushItemsToDisk: vi.fn(async () => undefined),
}));
const notifications = vi.hoisted(() => ({
  notify: vi.fn(async () => 'notification-id'),
}));

vi.mock('../../src/background/storage', () => storage);
vi.mock('../../src/background/downloads', () => downloads);
vi.mock('../../src/background/manifest-writer', () => manifest);
vi.mock('../../src/background/ndjson-writer', () => ndjson);
vi.mock('../../src/background/notifications', () => notifications);

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
  });

  test('init creates archive state when missing', async () => {
    const { swHandler } = await importWorker();

    const response = await swHandler({ kind: 'init', peerId: 42, title: 'News', username: 'news' }, {});

    expect(response.ok).toBe(true);
    expect(storage.writeArchive).toHaveBeenCalledWith(expect.objectContaining({ peerId: 42, title: 'News' }));
  });

  test('recordItem downloads media, appends final item, updates counts, and flushes due initial dirty timestamp', async () => {
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
    expect(ndjson.flushItemsToDisk).toHaveBeenCalledWith(expect.objectContaining({ peerId: 42 }));
    expect(manifest.writeManifest).toHaveBeenCalledWith(expect.objectContaining({ peerId: 42 }), []);
  });

  test('recordFailure stores failures and complete flushes manifest with notification', async () => {
    const { swHandler } = await importWorker();
    const state = storage.newArchiveState({ peerId: 42, title: 'News', username: null });
    storage.states.set(42, state);
    const failure = { messageId: 200, reason: 'DOWNLOAD_FAILED', lastTriedAt: '2026-05-18T10:00:00.000Z' };

    await swHandler({ kind: 'recordFailure', peerId: 42, failure }, {});
    const response = await swHandler({ kind: 'complete', peerId: 42 }, {});

    expect(response).toEqual({ ok: true, value: null });
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
