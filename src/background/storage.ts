import { packSeenIds, unpackSeenIds } from '../shared/seenIds';
import type { ArchiveStatus, Counts, Cursor } from '../shared/types';

export interface ArchiveState {
  peerId: number;
  title: string;
  username: string | null;
  startedAt: string;
  lastUpdatedAt: string;
  cursor: Cursor;
  seenIds: Set<number>;
  counts: Counts;
  status: ArchiveStatus;
}

export interface StoredArchiveState {
  peerId: number;
  title: string;
  username: string | null;
  startedAt: string;
  lastUpdatedAt: string;
  cursor: Cursor;
  seenIds: string;
  counts: Counts;
  status: ArchiveStatus;
}

export const key = (peerId: number) => `archive:${peerId}`;

function unpackArchive(raw: StoredArchiveState): ArchiveState {
  return { ...raw, seenIds: unpackSeenIds(raw.seenIds) };
}

export async function readArchive(peerId: number): Promise<ArchiveState | null> {
  const storageKey = key(peerId);
  const raw = (await chrome.storage.local.get(storageKey))[storageKey] as StoredArchiveState | undefined;
  if (!raw) return null;
  return unpackArchive(raw);
}

export async function writeArchive(state: ArchiveState): Promise<void> {
  const stored: StoredArchiveState = {
    ...state,
    seenIds: packSeenIds(state.seenIds),
    lastUpdatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [key(state.peerId)]: stored });
}

export async function listArchives(): Promise<ArchiveState[]> {
  const all = await chrome.storage.local.get(null);
  const out: ArchiveState[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('archive:')) {
      out.push(unpackArchive(v as StoredArchiveState));
    }
  }
  return out;
}

export function newArchiveState(opts: { peerId: number; title: string; username: string | null }): ArchiveState {
  const now = new Date().toISOString();
  return {
    peerId: opts.peerId,
    title: opts.title,
    username: opts.username,
    startedAt: now,
    lastUpdatedAt: now,
    cursor: { offsetId: 0 },
    seenIds: new Set(),
    counts: { downloaded: 0, skipped: 0, failed: 0 },
    status: 'in_progress',
  };
}
