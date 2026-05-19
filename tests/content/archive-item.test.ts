import { describe, expect, test } from 'vitest';
import { mediaFilename } from '../../src/shared/filename';
import type { MediaRef, MessageMeta } from '../../src/shared/types';

const meta: MessageMeta = {
  messageId: 18433,
  albumGroupedId: null,
  dateUtc: '2024-08-12T09:14:00.000Z',
  fromId: null,
  fromName: null,
  caption: '',
};

describe('buildArchiveRecord', () => {
  test('uses canonical media MIME for gif-backed Telegram video documents', async () => {
    const { buildArchiveRecord } = await import('../../src/content/archive-item');
    const mediaRef: MediaRef = {
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: null,
      rawMediaToken: 'media:video-doc',
      videoVariants: [
        {
          width: 640,
          height: 480,
          durationSec: 4,
          byteSize: 3,
          mimeType: 'video/mp4',
          isStreaming: true,
          isDocumentAttachment: true,
        },
      ],
    };
    const filename = mediaFilename({
      dateUtc: meta.dateUtc,
      messageId: meta.messageId,
      kind: mediaRef.kind,
      mimeType: mediaRef.mimeType,
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/gif' });

    const record = await buildArchiveRecord(meta, mediaRef, filename, blob);

    expect(record.item.filename).toMatch(/\.mp4$/);
    expect(record.item.mimeType).toBe('video/mp4');
    expect(record.mimeType).toBe('video/mp4');
  });
});
