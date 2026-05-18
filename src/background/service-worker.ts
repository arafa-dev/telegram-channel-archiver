import { installKeepalive } from './keepalive';
import { downloadBlob } from './downloads';
import { appendFailure, readFailures } from './idb';
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
const FLUSH_EVERY_ITEMS = 50;
const FLUSH_EVERY_MS = 30_000;

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

export const swHandler: SwHandler = async (req, _sender) => {
  log('req', req.kind);
  switch (req.kind) {
    case 'init': {
      return withPeerQueue(req.peerId, async () => {
        let state = await readArchive(req.peerId);
        if (!state) {
          state = newArchiveState({ peerId: req.peerId, title: req.title, username: req.username });
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

    case 'recordItem': {
      const downloadState = await readArchive(req.peerId);
      if (!downloadState) return { ok: false, error: 'NO_STATE' };

      const download = await downloadBlob({
        bytes: req.bytes,
        mimeType: req.mimeType,
        channelTitle: downloadState.title,
        peerId: downloadState.peerId,
        filename: req.item.filename,
      });

      return withPeerQueue(req.peerId, async () => {
        const state = await readArchive(req.peerId);
        if (!state) return { ok: false, error: 'NO_STATE' };
        const finalItem: ArchiveItem = {
          ...req.item,
          filename: download.filename,
          downloadedAt: new Date().toISOString(),
        };

        await appendItem(state, finalItem);
        state.seenIds.add(finalItem.messageId);
        state.counts.downloaded += 1;
        await writeArchive(state);

        const dirty = dirtyFor(req.peerId);
        dirty.itemsSinceFlush += 1;
        await maybeFlush(req.peerId);

        return { ok: true, value: { filename: finalItem.filename } };
      });
    }

    case 'recordFailure': {
      return withPeerQueue(req.peerId, async () => {
        await appendFailure(req.peerId, req.failure);
        const state = await readArchive(req.peerId);
        if (state) {
          state.counts.failed += 1;
          await writeArchive(state);
        }
        await maybeFlush(req.peerId);
        return { ok: true, value: null };
      });
    }

    case 'flushPersist':
      return withPeerQueue(req.peerId, async () => {
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
        await notify(
          `done-${req.peerId}`,
          'Archive complete',
          `${state.title}: ${state.counts.downloaded} downloaded, ${state.counts.failed} failed.`
        );
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
log('service worker booted');
