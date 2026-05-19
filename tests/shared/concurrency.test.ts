import { describe, expect, test } from 'vitest';
import { clampConcurrency } from '../../src/shared/concurrency';

describe('clampConcurrency', () => {
  test('defaults invalid values to 3 and bounds valid values to 1..6', () => {
    expect(clampConcurrency(undefined)).toBe(3);
    expect(clampConcurrency('not-a-number')).toBe(3);
    expect(clampConcurrency('0')).toBe(1);
    expect(clampConcurrency(9)).toBe(6);
    expect(clampConcurrency('4')).toBe(4);
  });
});
