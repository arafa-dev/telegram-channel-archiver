import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('sw-client', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(),
        connect: vi.fn(() => ({ name: 'tg-archive-keepalive' })),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('callSw returns successful response values', async () => {
    const { callSw } = await import('../../src/content/sw-client');
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, value: { now: 1 } });

    await expect(callSw({ kind: 'heartbeat' })).resolves.toEqual({ now: 1 });
  });

  test('callSw throws service worker errors and malformed responses', async () => {
    const { callSw } = await import('../../src/content/sw-client');
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: false, error: 'NO_STATE' });
    await expect(callSw({ kind: 'heartbeat' })).rejects.toThrow('NO_STATE');

    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(undefined);
    await expect(callSw({ kind: 'heartbeat' })).rejects.toThrow('SW_FAILED');
  });

  test('openKeepalivePort connects with the expected name', async () => {
    const { openKeepalivePort } = await import('../../src/content/sw-client');

    openKeepalivePort();

    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'tg-archive-keepalive' });
  });
});
