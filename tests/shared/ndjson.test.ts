import { describe, it, expect } from 'vitest';
import { ndjsonRow, ndjsonAppend } from '../../src/shared/ndjson';
import type { ArchiveItem } from '../../src/shared/types';

const sampleItem: ArchiveItem = {
  messageId: 18432,
  albumGroupedId: null,
  kind: 'photo',
  filename: '2024-08-12_msg18432_photo.jpg',
  mimeType: 'image/jpeg',
  byteSize: 412330,
  dateUtc: '2024-08-12T09:14:00Z',
  fromId: 11223344,
  fromName: 'Alex',
  caption: 'First test post',
  qualityTier: 'y',
  downloadedAt: '2026-05-18T14:23:01Z',
};

describe('ndjsonRow', () => {
  it('serializes an ArchiveItem to a single-line JSON string ending in \\n', () => {
    const row = ndjsonRow(sampleItem);
    expect(row.endsWith('\n')).toBe(true);
    expect(row.split('\n')).toHaveLength(2); // payload + trailing
    expect(JSON.parse(row.trim())).toEqual(sampleItem);
  });

  it('preserves newlines inside captions by encoding them', () => {
    const item = { ...sampleItem, caption: 'line1\nline2' };
    const row = ndjsonRow(item);
    expect(row.split('\n')).toHaveLength(2); // payload + trailing only
    expect(JSON.parse(row.trim()).caption).toBe('line1\nline2');
  });
});

describe('ndjsonAppend', () => {
  it('returns existing + new row, no double newline', () => {
    const existing = ndjsonRow(sampleItem);
    const next = { ...sampleItem, messageId: 18433 };
    const out = ndjsonAppend(existing, next);
    const lines = out.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).messageId).toBe(18433);
  });

  it('appends to empty correctly', () => {
    const out = ndjsonAppend('', sampleItem);
    expect(out.startsWith('{')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });
});
