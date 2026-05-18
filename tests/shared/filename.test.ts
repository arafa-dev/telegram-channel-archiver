import { describe, it, expect } from 'vitest';
import { channelSlug, mediaFilename, mimeToExt } from '../../src/shared/filename';

describe('channelSlug', () => {
  it('lowercases, ASCII-folds, hyphenates, caps at 60', () => {
    expect(channelSlug('Example Channel')).toBe('example-channel');
    expect(channelSlug('Crème Brûlée')).toBe('creme-brulee');
    expect(channelSlug('!!!Spaces & Symbols!!!')).toBe('spaces-symbols');
    expect(channelSlug('a'.repeat(200))).toHaveLength(60);
  });

  it('falls back when slug would be empty', () => {
    expect(channelSlug('???')).toBe('channel');
    expect(channelSlug('')).toBe('channel');
  });
});

describe('mediaFilename', () => {
  it('builds YYYY-MM-DD_msgID_kind.ext', () => {
    expect(
      mediaFilename({
        dateUtc: '2024-08-12T09:14:00Z',
        messageId: 18432,
        kind: 'photo',
        mimeType: 'image/jpeg',
      })
    ).toBe('2024-08-12_msg18432_photo.jpg');
  });

  it('handles video', () => {
    expect(
      mediaFilename({
        dateUtc: '2024-08-12T09:14:00Z',
        messageId: 18433,
        kind: 'video',
        mimeType: 'video/mp4',
      })
    ).toBe('2024-08-12_msg18433_video.mp4');
  });

  it('falls back to .bin for unknown MIME', () => {
    expect(
      mediaFilename({
        dateUtc: '2024-01-01T00:00:00Z',
        messageId: 1,
        kind: 'video',
        mimeType: 'application/octet-stream',
      })
    ).toBe('2024-01-01_msg1_video.bin');
  });
});

describe('mimeToExt', () => {
  it('maps known image and video MIME types', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/webp')).toBe('webp');
    expect(mimeToExt('video/mp4')).toBe('mp4');
    expect(mimeToExt('video/quicktime')).toBe('mov');
    expect(mimeToExt('image/gif')).toBe('gif');
  });

  it('returns bin for unknowns', () => {
    expect(mimeToExt('application/x-weird')).toBe('bin');
  });
});
