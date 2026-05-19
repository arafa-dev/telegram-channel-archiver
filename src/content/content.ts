import { mediaFilename } from '../shared/filename';
import { clampConcurrency } from '../shared/concurrency';
import { pickPhotoSize, pickVideoVariant } from '../shared/quality';
import { unpackSeenIds } from '../shared/seenIds';
import type { ArchiveFailure, ArchiveItem, Counts, MediaRef, MessageMeta, PeerInfo } from '../shared/types';
import { BridgeClient } from './bridge-client';
import { LifecycleWatcher } from './lifecycle';
import { DownloadPool } from './pool';
import { finalizePageProgress } from './progress';
import { classifyPageStop, partitionPageItemsForCatchup, shouldAdvancePageCursor } from './progress-policy';
import { clearRunGlobalsIfCurrent } from './run-resources';
import { callSw, openKeepalivePort } from './sw-client';
import { recordArchiveItemViaTransfer } from './transfer';
import { Panel, type PanelView } from './ui/panel';
import { walkPage, type WalkItem } from './walker';

const PAGE_LIMIT = 100;

type ArchiveStateDto = {
  peerId: number;
  title: string;
  username: string | null;
  cursor: { offsetId: number };
  counts: Counts;
  status: string;
  seenIdsPacked: string;
};

const bridge = new BridgeClient();
const panel = new Panel({ onStart, onPause, onResume, onCancel });
const watcher = new LifecycleWatcher();

let view: PanelView = {
  title: 'No channel open',
  status: 'idle',
  found: 0,
  downloaded: 0,
  failed: 0,
  bandwidthBps: 0,
  etaSec: null,
};
let currentPeer: PeerInfo | null = null;
let activePeerId: number | null = null;
let pool: DownloadPool | null = null;
let keepalivePort: chrome.runtime.Port | null = null;
let cancelled = false;
let paused = false;
let activeRunId = 0;
let pauseResolvers: Array<() => void> = [];
let bytesWindow: Array<{ t: number; bytes: number }> = [];

panel.update(view);
void boot();

async function boot(): Promise<void> {
  try {
    await bridge.ready();
  } catch {
    setView({ status: 'error', error: 'Telegram Web K bridge failed to load.' });
    return;
  }

  await refreshPeer();
  watcher.onChange(() => {
    const peerId = activePeerId;
    void handlePeerChange(peerId);
  });
  void watcher.start(async () => {
    const peer = await bridge.call<PeerInfo | null>('getCurrentPeer').catch(() => currentPeer);
    return peer?.peerId ?? null;
  });
}

async function refreshPeer(): Promise<PeerInfo | null> {
  const peer = await bridge.call<PeerInfo | null>('getCurrentPeer').catch(() => null);
  currentPeer = peer;
  setView({ title: peer?.title ?? 'No channel open', status: peer ? view.status : 'idle' });
  return peer;
}

async function readConcurrency(): Promise<number> {
  const { concurrency } = await chrome.storage.local.get('concurrency').catch(() => ({ concurrency: undefined }));
  return clampConcurrency(concurrency);
}

