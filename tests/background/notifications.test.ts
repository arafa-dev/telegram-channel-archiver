import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('background notifications', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test('uses an extension URL for the notification icon', async () => {
    const create = vi.fn(async () => 'notification-id');
    const getURL = vi.fn((path: string) => `chrome-extension://extension-id/${path}`);
    vi.stubGlobal('chrome', {
      notifications: { create },
      runtime: { getURL },
    });

    const { notify } = await import('../../src/background/notifications');

    await expect(notify('done-1', 'Archive complete', 'Done')).resolves.toBe('notification-id');
    expect(getURL).toHaveBeenCalledWith('icons/128.png');
    expect(create).toHaveBeenCalledWith('done-1', {
      type: 'basic',
      iconUrl: 'chrome-extension://extension-id/icons/128.png',
      title: 'Archive complete',
      message: 'Done',
      priority: 1,
    });
  });
});
