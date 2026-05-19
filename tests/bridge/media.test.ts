import { describe, expect, it } from 'vitest';
import { extractMediaRef, extractMessage, releaseMediaToken, resolveMediaToken } from '../../src/bridge/media';

describe('extractMessage', () => {
  it('normalizes message metadata and media reference', () => {
    const media = { _: 'messageMediaPhoto', photo: { sizes: [] } };
    const normalized = extractMessage({
        id: 42,
        grouped_id: '1001',
        date: 1_700_000_000,
        from_id: { user_id: 9 },
        message: 'caption',
        media,
      });

    expect(normalized).toEqual({
      meta: {
        messageId: 42,
        albumGroupedId: 1001,
        dateUtc: '2023-11-14T22:13:20.000Z',
        fromId: 9,
        fromName: null,
        caption: 'caption',
      },
      mediaRef: {
        kind: 'photo',
        mimeType: 'image/jpeg',
        fileName: null,
        photoSizes: [],
        rawMediaToken: expect.any(String),
      },
    });
    expect(resolveMediaToken(normalized.mediaRef?.rawMediaToken)).toBe(media);
  });

  it('deletes released media tokens and resolves released tokens with a clear error', () => {
    const media = { _: 'messageMediaPhoto', photo: { sizes: [] } };
    const token = extractMediaRef(media)?.rawMediaToken;

    expect(resolveMediaToken(token)).toBe(media);
    expect(releaseMediaToken(token)).toBe(true);
    expect(() => resolveMediaToken(token)).toThrow('UNKNOWN_MEDIA_TOKEN');
    expect(releaseMediaToken(token)).toBe(false);
  });

  it('throws MALFORMED_MESSAGE for non-object or invalid message identity fields', () => {
    expect(() => extractMessage(null)).toThrow('MALFORMED_MESSAGE');
    expect(() => extractMessage({ id: Number.NaN, date: 1 })).toThrow('MALFORMED_MESSAGE');
    expect(() => extractMessage({ id: 1, date: Number.POSITIVE_INFINITY })).toThrow('MALFORMED_MESSAGE');
  });
});

describe('extractMediaRef', () => {
  it('extracts photo sizes while skipping preview-only sizes', () => {
    expect(
      extractMediaRef({
        _: 'messageMediaPhoto',
        photo: {
          sizes: [
            { _: 'photoSizeStripped', type: 'i' },
            { _: 'photoSize', type: 'm', w: 320, h: 240, size: 1024 },
            { _: 'photoSizeProgressive', type: 'y', w: 1280, h: 960, sizes: [1000, 2000, 1500] },
          ],
        },
      })?.photoSizes
    ).toEqual([
      { type: 'm', width: 320, height: 240, byteSize: 1024 },
      { type: 'y', width: 1280, height: 960, byteSize: 2000 },
    ]);
  });

  it('extracts animated GIF documents as MP4 videos for Telegram Web K downloads', () => {
    const media = {
      _: 'messageMediaDocument',
      document: {
        mime_type: 'image/gif',
        size: 4096,
        attributes: [
          { _: 'documentAttributeVideo', w: 640, h: 360, duration: 12 },
          { _: 'documentAttributeFilename', file_name: 'clip.gif' },
        ],
      },
    };

    const extracted = extractMediaRef(media);

    expect(extracted).toEqual({
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: 'clip.gif',
      videoVariants: [
        {
          width: 640,
          height: 360,
          durationSec: 12,
          byteSize: 4096,
          mimeType: 'video/mp4',
          isStreaming: true,
          isDocumentAttachment: false,
        },
      ],
      rawMediaToken: expect.any(String),
    });
    expect(resolveMediaToken(extracted?.rawMediaToken)).toBe(media);
  });

  it('skips non-media documents', () => {
    expect(
      extractMediaRef({
        _: 'messageMediaDocument',
        document: { mime_type: 'application/pdf', attributes: [{ _: 'documentAttributeFilename' }] },
      })
    ).toBeNull();
  });

  it('returns null for malformed media and malformed nested size or attribute lists', () => {
    expect(extractMediaRef('not media')).toBeNull();
    expect(extractMediaRef({ _: 'messageMediaPhoto', photo: { sizes: 'bad' } })?.photoSizes).toEqual([]);
    expect(
      extractMediaRef({
        _: 'messageMediaDocument',
        document: { mime_type: 'video/mp4', attributes: 'bad' },
      })
    ).toBeNull();
  });
});
