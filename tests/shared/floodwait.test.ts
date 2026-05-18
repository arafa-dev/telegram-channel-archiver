import { describe, it, expect } from 'vitest';
import { parseFloodWait, BackoffScheduler } from '../../src/shared/floodwait';

describe('parseFloodWait', () => {
  it('extracts seconds from FLOOD_WAIT_<n>', () => {
    expect(parseFloodWait('FLOOD_WAIT_30')).toBe(30);
    expect(parseFloodWait('FLOOD_WAIT_3600')).toBe(3600);
  });

  it('returns null for non-FLOOD_WAIT errors', () => {
    expect(parseFloodWait('CHAT_FORBIDDEN')).toBeNull();
    expect(parseFloodWait('')).toBeNull();
    expect(parseFloodWait('FLOOD_WAIT')).toBeNull();
  });
});

describe('BackoffScheduler', () => {
  it('starts not delayed', () => {
    const b = new BackoffScheduler({ now: () => 1000 });
    expect(b.delayUntilMs()).toBe(0);
  });

  it('applies a hold for FLOOD_WAIT seconds', () => {
    let t = 1_000_000;
    const b = new BackoffScheduler({ now: () => t });
    b.holdFor(30);
    expect(b.delayUntilMs()).toBe(30000);
    t += 10_000;
    expect(b.delayUntilMs()).toBe(20000);
    t += 25_000;
    expect(b.delayUntilMs()).toBe(0);
  });

  it('exponential backoff caps at 3 retries', () => {
    let t = 0;
    const b = new BackoffScheduler({ now: () => t });
    expect(b.recordTransientFailure()).toBe(true); // retry #1
    expect(b.recordTransientFailure()).toBe(true); // retry #2
    expect(b.recordTransientFailure()).toBe(true); // retry #3
    expect(b.recordTransientFailure()).toBe(false); // exhausted
  });

  it('exponential backoff doubles wait time', () => {
    let t = 0;
    const b = new BackoffScheduler({ now: () => t, baseTransientMs: 1000 });
    b.recordTransientFailure();
    expect(b.delayUntilMs()).toBe(1000);
    t = 1000;
    b.recordTransientFailure();
    expect(b.delayUntilMs()).toBe(2000);
  });

  it('resets retry counter after a success', () => {
    let t = 0;
    const b = new BackoffScheduler({ now: () => t, baseTransientMs: 1000 });
    b.recordTransientFailure();
    b.recordTransientFailure();
    b.recordSuccess();
    expect(b.recordTransientFailure()).toBe(true); // back to retry #1
  });
});
