import { describe, expect, it, vi } from 'vitest';
import { BridgeIncompatibleError, resolveTelegramHandles, waitForTelegramHandles } from '../../src/bridge/resolve';

describe('resolveTelegramHandles', () => {
  it('returns required Telegram manager handles and optional rootScope', () => {
    const w = {
      appMessagesManager: { getHistory: () => undefined, getMessageByPeer: () => undefined },
      appDownloadManager: { download: () => undefined },
      appImManager: {},
      appPeersManager: { getPeer: () => undefined },
      rootScope: {},
    };

    expect(resolveTelegramHandles(w)).toEqual(w);
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
        'appMessagesManager.getMessageByPeer',
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
      appMessagesManager: { getHistory: () => undefined, getMessageByPeer: () => undefined },
      appDownloadManager: { downloadToDisc: () => undefined },
      appImManager: {},
      appPeersManager: { getPeer: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).resolves.toMatchObject(w);
    vi.useRealTimers();
  });
});
