import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('registerBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test('removes an existing dynamic MAIN-world bridge registration', async () => {
    const scripting = {
      getRegisteredContentScripts: vi.fn(async () => [{ id: 'tg-archive-bridge' }]),
      unregisterContentScripts: vi.fn(async () => undefined),
      registerContentScripts: vi.fn(async () => undefined),
    };
    vi.stubGlobal('chrome', { scripting });

    const { registerBridge } = await import('../../src/background/install');

    await registerBridge();

    expect(scripting.getRegisteredContentScripts).toHaveBeenCalledWith({ ids: ['tg-archive-bridge'] });
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['tg-archive-bridge'] });
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  test('ignores failures when checking existing dynamic registrations', async () => {
    const scripting = {
      getRegisteredContentScripts: vi.fn(async () => {
        throw new Error('unavailable');
      }),
      unregisterContentScripts: vi.fn(async () => undefined),
      registerContentScripts: vi.fn(async () => undefined),
    };
    vi.stubGlobal('chrome', { scripting });

    const { registerBridge } = await import('../../src/background/install');

    await registerBridge();

    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });
});
