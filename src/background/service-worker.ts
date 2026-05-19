import { installKeepalive } from './keepalive';
import { registerBridge } from './install';
import { downloadBlob } from './downloads';
import { appendFailure, readFailures, removeFailuresByMessageId } from './idb';
import { writeManifest } from './manifest-writer';
import { appendItem, flushItemsToDisk } from './ndjson-writer';
import { notify } from './notifications';
import { installRouter, type SwHandler } from './router';
import { newArchiveState, readArchive, writeArchive, type ArchiveState } from './storage';
import { packSeenIds } from '../shared/seenIds';
import type { ArchiveItem } from '../shared/types';

const log = (...args: unknown[]) => console.log('[tg-archive/sw]', ...args);

const dirtyByPeer = new Map<number, { itemsSinceFlush: number; lastFlushMs: number }>();
const peerQueues = new Map<number, Promise<unknown>>();
const itemTransfers = new Map<
  string,
  {
    peerId: number;
    item: ArchiveItem;
    mimeType: string;
    totalBytes: number;
    chunks: Map<number, Uint8Array>;
    receivedBytes: number;
    ttlTimer: ReturnType<typeof setTimeout>;
  }
>();
const FLUSH_EVERY_ITEMS = 50;
const FLUSH_EVERY_MS = 30_000;
const ITEM_TRANSFER_MAX_BASE64_CHUNK_CHARS = 72 * 1024;
const ITEM_TRANSFER_MAX_BYTES = 512 * 1024 * 1024;
const ITEM_TRANSFER_MAX_ACTIVE = 8;
const ITEM_TRANSFER_TTL_MS = 5 * 60 * 1000;

type ArchiveStateDto = Omit<ArchiveState, 'seenIds'> & { seenIdsPacked: string };

function toArchiveStateDto(state: ArchiveState): ArchiveStateDto {
  return {
    peerId: state.peerId,
    title: state.title,
    username: state.username,
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    cursor: state.cursor,
    counts: state.counts,
    status: state.status,
    seenIdsPacked: packSeenIds(state.seenIds),
  };
}

function initialDirty(): { itemsSinceFlush: number; lastFlushMs: number } {
  return { itemsSinceFlush: 0, lastFlushMs: Date.now() };
}

function dirtyFor(peerId: number): { itemsSinceFlush: number; lastFlushMs: number } {
  const dirty = dirtyByPeer.get(peerId) ?? initialDirty();
  dirtyByPeer.set(peerId, dirty);
  return dirty;
}

