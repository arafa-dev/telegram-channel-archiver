import { describe, expect, test, vi } from 'vitest';
import type { WalkItem } from '../../src/content/walker';

const queuedItem: WalkItem = {
  meta: {
    messageId: 1807,
    albumGroupedId: null,
    dateUtc: '2026-04-20T06:27:13.000Z',
    fromId: 8058690458,
    fromName: null,
    caption: '',
  },
  mediaRef: {
    kind: 'photo',
    mimeType: 'image/jpeg',
    fileName: null,
    photoSizes: [{ type: 'y', width: 720, height: 1280, byteSize: 57848 }],
    rawMediaToken: 'media:stale',
  },
};

describe('resolveDownloadItemForAttempt', () => {
  test('refreshes a queued media token before attempting the download', async () => {
    const { resolveDownloadItemForAttempt } = await import('../../src/content/media-ref');
    const freshItem: WalkItem = {
      ...queuedItem,
      mediaRef: { ...queuedItem.mediaRef, rawMediaToken: 'media:fresh' },
    };
    const bridge = {
      call: vi.fn().mockResolvedValue(freshItem),
    };

    const item = await resolveDownloadItemForAttempt(bridge, -3745172562, queuedItem);

    expect(bridge.call).toHaveBeenCalledWith(
      'getMessageById',
      { peerId: -3745172562, messageId: 1807 },
      30_000
    );
    expect(item.mediaRef.rawMediaToken).toBe('media:fresh');
  });

  test('falls back to the queued item if refresh cannot return downloadable media', async () => {
    const { resolveDownloadItemForAttempt } = await import('../../src/content/media-ref');
    const bridge = {
      call: vi.fn().mockResolvedValue(null),
    };

    const item = await resolveDownloadItemForAttempt(bridge, -3745172562, queuedItem);

    expect(item).toBe(queuedItem);
  });
});
