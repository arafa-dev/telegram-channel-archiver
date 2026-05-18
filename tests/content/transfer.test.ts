import { describe, expect, test } from 'vitest';
import type { SwRequest } from '../../src/background/router';
import type { ArchiveItem } from '../../src/shared/types';

const item: ArchiveItem = {
  messageId: 1,
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
  downloadedAt: '2026-05-18T10:00:01.000Z',
};

describe('recordArchiveItemViaTransfer', () => {
  test('sends JSON-safe chunked bytes instead of raw ArrayBuffer', async () => {
    const { recordArchiveItemViaTransfer } = await import('../../src/content/transfer');
    const sent: unknown[] = [];
    const callSw = async <T = unknown>(req: SwRequest): Promise<T> => {
      sent.push(JSON.parse(JSON.stringify(req)));
      return req as T;
    };
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

    await recordArchiveItemViaTransfer(callSw, { peerId: 42, item, blob, mimeType: 'image/jpeg' });

    expect(sent.map((req) => (req as { kind: string }).kind)).toEqual([
      'beginItemTransfer',
      'appendItemTransferChunk',
      'recordItemFromTransfer',
    ]);
    expect(JSON.stringify(sent)).not.toContain('ArrayBuffer');
    expect(sent[1]).toEqual(expect.objectContaining({ data: 'AQID' }));
  });
});
