export interface TelegramHandles {
  appMessagesManager: any;
  appDownloadManager: any;
  apiFileManager?: any;
  appImManager?: any;
  appPeersManager: any;
  rootScope?: any;
}

const HANDLES = ['appMessagesManager', 'appDownloadManager', 'apiFileManager', 'appImManager', 'appPeersManager'] as const;
const REQUIRED = ['appMessagesManager', 'appDownloadManager', 'appPeersManager'] as const;
type Handle = (typeof HANDLES)[number];

type Candidate = {
  path: string;
  value: any;
};

const DIRECT_HANDLE_PATHS = ['rootScope', ...HANDLES] as const;
const DIRECT_HANDLE_PATH_SET = new Set<string>(DIRECT_HANDLE_PATHS);
const TELEGRAM_CONTAINER_RE = /telegram|tg|app|manager|messages|peers|download|im|rootScope/i;
const MESSAGES_MANAGER_PATH_RE = /(^|\.)appMessagesManager$|(^|\.)messagesManager$|(^|\.)messages$/i;
const DOWNLOAD_MANAGER_PATH_RE = /(^|\.)appDownloadManager$|(^|\.)downloadManager$|(^|\.)download$/i;
const API_FILE_MANAGER_PATH_RE = /(^|\.)apiFileManager$|(^|\.)fileManager$/i;
const IM_MANAGER_PATH_RE = /(^|\.)appImManager$|(^|\.)imManager$|(^|\.)im$/i;
const PEERS_MANAGER_PATH_RE = /(^|\.)appPeersManager$|(^|\.)peersManager$|(^|\.)peers$/i;
const MAX_CHILD_KEYS = 200;
const MAX_CANDIDATES = 1000;
const MAX_SCAN_DEPTH = 3;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

export class BridgeIncompatibleError extends Error {
  override name = 'BridgeIncompatibleError';

  constructor(
    public readonly missing: readonly string[],
    public readonly candidates: readonly string[] = []
  ) {
    super(
      `BRIDGE_INCOMPATIBLE: missing ${missing.join(', ')}${
        candidates.length > 0 ? `; candidates ${candidates.join(', ')}` : ''
      }`
    );
  }
}