async function onStart(): Promise<void> {
  if (view.status === 'paused') {
    onResume();
    return;
  }

  const peer = currentPeer ?? (await refreshPeer());
  if (!peer) return;
  if (peer.type !== 'channel') {
    setView({ status: 'error', error: "This isn't a channel." });
    return;
  }

  cancelled = false;
  paused = false;
  activeRunId += 1;
  const runId = activeRunId;
  activePeerId = peer.peerId;
  bytesWindow = [];
  setView({
    title: peer.title,
    status: 'walking',
    found: 0,
    downloaded: 0,
    failed: 0,
    bandwidthBps: 0,
    etaSec: null,
    error: undefined,
  });

  const runKeepalivePort = openKeepalivePort();
  const runPool = new DownloadPool(await readConcurrency());
  const runTokens = new Set<string>();
  keepalivePort = runKeepalivePort;
  pool = runPool;

  try {
    await callSw<ArchiveStateDto>({ kind: 'init', peerId: peer.peerId, title: peer.title, username: peer.username });
    const state = await callSw<ArchiveStateDto | null>({ kind: 'getState', peerId: peer.peerId });
    if (!state) throw new Error('NO_STATE');

    const seenIds = unpackSeenIds(state.seenIdsPacked);
    let offsetId = state.cursor.offsetId;
    let reachedCompletionBoundary = false;
    let stoppedByFailure = false;

    while (isRunActive(peer.peerId, runId)) {
      await waitIfPaused();
      if (!isRunActive(peer.peerId, runId)) break;

      const page = await walkPage(bridge, peer.peerId, offsetId, PAGE_LIMIT);
      const partition = partitionPageItemsForCatchup(page.items, (item) => seenIds.has(item.meta.messageId));
      const fresh = partition.freshCandidates.filter((item) => !seenIds.has(item.meta.messageId));
      const sawSeenDownloadable = partition.sawSeenDownloadable;
      await releaseMediaRefs([...partition.releasableItems.map((item) => item.mediaRef), ...page.skippedMediaRefs]);

      if (fresh.length > 0) setView({ found: view.found + fresh.length, status: 'downloading' });

      const acceptedFreshIds: number[] = [];
      let pageHadFailure = false;
      for (const item of fresh) {
        await waitIfPaused();
        if (!isRunActive(peer.peerId, runId)) break;
        enqueueDownload(runPool, peer.peerId, runId, item, runTokens, () => {
          pageHadFailure = true;
        });
        acceptedFreshIds.push(item.meta.messageId);
      }

      const initiallyInterrupted = !isRunActive(peer.peerId, runId) || acceptedFreshIds.length < fresh.length;
      const progress = await finalizePageProgress({
        page,
        seenIds,
        currentOffsetId: offsetId,
        initiallyInterrupted,
        drain: () => runPool.drain(),
        isInterrupted: () =>
          !shouldAdvancePageCursor({
            interrupted: !isRunActive(peer.peerId, runId),
            hadFailures: pageHadFailure,
            sawSeenDownloadable,
          }),
      });
      await callSw({
        kind: 'recordSeen',
        peerId: peer.peerId,
        ...progress.recordSeen,
      });

      const advancedCursor = progress.newOffsetId !== offsetId;
      const stop = classifyPageStop({
        runActive: isRunActive(peer.peerId, runId),
        advancedCursor,
        nextOffsetId: progress.newOffsetId,
        sawSeenDownloadable,
        hadFailures: pageHadFailure,
      });
      reachedCompletionBoundary = stop.complete;
      stoppedByFailure = stop.reason === 'failure';
      if (stop.reason !== 'continue') {
        break;
      }
      offsetId = progress.newOffsetId;
      if (fresh.length === 0) setView({ status: 'walking' });
    }

    await runPool.drain();
    if (isRunActive(peer.peerId, runId) && reachedCompletionBoundary) {
      await callSw({ kind: 'complete', peerId: peer.peerId });
      setView({ status: 'completed' });
    } else if (isRunActive(peer.peerId, runId) && stoppedByFailure) {
      await callSw({ kind: 'flushPersist', peerId: peer.peerId, status: 'error' }).catch(() => undefined);
      setView({ status: 'error', error: 'Archive stopped after failed downloads. Retry this channel to continue.' });
    }
  } catch (e: unknown) {
    if (isRunActive(peer.peerId, runId)) {
      await callSw({ kind: 'flushPersist', peerId: peer.peerId, status: 'error' }).catch(() => undefined);
      setView({ status: 'error', error: errorMessage(e) });
    }
  } finally {
    await releaseTokens(runTokens);
    disconnectPort(runKeepalivePort);
    const nextGlobals = clearRunGlobalsIfCurrent(
      { activeRunId, pool, keepalivePort },
      { runId, pool: runPool, keepalivePort: runKeepalivePort }
    );
    pool = nextGlobals.pool;
    keepalivePort = nextGlobals.keepalivePort;
    if (activePeerId === peer.peerId && activeRunId === runId) activePeerId = null;
  }
}

function enqueueDownload(
  runPool: DownloadPool,
  peerId: number,
  runId: number,
  item: WalkItem,
  runTokens: Set<string>,
  onTerminalFailure: () => void
): void {
  const token = mediaToken(item.mediaRef);
  if (token) runTokens.add(token);
  runPool.enqueue({
    id: item.meta.messageId,
    run: async () => {
      const filename = mediaFilename({
        dateUtc: item.meta.dateUtc,
        messageId: item.meta.messageId,
        kind: item.mediaRef.kind,
        mimeType: item.mediaRef.mimeType,
      });
      const result = await bridge.call<{ blob: Blob }>('downloadMedia', {
        rawMediaToken: item.mediaRef.rawMediaToken,
        fileName: filename,
        requestId: item.meta.messageId,
      });
      return { blob: result.blob, filename };
    },
    onSuccess: async ({ blob, filename }) => {
      if (!isRunActive(peerId, runId)) return;
      const archiveItem = await buildArchiveItem(item.meta, item.mediaRef, filename, blob);
      if (!isRunActive(peerId, runId)) return;
      await recordArchiveItemViaTransfer(callSw, {
        peerId,
        item: archiveItem,
        blob,
        mimeType: blob.type || item.mediaRef.mimeType,
      });
      if (!isRunActive(peerId, runId)) return;
      await releaseMediaRef(item.mediaRef);
      if (token) runTokens.delete(token);
      bumpBandwidth(blob.size);
      setView({ downloaded: view.downloaded + 1 });
    },
    onFailure: async (e) => {
      onTerminalFailure();
      if (!isRunActive(peerId, runId)) return;
      const failure: ArchiveFailure = {
        messageId: item.meta.messageId,
        reason: e.message,
        lastTriedAt: new Date().toISOString(),
      };
      await callSw({ kind: 'recordFailure', peerId, failure });
      await releaseMediaRef(item.mediaRef);
      if (token) runTokens.delete(token);
      if (isRunActive(peerId, runId)) setView({ failed: view.failed + 1 });
    },
  });
}

