import { installKeepalive } from './keepalive';
import { downloadBlob } from './downloads';
import { writeManifest } from './manifest-writer';
import { appendItem, flushItemsToDisk } from './ndjson-writer';
import { notify } from './notifications';
import { installRouter, type SwHandler } from './router';
import { newArchiveState, readArchive, writeArchive } from './storage';
import type { ArchiveFailure, ArchiveItem } from '../shared/types';

const log = (...args: unknown[]) => console.log('[tg-archive/sw]', ...args);

const failuresByPeer = new Map<number, ArchiveFailure[]>();
const dirtyByPeer = new Map<number, { itemsSinceFlush: number; lastFlushMs: number }>();
const FLUSH_EVERY_ITEMS = 50;
const FLUSH_EVERY_MS = 30_000;

async function maybeFlush(peerId: number, force = false): Promise<void> {
  const state = await readArchive(peerId);
  if (!state) return;

  const dirty = dirtyByPeer.get(peerId) ?? { itemsSinceFlush: 0, lastFlushMs: 0 };
  const due = force || dirty.itemsSinceFlush >= FLUSH_EVERY_ITEMS || Date.now() - dirty.lastFlushMs >= FLUSH_EVERY_MS;
  if (!due) return;

  await flushItemsToDisk(state);
  await writeManifest(state, failuresByPeer.get(peerId) ?? []);
  dirtyByPeer.set(peerId, { itemsSinceFlush: 0, lastFlushMs: Date.now() });
}

export const swHandler: SwHandler = async (req, _sender) => {
  log('req', req.kind);
  switch (req.kind) {
    case 'init': {
      let state = await readArchive(req.peerId);
      if (!state) {
        state = newArchiveState({ peerId: req.peerId, title: req.title, username: req.username });
        await writeArchive(state);
      }
      return { ok: true, value: state };
    }

    case 'getState': {
      const state = await readArchive(req.peerId);
      return { ok: true, value: state };
    }

    case 'recordSeen': {
      const state = await readArchive(req.peerId);
      if (!state) return { ok: false, error: 'NO_STATE' };
      for (const id of req.messageIds) state.seenIds.add(id);
      state.cursor = req.cursor;
      await writeArchive(state);
      return { ok: true, value: null };
    }

    case 'recordItem': {
      const state = await readArchive(req.peerId);
      if (!state) return { ok: false, error: 'NO_STATE' };

      const { relPath } = await downloadBlob({
        bytes: req.bytes,
        mimeType: req.mimeType,
        channelTitle: state.title,
        peerId: state.peerId,
        filename: req.item.filename,
      });
      const finalItem: ArchiveItem = {
        ...req.item,
        // chrome.downloads.download returns an id, not the final uniquified target path.
        // Until we query DownloadItem.filename, persist the requested archive filename.
        filename: relPath.split('/').pop() ?? req.item.filename,
        downloadedAt: new Date().toISOString(),
      };

      await appendItem(state, finalItem);
      state.seenIds.add(finalItem.messageId);
      state.counts.downloaded += 1;
      await writeArchive(state);

      const dirty = dirtyByPeer.get(req.peerId) ?? { itemsSinceFlush: 0, lastFlushMs: 0 };
      dirtyByPeer.set(req.peerId, { ...dirty, itemsSinceFlush: dirty.itemsSinceFlush + 1 });
      await maybeFlush(req.peerId);

      return { ok: true, value: { filename: finalItem.filename } };
    }

    case 'recordFailure': {
      const failures = failuresByPeer.get(req.peerId) ?? [];
      failures.push(req.failure);
      failuresByPeer.set(req.peerId, failures);

      const state = await readArchive(req.peerId);
      if (state) {
        state.counts.failed += 1;
        await writeArchive(state);
      }
      await maybeFlush(req.peerId);
      return { ok: true, value: null };
    }

    case 'flushPersist':
      await maybeFlush(req.peerId, true);
      return { ok: true, value: null };

    case 'complete': {
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
