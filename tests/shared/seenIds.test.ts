import { describe, it, expect } from 'vitest';
import { packSeenIds, unpackSeenIds, addSeenId, hasSeenId } from '../../src/shared/seenIds';

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