async function withPeerQueue<T>(peerId: number, fn: () => Promise<T>): Promise<T> {
  const previous = peerQueues.get(peerId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const queued = run.catch(() => undefined);
  peerQueues.set(peerId, queued);

  try {
    return await run;
  } finally {
    if (peerQueues.get(peerId) === queued) peerQueues.delete(peerId);
  }
}

async function maybeFlush(peerId: number, force = false): Promise<void> {
  const state = await readArchive(peerId);
  if (!state) return;

  const dirty = dirtyFor(peerId);
  const due = force || dirty.itemsSinceFlush >= FLUSH_EVERY_ITEMS || Date.now() - dirty.lastFlushMs >= FLUSH_EVERY_MS;
  if (!due) return;

  await flushItemsToDisk(state);
  await writeManifest(state, await readFailures(peerId));
  dirtyByPeer.set(peerId, { itemsSinceFlush: 0, lastFlushMs: Date.now() });
}

async function recordDownloadedItem(peerId: number, item: ArchiveItem, bytes: ArrayBuffer, mimeType: string) {
  const downloadState = await readArchive(peerId);
  if (!downloadState) return { ok: false as const, error: 'NO_STATE' };

  const download = await downloadBlob({
    bytes,
    mimeType,
    channelTitle: downloadState.title,
    peerId: downloadState.peerId,
    filename: item.filename,
  });

  return withPeerQueue(peerId, async () => {
    const state = await readArchive(peerId);
    if (!state) return { ok: false as const, error: 'NO_STATE' };
    const finalItem: ArchiveItem = {
      ...item,
      filename: download.filename,
      downloadedAt: new Date().toISOString(),
    };

    await appendItem(state, finalItem);
    state.seenIds.add(finalItem.messageId);
    state.counts.downloaded += 1;
    const removedFailures = await removeFailuresByMessageId(peerId, finalItem.messageId);
    if (removedFailures > 0) state.counts.failed = Math.max(0, state.counts.failed - removedFailures);
    await writeArchive(state);

    const dirty = dirtyFor(peerId);
    dirty.itemsSinceFlush += 1;
    await maybeFlush(peerId);

    return { ok: true as const, value: { filename: finalItem.filename } };
  });
}

function deleteItemTransfer(transferId: string): void {
  const transfer = itemTransfers.get(transferId);
  if (!transfer) return;
  clearTimeout(transfer.ttlTimer);
  itemTransfers.delete(transferId);
}

function base64ToBytes(data: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(data, 'base64'));
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function reconstructTransferBytes(transferId: string): ArrayBuffer {
  const transfer = itemTransfers.get(transferId);
  if (!transfer) throw new Error('UNKNOWN_TRANSFER');
  const ordered = [...transfer.chunks.entries()].sort(([a], [b]) => a - b);
  const bytes = new Uint8Array(transfer.totalBytes);
  let offset = 0;
  for (let expected = 0; expected < ordered.length; expected++) {
    const [index, chunk] = ordered[expected]!;
    if (index !== expected) throw new Error('TRANSFER_CHUNK_GAP');
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== transfer.totalBytes) throw new Error('TRANSFER_INCOMPLETE');
  return bytes.buffer;
}

export const swHandler: SwHandler = async (req, _sender) => {
  log('req', req.kind);
  switch (req.kind) {
    case 'init': {
      return withPeerQueue(req.peerId, async () => {
        let state = await readArchive(req.peerId);
        if (!state) {
          state = newArchiveState({ peerId: req.peerId, title: req.title, username: req.username });
          await writeArchive(state);
        } else if (state.status !== 'in_progress') {
          state.status = 'in_progress';
          await writeArchive(state);
        }
        return { ok: true, value: toArchiveStateDto(state) };
      });
    }

    case 'getState': {
      const state = await readArchive(req.peerId);
      return { ok: true, value: state ? toArchiveStateDto(state) : null };
    }

    case 'recordSeen': {
      return withPeerQueue(req.peerId, async () => {
        const state = await readArchive(req.peerId);
        if (!state) return { ok: false, error: 'NO_STATE' };
        const alreadySeen = new Set(state.seenIds);
        for (const id of req.messageIds) {
          state.seenIds.add(id);
        }
        for (const id of new Set(req.skippedIds ?? [])) {
          state.seenIds.add(id);
          if (!alreadySeen.has(id)) state.counts.skipped += 1;
        }
        state.cursor = req.cursor;
        await writeArchive(state);
        return { ok: true, value: null };
      });
    }

    case 'beginItemTransfer': {
      if (itemTransfers.has(req.transferId)) return { ok: false, error: 'TRANSFER_EXISTS' };
      if (req.totalBytes > ITEM_TRANSFER_MAX_BYTES) return { ok: false, error: 'TRANSFER_TOO_LARGE' };
      if (itemTransfers.size >= ITEM_TRANSFER_MAX_ACTIVE) return { ok: false, error: 'TOO_MANY_TRANSFERS' };
      itemTransfers.set(req.transferId, {
        peerId: req.peerId,
        item: req.item,
        mimeType: req.mimeType,
        totalBytes: req.totalBytes,
        chunks: new Map(),
        receivedBytes: 0,
        ttlTimer: setTimeout(() => {
          itemTransfers.delete(req.transferId);
        }, ITEM_TRANSFER_TTL_MS),
      });
      return { ok: true, value: null };
    }

    case 'appendItemTransferChunk': {
      const transfer = itemTransfers.get(req.transferId);
      if (!transfer) return { ok: false, error: 'UNKNOWN_TRANSFER' };
      if (req.data.length > ITEM_TRANSFER_MAX_BASE64_CHUNK_CHARS) {
        deleteItemTransfer(req.transferId);
        return { ok: false, error: 'CHUNK_TOO_LARGE' };
      }
      const chunk = base64ToBytes(req.data);
      if (transfer.receivedBytes + chunk.byteLength > transfer.totalBytes) {
        deleteItemTransfer(req.transferId);
        return { ok: false, error: 'TRANSFER_TOO_LARGE' };
      }
      transfer.chunks.set(req.index, chunk);
      transfer.receivedBytes += chunk.byteLength;
      return { ok: true, value: null };
    }

    case 'recordItemFromTransfer': {
      const transfer = itemTransfers.get(req.transferId);
      if (!transfer) return { ok: false, error: 'UNKNOWN_TRANSFER' };
      try {
        const bytes = reconstructTransferBytes(req.transferId);
        deleteItemTransfer(req.transferId);
        return recordDownloadedItem(transfer.peerId, transfer.item, bytes, transfer.mimeType);
      } catch (e) {
        deleteItemTransfer(req.transferId);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'abortItemTransfer': {
      deleteItemTransfer(req.transferId);
      return { ok: true, value: null };
    }

    case 'recordFailure': {
      return withPeerQueue(req.peerId, async () => {
        const added = await appendFailure(req.peerId, req.failure);
        const state = await readArchive(req.peerId);
        if (state) {
          if (added) state.counts.failed += 1;
          await writeArchive(state);
        }
        await maybeFlush(req.peerId);
        return { ok: true, value: null };
      });
    }

    case 'getFailures':
      return { ok: true, value: await readFailures(req.peerId) };

    case 'clearFailure':
      return withPeerQueue(req.peerId, async () => {
        const removedFailures = await removeFailuresByMessageId(req.peerId, req.messageId);
        const state = await readArchive(req.peerId);
        if (state && removedFailures > 0) {
          state.counts.failed = Math.max(0, state.counts.failed - removedFailures);
          await writeArchive(state);
        }
        return { ok: true, value: { removed: removedFailures } };
      });

    case 'flushPersist':
      return withPeerQueue(req.peerId, async () => {
        if (req.status) {
          const state = await readArchive(req.peerId);
          if (state) {
            state.status = req.status;
            await writeArchive(state);
          }
        }
        await maybeFlush(req.peerId, true);
        return { ok: true, value: null };
      });

    case 'complete': {
      return withPeerQueue(req.peerId, async () => {
        const state = await readArchive(req.peerId);
        if (!state) return { ok: false, error: 'NO_STATE' };
        state.status = 'completed';
        await writeArchive(state);
        await maybeFlush(req.peerId, true);
        await Promise.resolve(
          notify(
            `done-${req.peerId}`,
            'Archive complete',
            `${state.title}: ${state.counts.downloaded} downloaded, ${state.counts.failed} failed.`
          )
        ).catch((e: unknown) => {
          log('notification failed', e instanceof Error ? e.message : String(e));
        });
        return { ok: true, value: null };
      });
    }

    case 'heartbeat':
      return { ok: true, value: { now: Date.now() } };

    case 'getPeerProgress': {
      const state = await readArchive(req.peerId);
      return {
        ok: true,
        value: state ? { counts: state.counts, status: state.status, cursor: state.cursor } : null,
      };
    }
  }
};

installKeepalive();
installRouter(swHandler);
chrome.runtime.onInstalled.addListener(() => {
  registerBridge().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  registerBridge().catch(console.error);
});
log('service worker booted');
