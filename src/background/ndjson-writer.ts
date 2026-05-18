import { ndjsonAppend } from '../shared/ndjson';
import type { ArchiveItem } from '../shared/types';
import { downloadTextOverwrite } from './downloads';
import { readNdjson, writeNdjson } from './idb';
import type { ArchiveState } from './storage';

export async function appendItem(state: ArchiveState, item: ArchiveItem): Promise<void> {
  const existing = await readNdjson(state.peerId);
  await writeNdjson(state.peerId, ndjsonAppend(existing, item));
}

export async function flushItemsToDisk(state: ArchiveState): Promise<void> {
  const text = await readNdjson(state.peerId);
  await downloadTextOverwrite({
    text,
    channelTitle: state.title,
    peerId: state.peerId,
    filename: 'items.ndjson',
    mimeType: 'application/json',
  });
}
