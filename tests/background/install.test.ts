import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('registerBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test('replaces an existing MAIN-world bridge registration', async () => {
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
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: 'tg-archive-bridge',
        js: ['bridge/bridge.js'],
        matches: ['https://web.telegram.org/k/*'],
        runAt: 'document_start',
        world: 'MAIN',
        persistAcrossSessions: true,
      },
    ]);
  });

  test('still registers when checking existing scripts fails', async () => {
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
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  });
});
