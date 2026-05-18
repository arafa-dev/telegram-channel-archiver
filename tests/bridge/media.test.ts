import { describe, expect, it } from 'vitest';
import { extractMediaRef, extractMessage } from '../../src/bridge/media';

describe('extractMessage', () => {
  it('normalizes message metadata and media reference', () => {
    expect(
      extractMessage({
        id: 42,
        grouped_id: '1001',
        date: 1_700_000_000,
        from_id: { user_id: 9 },
        message: 'caption',
        media: { _: 'messageMediaPhoto', photo: { sizes: [] } },
      })
    ).toEqual({
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
        rawMediaToken: { _: 'messageMediaPhoto', photo: { sizes: [] } },
      },
    });
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

  it('extracts streamable video documents preserving Telegram mime type', () => {
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

    expect(extractMediaRef(media)).toEqual({
      kind: 'video',
      mimeType: 'image/gif',
      fileName: 'clip.gif',
      videoVariants: [
        {
          width: 640,
          height: 360,
          durationSec: 12,
          byteSize: 4096,
          mimeType: 'image/gif',
          isStreaming: true,
          isDocumentAttachment: false,
        },
      ],
      rawMediaToken: media,
    });
  });

  it('skips non-media documents', () => {
    expect(
      extractMediaRef({
        _: 'messageMediaDocument',
        document: { mime_type: 'application/pdf', attributes: [{ _: 'documentAttributeFilename' }] },
      })
    ).toBeNull();
  });
});
