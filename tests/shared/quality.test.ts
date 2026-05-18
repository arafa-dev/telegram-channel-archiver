import { describe, it, expect } from 'vitest';
import { pickPhotoSize, pickVideoVariant, isMediaDownloadable } from '../../src/shared/quality';
import type { MediaRef } from '../../src/shared/types';

describe('pickPhotoSize', () => {
  it('picks the largest sized variant', () => {
    const sizes = [
      { type: 's', width: 320, height: 240, byteSize: 10000 },
      { type: 'y', width: 1280, height: 960, byteSize: 200000 },
      { type: 'x', width: 800, height: 600, byteSize: 80000 },
    ];
    expect(pickPhotoSize(sizes)?.type).toBe('y');
  });

  it('returns null when no sizes are present', () => {
    expect(pickPhotoSize([])).toBeNull();
  });

  it('ignores stripped/cached sizes (negative width)', () => {
    const sizes = [
      { type: 'i', width: -1, height: -1, byteSize: 200 },
      { type: 'x', width: 800, height: 600, byteSize: 80000 },
    ];
    expect(pickPhotoSize(sizes)?.type).toBe('x');
  });
});

describe('pickVideoVariant', () => {
  it('prefers streaming variant over document attachment', () => {
    const variants = [
      {
        width: 1920,
        height: 1080,
        durationSec: 60,
        byteSize: 50000000,
        mimeType: 'video/mp4',
        isStreaming: true,
        isDocumentAttachment: false,
      },
      {
        width: 3840,
        height: 2160,
        durationSec: 60,
        byteSize: 200000000,
        mimeType: 'video/mp4',
        isStreaming: false,
        isDocumentAttachment: true,
      },
    ];
    expect(pickVideoVariant(variants)?.width).toBe(1920);
  });

  it('returns null if only document attachments exist (per spec policy)', () => {
    const variants = [
      {
        width: 3840,
        height: 2160,
        durationSec: 60,
        byteSize: 200000000,
        mimeType: 'video/mp4',
        isStreaming: false,
        isDocumentAttachment: true,
      },
    ];
    expect(pickVideoVariant(variants)).toBeNull();
  });

  it('among streaming variants, picks the highest resolution', () => {
    const variants = [
      {
        width: 640,
        height: 480,
        durationSec: 60,
        byteSize: 5_000_000,
        mimeType: 'video/mp4',
        isStreaming: true,
        isDocumentAttachment: false,
      },
      {
        width: 1920,
        height: 1080,
        durationSec: 60,
        byteSize: 50_000_000,
        mimeType: 'video/mp4',
        isStreaming: true,
        isDocumentAttachment: false,
      },
    ];
    expect(pickVideoVariant(variants)?.width).toBe(1920);
  });
});

describe('isMediaDownloadable', () => {
  it('returns true for photo with sizes', () => {
    const ref: MediaRef = {
      kind: 'photo',
      mimeType: 'image/jpeg',
      fileName: null,
      photoSizes: [{ type: 'x', width: 800, height: 600, byteSize: 1 }],
      rawMediaToken: null,
    };
    expect(isMediaDownloadable(ref)).toBe(true);
  });

  it('returns false for video with only document attachments', () => {
    const ref: MediaRef = {
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: null,
      videoVariants: [
        {
          width: 3840,
          height: 2160,
          durationSec: 60,
          byteSize: 1,
          mimeType: 'video/mp4',
          isStreaming: false,
          isDocumentAttachment: true,
        },
      ],
      rawMediaToken: null,
    };
    expect(isMediaDownloadable(ref)).toBe(false);
  });
});
