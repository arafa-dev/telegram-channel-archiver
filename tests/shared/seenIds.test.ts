import { describe, it, expect } from 'vitest';
import { packSeenIds, unpackSeenIds, addSeenId, hasSeenId, __seenIdsInternals } from '../../src/shared/seenIds';

describe('seenIds codec', () => {
  it('round-trips an empty set', () => {
    const packed = packSeenIds(new Set<number>());
    expect(unpackSeenIds(packed)).toEqual(new Set());
  });

  it('round-trips a populated set', () => {
    const ids = new Set([1, 42, 18432, 18433, 999999]);
    const packed = packSeenIds(ids);
    expect(unpackSeenIds(packed)).toEqual(ids);
  });

  it('produces compact base64url output (no padding, urlsafe)', () => {
    const packed = packSeenIds(new Set([1, 2, 3]));
    expect(packed).not.toContain('=');
    expect(packed).not.toContain('+');
    expect(packed).not.toContain('/');
  });

  it('uses explicit little-endian uint32 wire format', () => {
    expect(packSeenIds(new Set([1]))).toBe('AQAAAA');
    expect(packSeenIds(new Set([0x12345678]))).toBe('eFY0Eg');
  });

  it('rejects invalid ids before packing', () => {
    expect(() => packSeenIds(new Set([-1]))).toThrow(/Invalid seen id/);
    expect(() => packSeenIds(new Set([1.5]))).toThrow(/Invalid seen id/);
    expect(() => packSeenIds(new Set([Number.NaN]))).toThrow(/Invalid seen id/);
    expect(() => packSeenIds(new Set([0x1_0000_0000]))).toThrow(/Invalid seen id/);
  });

  it('rejects corrupt packed data whose decoded byte length is not divisible by 4', () => {
    expect(() => unpackSeenIds('AA')).toThrow(/Corrupt seen ids/);
  });

  it('covers the browser binary-string base64url fallback path', () => {
    const bytes = __seenIdsInternals.idsToBytes(new Set([1, 0x12345678]));
    const packed = __seenIdsInternals.base64UrlEncodeBinaryString(bytes);

    expect(packed).toBe('AQAAAHhWNBI');
    expect(__seenIdsInternals.bytesToIds(__seenIdsInternals.base64UrlDecodeBinaryString(packed))).toEqual(
      new Set([1, 0x12345678])
    );
  });

  it('addSeenId is idempotent', () => {
    const ids = new Set([1]);
    addSeenId(ids, 1);
    expect(ids.size).toBe(1);
    addSeenId(ids, 2);
    expect(ids.size).toBe(2);
  });

  it('hasSeenId works on a Set', () => {
    const ids = new Set([1, 2, 3]);
    expect(hasSeenId(ids, 2)).toBe(true);
    expect(hasSeenId(ids, 4)).toBe(false);
  });
});
