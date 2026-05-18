import { mediaFilename } from '../shared/filename';
import { pickPhotoSize, pickVideoVariant } from '../shared/quality';
import { unpackSeenIds } from '../shared/seenIds';
import type { ArchiveFailure, ArchiveItem, Counts, MediaRef, MessageMeta, PeerInfo } from '../shared/types';
import { BridgeClient } from './bridge-client';
import { LifecycleWatcher } from './lifecycle';
import { DownloadPool } from './pool';
import { callSw, openKeepalivePort } from './sw-client';
import { Panel, type PanelView } from './ui/panel';
import { walkPage, type WalkItem } from './walker';

const PAGE_LIMIT = 100;
const CONCURRENCY = 3;

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
  watcher.start(() => currentPeer?.peerId ?? null);
}

async function refreshPeer(): Promise<PeerInfo | null> {
  const peer = await bridge.call<PeerInfo | null>('getCurrentPeer').catch(() => null);
  currentPeer = peer;
  setView({ title: peer?.title ?? 'No channel open', status: peer ? view.status : 'idle' });
  return peer;
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

  keepalivePort = openKeepalivePort();

  try {
    await callSw<ArchiveStateDto>({ kind: 'init', peerId: peer.peerId, title: peer.title, username: peer.username });
    const state = await callSw<ArchiveStateDto | null>({ kind: 'getState', peerId: peer.peerId });
    if (!state) throw new Error('NO_STATE');

    const seenIds = unpackSeenIds(state.seenIdsPacked);
    let offsetId = state.cursor.offsetId;
    pool = new DownloadPool(CONCURRENCY);

    while (!cancelled && activePeerId === peer.peerId) {
      await waitIfPaused();
      if (cancelled || activePeerId !== peer.peerId) break;

      const page = await walkPage(bridge, peer.peerId, offsetId, PAGE_LIMIT);
      const fresh = page.items.filter((item) => !seenIds.has(item.meta.messageId));
      const downloadableIds = page.items.map((item) => item.meta.messageId);
      const allSeenIds = [...page.skippedIds, ...downloadableIds];

      for (const id of allSeenIds) seenIds.add(id);
      if (fresh.length > 0) setView({ found: view.found + fresh.length, status: 'downloading' });

      for (const item of fresh) {
        await waitIfPaused();
        if (cancelled || activePeerId !== peer.peerId) break;
        enqueueDownload(peer.peerId, item);
      }

      await callSw({
        kind: 'recordSeen',
        peerId: peer.peerId,
        messageIds: allSeenIds,
        skippedIds: page.skippedIds,
        cursor: { offsetId: page.nextOffsetId },
      });

      if (page.nextOffsetId === 0) break;
      offsetId = page.nextOffsetId;
      if (fresh.length === 0) setView({ status: 'walking' });
    }

    await pool.drain();
    if (!cancelled && activePeerId === peer.peerId) {
      await callSw({ kind: 'complete', peerId: peer.peerId });
      setView({ status: 'completed' });
    }
  } catch (e: unknown) {
    if (!cancelled) setView({ status: 'error', error: errorMessage(e) });
  } finally {
    keepalivePort?.disconnect();
    keepalivePort = null;
    pool = null;
    if (activePeerId === peer.peerId) activePeerId = null;
  }
}

function enqueueDownload(peerId: number, item: WalkItem): void {
  pool?.enqueue({
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
      if (cancelled || activePeerId !== peerId) return;
      const archiveItem = await buildArchiveItem(item.meta, item.mediaRef, filename, blob);
      await callSw({
        kind: 'recordItem',
        peerId,
        item: archiveItem,
        bytes: await blob.arrayBuffer(),
        mimeType: blob.type || item.mediaRef.mimeType,
      });
      if (cancelled || activePeerId !== peerId) return;
      bumpBandwidth(blob.size);
      setView({ downloaded: view.downloaded + 1 });
    },
    onFailure: async (e) => {
      if (cancelled || activePeerId !== peerId) return;
      const failure: ArchiveFailure = {
        messageId: item.meta.messageId,
        reason: e.message,
        lastTriedAt: new Date().toISOString(),
      };
      await callSw({ kind: 'recordFailure', peerId, failure });
      if (!cancelled && activePeerId === peerId) setView({ failed: view.failed + 1 });
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
  paused = false;
  pauseResolvers.splice(0).forEach((resolve) => resolve());
  pool?.clearQueue();
  const peerId = activePeerId ?? currentPeer?.peerId;
  if (peerId !== undefined && peerId !== null) await callSw({ kind: 'flushPersist', peerId }).catch(() => undefined);
  keepalivePort?.disconnect();
  keepalivePort = null;
  activePeerId = null;
  setView({ status: 'idle' });
}

async function handlePeerChange(peerId: number | null): Promise<void> {
  cancelled = true;
  paused = false;
  pauseResolvers.splice(0).forEach((resolve) => resolve());
  pool?.clearQueue();
  if (peerId !== null) await callSw({ kind: 'flushPersist', peerId }).catch(() => undefined);
  await refreshPeer();
  if (pool) setView({ status: 'paused', error: 'Archive paused because the channel changed.' });
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
