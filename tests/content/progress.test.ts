import { describe, expect, test } from 'vitest';
import type { WalkPage } from '../../src/content/walker';
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

const mediaRef: MediaRef = {
  kind: 'photo',
  mimeType: 'image/jpeg',
  fileName: null,
  rawMediaToken: 'media:1',
  photoSizes: [{ type: 'x', width: 100, height: 100, byteSize: 1 }],
};

function page(): WalkPage {
  return {
    items: [
      { meta: meta(1), mediaRef },
      { meta: meta(2), mediaRef },
      { meta: meta(3), mediaRef },
    ],
    skippedIds: [4, 5],
    nextOffsetId: 99,
  };
}

describe('planPageProgress', () => {
  test('does not mark fresh media seen when a page is fully accepted for download', async () => {
    const { planPageProgress } = await import('../../src/content/progress');

    const result = planPageProgress({
      page: page(),
      seenIds: new Set([1]),
      currentOffsetId: 0,
      interrupted: false,
    });

    expect(result.recordSeen).toEqual({
      messageIds: [4, 5],
      skippedIds: [4, 5],
      cursor: { offsetId: 99 },
    });
    expect(result.newOffsetId).toBe(99);
  });

  test('keeps cursor at current offset when cancellation interrupts page enqueue', async () => {
    const { planPageProgress } = await import('../../src/content/progress');

    const result = planPageProgress({
      page: page(),
      seenIds: new Set([1]),
      currentOffsetId: 0,
      interrupted: true,
    });

    expect(result.recordSeen).toEqual({
      messageIds: [4, 5],
      skippedIds: [4, 5],
      cursor: { offsetId: 0 },
    });
    expect(result.newOffsetId).toBe(0);
  });

  test('rechecks interruption after drain before allowing cursor advancement', async () => {
    const { finalizePageProgress } = await import('../../src/content/progress');
    let interrupted = false;

    const result = await finalizePageProgress({
      page: page(),
      seenIds: new Set([1]),
      currentOffsetId: 0,
      initiallyInterrupted: false,
      drain: async () => {
        interrupted = true;
      },
      isInterrupted: () => interrupted,
    });

    expect(result.recordSeen).toEqual({
      messageIds: [4, 5],
      skippedIds: [4, 5],
      cursor: { offsetId: 0 },
    });
    expect(result.newOffsetId).toBe(0);
  });
});