export function resolveTelegramHandles(w: any = window): TelegramHandles {
  const candidates = collectCandidates(w);
  const found: TelegramHandles = {
    appMessagesManager: findHandle(candidates, 'appMessagesManager', isMessagesManager),
    appDownloadManager: findHandle(candidates, 'appDownloadManager', isDownloadManager),
    apiFileManager: findHandle(candidates, 'apiFileManager', isApiFileManager),
    appImManager: findHandle(candidates, 'appImManager', isImManager),
    appPeersManager: findHandle(candidates, 'appPeersManager', isPeersManager),
    rootScope: safeRead(w, 'rootScope'),
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
  if (missing.length > 0) throw new BridgeIncompatibleError(missing, describeCompatibleCandidates(candidates));
  return found;
}

function findHandle(
  candidates: readonly Candidate[],
  directPath: Handle,
  isCompatible: (value: any, path: string) => boolean
): any {
  const direct = candidates.find((candidate) => candidate.path === directPath);
  if (direct && isCompatible(direct.value, direct.path)) return direct.value;

  const compatible = candidates
    .filter((candidate) => candidate.path !== directPath && isCompatible(candidate.value, candidate.path))
    .sort((a, b) => scoreHandlePath(directPath, b.path) - scoreHandlePath(directPath, a.path))[0];
  if (compatible) return compatible.value;

  return direct?.value;
}

function scoreHandlePath(handle: Handle, path: string): number {
  if (path === handle || path === `rootScope.managers.${handle}`) return 200;
  if (new RegExp(`(^|\\.)${handle}$`, 'i').test(path)) return 100;

  switch (handle) {
    case 'appMessagesManager':
      return MESSAGES_MANAGER_PATH_RE.test(path) ? 10 : 0;
    case 'appDownloadManager':
      return DOWNLOAD_MANAGER_PATH_RE.test(path) ? 10 : 0;
    case 'apiFileManager':
      return API_FILE_MANAGER_PATH_RE.test(path) ? 10 : 0;
    case 'appImManager':
      return IM_MANAGER_PATH_RE.test(path) ? 10 : 0;
    case 'appPeersManager':
      return PEERS_MANAGER_PATH_RE.test(path) ? 10 : 0;
  }
}

function collectCandidates(w: any): Candidate[] {
  const candidates: Candidate[] = [];
  const seenCandidates = new Set<any>();
  const scanned = new Set<any>();

  const add = (path: string, value: any): boolean => {
    if (!isObjectLike(value) || seenCandidates.has(value) || candidates.length >= MAX_CANDIDATES) return false;
    seenCandidates.add(value);
    candidates.push({ path, value });
    return true;
  };

  const scan = (path: string, value: any, depth: number): void => {
    if (!isObjectLike(value) || candidates.length >= MAX_CANDIDATES) return;

    add(path, value);
    if (depth >= MAX_SCAN_DEPTH || scanned.has(value) || !shouldScanChildren(path, value)) return;

    scanned.add(value);
    for (const childKey of ownKeys(value).slice(0, MAX_CHILD_KEYS)) {
      scan(`${path}.${childKey}`, safeRead(value, childKey), depth + 1);
      if (candidates.length >= MAX_CANDIDATES) return;
    }
  };

  for (const key of DIRECT_HANDLE_PATHS) {
    scan(key, safeRead(w, key), 0);
  }

  for (const key of ownKeys(w)) {
    scan(key, safeRead(w, key), 0);
  }

  return candidates;
}

function shouldScanChildren(path: string, value: any): boolean {
  if (!isObjectLike(value)) return false;
  if (TELEGRAM_CONTAINER_RE.test(path)) return true;

  const proto = safePrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeCompatibleCandidates(candidates: readonly Candidate[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const kinds: string[] = [];
    if (isMessagesManager(candidate.value, candidate.path)) kinds.push('messages');
    if (isDownloadManager(candidate.value, candidate.path)) kinds.push('download');
    if (isApiFileManager(candidate.value, candidate.path)) kinds.push('file');
    if (isImManager(candidate.value, candidate.path)) kinds.push('im');
    if (isPeersManager(candidate.value, candidate.path)) kinds.push('peers');
    if (kinds.length === 0) continue;

    const label = `${candidate.path}:${kinds.join('|')}`;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  const hasNonDirectCandidate = labels.some((label) => !DIRECT_HANDLE_PATH_SET.has(label.split(':')[0] ?? ''));
  return hasNonDirectCandidate ? labels : [];
}

function isMessagesManager(value: any, path = ''): boolean {
  return MESSAGES_MANAGER_PATH_RE.test(path) && typeof value?.getHistory === 'function';
}

function isDownloadManager(value: any, path = ''): boolean {
  return DOWNLOAD_MANAGER_PATH_RE.test(path) && (typeof value?.download === 'function' || typeof value?.downloadToDisc === 'function');
}

function isApiFileManager(value: any, path = ''): boolean {
  return API_FILE_MANAGER_PATH_RE.test(path) && typeof value?.downloadMedia === 'function';
}

function isPeersManager(value: any, path = ''): boolean {
  return PEERS_MANAGER_PATH_RE.test(path) && typeof value?.getPeer === 'function';
}

function isImManager(value: any, path: string): boolean {
  if (!isObjectLike(value)) return false;
  if (IM_MANAGER_PATH_RE.test(path)) return true;

  const peerId = value.chat?.peerId;
  return typeof peerId === 'number' || typeof peerId === 'string' || typeof peerId === 'bigint';
}

function isObjectLike(value: unknown): boolean {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function safeRead(value: any, key: string): any {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function ownKeys(value: any): string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

function safePrototypeOf(value: any): object | null | undefined {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return undefined;
  }
}

export async function waitForTelegramHandles(
  opts: { timeoutMs?: number; intervalMs?: number; w?: any } = {}
): Promise<TelegramHandles> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
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
