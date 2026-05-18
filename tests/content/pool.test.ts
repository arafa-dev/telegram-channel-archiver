import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('DownloadPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('runs jobs with bounded concurrency and drains when complete', async () => {
    const { DownloadPool } = await import('../../src/content/pool');
    const pool = new DownloadPool(2);
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const releases: Array<() => void> = [];

    for (const id of [1, 2, 3]) {
      pool.enqueue({
        id,
        run: async () => {
          started += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => releases.push(resolve));
          active -= 1;
        },
      });
    }

    await vi.waitFor(() => expect(started).toBe(2));
    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(started).toBe(3));
    releases.shift()?.();
    releases.shift()?.();
    await pool.drain();

    expect(maxActive).toBe(2);
  });

  test('transient retry budget is per job instead of global', async () => {
    const { DownloadPool } = await import('../../src/content/pool');
    const failures: string[] = [];
    const successes: string[] = [];
    const pool = new DownloadPool(1, { baseTransientMs: 10, maxRetries: 1 });

    pool.enqueue({
      id: 'a',
      run: vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('a'),
      onSuccess: async () => {
        successes.push('a');
      },
      onFailure: async () => {
        failures.push('a');
      },
    });
    pool.enqueue({
      id: 'b',
      run: vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('b'),
      onSuccess: async () => {
        successes.push('b');
      },
      onFailure: async () => {
        failures.push('b');
      },
    });

    await vi.runAllTimersAsync();
    await pool.drain();

    expect(successes.sort()).toEqual(['a', 'b']);
    expect(failures).toEqual([]);
  });

  test('FLOOD_WAIT retries the same job after the requested delay', async () => {
    const { DownloadPool } = await import('../../src/content/pool');
    const pool = new DownloadPool(1);
    const run = vi.fn().mockRejectedValueOnce(new Error('FLOOD_WAIT_2')).mockResolvedValueOnce('ok');
    const success = vi.fn();

    pool.enqueue({ id: 1, run, onSuccess: success });
    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await pool.drain();

    expect(run).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledWith('ok');
  });

  test('clearQueue lets drain resolve after queued work is cancelled', async () => {
    const { DownloadPool } = await import('../../src/content/pool');
    const pool = new DownloadPool(1);
    const releaseFirst: { current: () => void } = { current: () => undefined };

    pool.enqueue({
      id: 'running',
      run: async () => new Promise<void>((resolve) => {
        releaseFirst.current = resolve;
      }),
    });
    pool.enqueue({ id: 'queued', run: async () => undefined });

    await vi.waitFor(() => expect(pool.pendingCount()).toBe(2));
    pool.clearQueue();
    const drained = vi.fn();
    void pool.drain().then(drained);
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).not.toHaveBeenCalled();

    releaseFirst.current();
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toHaveBeenCalled();
  });
});
