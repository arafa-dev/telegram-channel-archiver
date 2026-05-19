import { describe, expect, it, vi } from 'vitest';
import { BridgeIncompatibleError, resolveTelegramHandles, waitForTelegramHandles } from '../../src/bridge/resolve';

describe('resolveTelegramHandles', () => {
  it('returns required Telegram manager handles and optional rootScope', () => {
    const w = {
      appMessagesManager: { getHistory: () => undefined },
      appDownloadManager: { download: () => undefined },
      apiFileManager: { downloadMedia: () => undefined },
      appImManager: {},
      appPeersManager: { getPeer: () => undefined },
      rootScope: {},
    };

    expect(resolveTelegramHandles(w)).toEqual(w);
  });

  it('resolves compatible managers exposed through alternate Telegram containers', () => {
    const appMessagesManager = { getHistory: () => undefined };
    const appDownloadManager = { downloadToDisc: () => undefined };
    const apiFileManager = { downloadMedia: () => undefined };
    const appImManager = { chat: { peerId: 123 } };
    const appPeersManager = { getPeer: () => undefined };
    const rootScope = {};
    const w = {
      rootScope,
      telegramManagers: {
        messages: appMessagesManager,
        download: appDownloadManager,
        fileManager: apiFileManager,
        im: appImManager,
        peers: appPeersManager,
      },
    };

    expect(resolveTelegramHandles(w)).toEqual({
      appMessagesManager,
      appDownloadManager,
      apiFileManager,
      appImManager,
      appPeersManager,
      rootScope,
    });
  });

  it('resolves managers from Telegram Web K rootScope.managers', () => {
    const appMessagesManager = { getHistory: () => undefined };
    const appDownloadManager = { downloadToDisc: () => undefined };
    const apiFileManager = { downloadMedia: () => undefined };
    const appImManager = { chat: { peerId: 123 } };
    const appPeersManager = { getPeer: () => undefined };
    const rootScope = {
      managers: {
        appMessagesManager,
        appDownloadManager,
        apiFileManager,
        appImManager,
        appPeersManager,
      },
    };

    expect(resolveTelegramHandles({ rootScope })).toEqual({
      appMessagesManager,
      appDownloadManager,
      apiFileManager,
      appImManager,
      appPeersManager,
      rootScope,
    });
  });

  it('does not require appImManager when history, download, and peer managers are ready', () => {
    const w = {
      appDownloadManager: { download: () => undefined },
      rootScope: {
        managers: {
          appMessagesManager: { getHistory: () => undefined },
          appPeersManager: { getPeer: () => undefined },
          acknowledged: {
            chat: { peerId: {} },
          },
        },
      },
    };

    expect(resolveTelegramHandles(w)).toMatchObject({
      appMessagesManager: w.rootScope.managers.appMessagesManager,
      appDownloadManager: w.appDownloadManager,
      appPeersManager: w.rootScope.managers.appPeersManager,
      appImManager: undefined,
    });
  });

  it('prefers message-named history candidates over unrelated getHistory objects', () => {
    const unrelatedHistoryObject = { getHistory: () => ({ messages: [] }) };
    const appMessagesManager = { getHistory: () => ({ messages: [{ id: 1 }] }) };
    const w = {
      unrelatedHistoryObject,
      telegramManagers: {
        messages: appMessagesManager,
        download: { download: () => undefined },
        im: { chat: { peerId: 123 } },
        peers: { getPeer: () => undefined },
      },
    };

    expect(resolveTelegramHandles(w).appMessagesManager).toBe(appMessagesManager);
  });

  it('prefers exact rootScope manager paths over acknowledged placeholders', () => {
    const appMessagesManager = { getHistory: () => ({ messages: [{ id: 1 }] }) };
    const appPeersManager = { getPeer: () => ({ _: 'channel', title: 'real' }) };
    const managers = {
      acknowledged: {
        appMessagesManager: { getHistory: () => ({ messages: [] }) },
        appPeersManager: { getPeer: () => null },
      },
      appMessagesManager,
      appPeersManager,
    };
    const w = {
      appDownloadManager: { download: () => undefined, managers },
      appImManager: { chat: { peerId: -1 } },
      rootScope: {
        managers,
      },
    };

    expect(resolveTelegramHandles(w)).toMatchObject({
      appMessagesManager,
      appPeersManager,
    });
  });

  it('does not resolve message or peer managers from generic Telegram helper proxies', () => {
    const w = {
      appDownloadManager: { download: () => undefined },
      appImManager: { chat: { peerId: -1 } },
      apiManagerProxy: {
        getHistory: () => ({ messages: [] }),
        getPeer: () => ({ _: 'channel' }),
      },
      rootScope: {
        managers: {
          getHistory: { getHistory: () => ({ messages: [] }) },
          getPeer: { getPeer: () => ({ _: 'channel' }) },
        },
      },
    };

    expect(() => resolveTelegramHandles(w)).toThrow(/missing appMessagesManager, appPeersManager/);
  });

  it('includes compatible candidate paths in incompatible errors', () => {
    expect(() =>
      resolveTelegramHandles({
        appMessagesManager: { getHistory: () => undefined },
        telegramManagers: {
          peers: { getPeer: () => undefined },
        },
      })
    ).toThrow(/candidates .*appMessagesManager.*telegramManagers\.peers/);
  });

  it('throws BridgeIncompatibleError listing missing required handles', () => {
    expect(() =>
      resolveTelegramHandles({
        appMessagesManager: { getHistory: () => undefined, getMessageByPeer: () => undefined },
        appImManager: {},
      })
    ).toThrow(
      new BridgeIncompatibleError(['appDownloadManager', 'appPeersManager'])
    );
  });

  it('throws BridgeIncompatibleError listing missing manager capabilities', () => {
    expect(() =>
      resolveTelegramHandles({
        appMessagesManager: { getHistory: () => undefined },
        appDownloadManager: {},
        appImManager: {},
        appPeersManager: {},
      })
    ).toThrow(
      new BridgeIncompatibleError([
        'appDownloadManager.download|downloadToDisc',
        'appPeersManager.getPeer',
      ])
    );
  });
});

describe('waitForTelegramHandles', () => {
  it('waits until required handles become available', async () => {
    vi.useFakeTimers();
    const w: Record<string, unknown> = {};

    const promise = waitForTelegramHandles({ timeoutMs: 1000, intervalMs: 50, w });
    await vi.advanceTimersByTimeAsync(50);
    Object.assign(w, {
      appMessagesManager: { getHistory: () => undefined },
      appDownloadManager: { downloadToDisc: () => undefined },
      appPeersManager: { getPeer: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).resolves.toMatchObject(w);
    vi.useRealTimers();
  });

  it('uses a long default timeout for slow Telegram Web K startup', async () => {
    vi.useFakeTimers();
    const w: Record<string, unknown> = {};

    const promise = waitForTelegramHandles({ intervalMs: 50, w });
    let rejected: unknown;
    promise.catch((e) => {
      rejected = e;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rejected).toBeUndefined();

    Object.assign(w, {
      appMessagesManager: { getHistory: () => undefined },
      appDownloadManager: { downloadToDisc: () => undefined },
      appPeersManager: { getPeer: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).resolves.toMatchObject(w);
    vi.useRealTimers();
  });
});
