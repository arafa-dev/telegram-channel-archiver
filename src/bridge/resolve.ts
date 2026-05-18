export interface TelegramHandles {
  appMessagesManager: any;
  appDownloadManager: any;
  appImManager: any;
  appPeersManager: any;
  rootScope?: any;
}

const REQUIRED = ['appMessagesManager', 'appDownloadManager', 'appImManager', 'appPeersManager'] as const;

export class BridgeIncompatibleError extends Error {
  override name = 'BridgeIncompatibleError';

  constructor(missing: readonly string[]) {
    super(`BRIDGE_INCOMPATIBLE: missing ${missing.join(', ')}`);
  }
}

export function resolveTelegramHandles(w: any = window): TelegramHandles {
  const found: TelegramHandles = {
    appMessagesManager: w.appMessagesManager,
    appDownloadManager: w.appDownloadManager,
    appImManager: w.appImManager,
    appPeersManager: w.appPeersManager,
    rootScope: w.rootScope,
  };
  const missing: string[] = [...REQUIRED.filter((key) => !found[key])];
  if (found.appMessagesManager) {
    if (typeof found.appMessagesManager.getHistory !== 'function') missing.push('appMessagesManager.getHistory');
  }
  if (
    found.appDownloadManager &&
    typeof found.appDownloadManager.download !== 'function' &&
    typeof found.appDownloadManager.downloadToDisc !== 'function'
  ) {
    missing.push('appDownloadManager.download|downloadToDisc');
  }
  if (found.appPeersManager && typeof found.appPeersManager.getPeer !== 'function') {
    missing.push('appPeersManager.getPeer');
  }
  if (missing.length > 0) throw new BridgeIncompatibleError(missing);
  return found;
}

export async function waitForTelegramHandles(
  opts: { timeoutMs?: number; intervalMs?: number; w?: any } = {}
): Promise<TelegramHandles> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 250;
  const w = opts.w ?? window;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      return resolveTelegramHandles(w);
    } catch (e) {
      if (!(e instanceof BridgeIncompatibleError)) throw e;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return resolveTelegramHandles(w);
}