async function buildArchiveItem(meta: MessageMeta, mediaRef: MediaRef, filename: string, blob: Blob): Promise<ArchiveItem> {
  return {
    ...meta,
    kind: mediaRef.kind,
    filename,
    mimeType: blob.type || mediaRef.mimeType,
    byteSize: blob.size,
    qualityTier: qualityTier(mediaRef),
    downloadedAt: new Date().toISOString(),
  };
}

function qualityTier(mediaRef: MediaRef): string {
  if (mediaRef.kind === 'photo') return pickPhotoSize(mediaRef.photoSizes ?? [])?.type ?? 'photo';

  const variant = pickVideoVariant(mediaRef.videoVariants ?? []);
  if (!variant) return 'video';
  const size = variant.width > 0 && variant.height > 0 ? `${variant.width}x${variant.height}` : 'unknown';
  return `video:${size}`;
}

function onPause(): void {
  paused = true;
  pool?.pause();
  setView({ status: 'paused' });
}

function onResume(): void {
  paused = false;
  pauseResolvers.splice(0).forEach((resolve) => resolve());
  pool?.resume();
  setView({ status: 'downloading', error: undefined });
}

async function onCancel(): Promise<void> {
  cancelled = true;
  activeRunId += 1;
  paused = false;
  pauseResolvers.splice(0).forEach((resolve) => resolve());
  pool?.clearQueue();
  const peerId = activePeerId ?? currentPeer?.peerId;
  if (peerId !== undefined && peerId !== null) await callSw({ kind: 'flushPersist', peerId, status: 'paused' }).catch(() => undefined);
  if (keepalivePort) disconnectPort(keepalivePort);
  keepalivePort = null;
  activePeerId = null;
  setView({ status: 'idle' });
}

async function handlePeerChange(peerId: number | null): Promise<void> {
  cancelled = true;
  activeRunId += 1;
  paused = false;
  pauseResolvers.splice(0).forEach((resolve) => resolve());
  pool?.clearQueue();
  const wasIdle = activePeerId === null && pool === null && keepalivePort === null;
  if (peerId !== null) await callSw({ kind: 'flushPersist', peerId }).catch(() => undefined);
  if (keepalivePort) disconnectPort(keepalivePort);
  keepalivePort = null;
  pool = null;
  await refreshPeer();
  if (wasIdle) return;
  setView({ status: 'idle', error: 'Archive stopped because the channel changed.' });
}

function setView(patch: Partial<PanelView>): void {
  view = { ...view, ...patch };
  panel.update(view);
}

function bumpBandwidth(bytes: number): void {
  const now = Date.now();
  bytesWindow.push({ t: now, bytes });
  const cutoff = now - 30_000;
  bytesWindow = bytesWindow.filter((entry) => entry.t >= cutoff);
  const totalBytes = bytesWindow.reduce((sum, entry) => sum + entry.bytes, 0);
  setView({ bandwidthBps: Math.round(totalBytes / 30) });
}

async function waitIfPaused(): Promise<void> {
  while (paused && !cancelled) {
    await new Promise<void>((resolve) => pauseResolvers.push(resolve));
  }
}

function isRunActive(peerId: number, runId: number): boolean {
  return !cancelled && activePeerId === peerId && activeRunId === runId;
}

function disconnectPort(port: chrome.runtime.Port): void {
  try {
    port.disconnect();
  } catch {
    // A port may already be disconnected by a cancel path.
  }
}

function mediaToken(mediaRef: MediaRef): string | null {
  return typeof mediaRef.rawMediaToken === 'string' ? mediaRef.rawMediaToken : null;
}

async function releaseMediaRef(mediaRef: MediaRef): Promise<void> {
  const token = mediaToken(mediaRef);
  if (!token) return;
  await bridge.call('releaseMediaToken', { rawMediaToken: token }).catch(() => undefined);
}

async function releaseMediaRefs(mediaRefs: MediaRef[]): Promise<void> {
  await Promise.all(mediaRefs.map((mediaRef) => releaseMediaRef(mediaRef)));
}

async function releaseTokens(tokens: Set<string>): Promise<void> {
  const pending = [...tokens];
  tokens.clear();
  await Promise.all(pending.map((rawMediaToken) => bridge.call('releaseMediaToken', { rawMediaToken }).catch(() => undefined)));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
