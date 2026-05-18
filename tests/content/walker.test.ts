import { describe, expect, test, vi } from 'vitest';
import type { BridgeClient } from '../../src/content/bridge-client';
import type { MediaRef, MessageMeta } from '../../src/shared/types';

function meta(messageId: number): MessageMeta {
  return {
    messageId,
    albumGroupedId: null,
    dateUtc: '2026-05-18T10:00:00.000Z',
    fromId: null,
    fromName: null,
    caption: '',
  };
}

const downloadablePhoto: MediaRef = {
  kind: 'photo',
  mimeType: 'image/jpeg',
  fileName: null,
  rawMediaToken: 'media:1',
  photoSizes: [{ type: 'x', width: 100, height: 100, byteSize: 10 }],
};

const emptyPhoto: MediaRef = {
  kind: 'photo',
  mimeType: 'image/jpeg',
  fileName: null,
  rawMediaToken: 'media:2',
  photoSizes: [],
};

describe('walkPage', () => {
  test('returns downloadable items and skipped ids for no-media or non-downloadable messages', async () => {
    const { walkPage } = await import('../../src/content/walker');
    const bridge = {
      call: vi.fn(async () => ({
        messages: [
          { meta: meta(1), mediaRef: downloadablePhoto },
          { meta: meta(2), mediaRef: null },
          { meta: meta(3), mediaRef: emptyPhoto },
        ],
        nextOffsetId: 44,
      })),
    } as unknown as BridgeClient;

    const page = await walkPage(bridge, 42, 0, 100);

    expect(bridge.call).toHaveBeenCalledWith('getHistory', { peerId: 42, offsetId: 0, limit: 100 });
    expect(page).toEqual({
      items: [{ meta: meta(1), mediaRef: downloadablePhoto }],
      skippedIds: [2, 3],
      skippedMediaRefs: [emptyPhoto],
      nextOffsetId: 44,
    });
  });
});
