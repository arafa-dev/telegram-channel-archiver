import { beforeEach, describe, expect, test, vi } from 'vitest';
import { newArchiveState } from '../../src/background/storage';
import type { ArchiveItem } from '../../src/shared/types';

const idb = vi.hoisted(() => ({
  readNdjson: vi.fn(async () => ''),
  writeNdjson: vi.fn(async () => undefined),
}));
const downloads = vi.hoisted(() => ({
  downloadTextOverwrite: vi.fn(async () => ({ downloadId: 1, relPath: 'items.ndjson' })),
}));

vi.mock('../../src/background/idb', () => idb);
vi.mock('../../src/background/downloads', () => downloads);

const item: ArchiveItem = {
  messageId: 10,
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
  downloadedAt: '2026-05-18T10:01:00.000Z',
};

describe('NDJSON writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('appendItem appends one item row to the peer NDJSON buffer', async () => {
    const { appendItem } = await import('../../src/background/ndjson-writer');
    const state = newArchiveState({ peerId: 42, title: 'Telegram News', username: null });
    idb.readNdjson.mockResolvedValueOnce('{"messageId":9}\n');

    await appendItem(state, item);

    expect(idb.writeNdjson).toHaveBeenCalledWith(42, `{"messageId":9}\n${JSON.stringify(item)}\n`);
  });

  test('flushItemsToDisk overwrites items.ndjson from the peer buffer', async () => {
    const { flushItemsToDisk } = await import('../../src/background/ndjson-writer');
    const state = newArchiveState({ peerId: 42, title: 'Telegram News', username: null });
    idb.readNdjson.mockResolvedValueOnce(`${JSON.stringify(item)}\n`);

    await flushItemsToDisk(state);

    expect(downloads.downloadTextOverwrite).toHaveBeenCalledWith({
      text: `${JSON.stringify(item)}\n`,
      channelTitle: 'Telegram News',
      peerId: 42,
      filename: 'items.ndjson',
      mimeType: 'application/json',
    });
  });
});
