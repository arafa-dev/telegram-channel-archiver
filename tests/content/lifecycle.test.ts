import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('LifecycleWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { href: 'https://web.telegram.org/k/#peer' });
    vi.stubGlobal('window', {
      setInterval,
      clearInterval,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('polls a live async peer source and fires once when the peer id changes', async () => {
    const { LifecycleWatcher } = await import('../../src/content/lifecycle');
    let peerId = 10;
    const getCurrentPeerId = vi.fn(async () => peerId);
    const onChange = vi.fn();
    const watcher = new LifecycleWatcher();

    await watcher.start(getCurrentPeerId);
    watcher.onChange(onChange);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onChange).not.toHaveBeenCalled();

    peerId = 11;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.stop();
  });
});
