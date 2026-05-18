import type { ArchiveFailure } from '../shared/types';
import { downloadTextOverwrite } from './downloads';
import type { ArchiveState } from './storage';

export interface ManifestDoc {
  schemaVersion: 1;
  peerId: number;
  channel: {
    title: string;
    username: string | null;
    archivedAt: string;
  };
  progress: {
    status: ArchiveState['status'];
    cursor: ArchiveState['cursor'];
    lastUpdatedAt: string;
    counts: ArchiveState['counts'];
  };
  failures: ArchiveFailure[];
}

export function buildManifest(state: ArchiveState, failures: ArchiveFailure[]): ManifestDoc {
  return {
    schemaVersion: 1,
    peerId: state.peerId,
    channel: {
      title: state.title,
      username: state.username,
      archivedAt: state.startedAt,
    },
    progress: {
      status: state.status,
      cursor: state.cursor,
      lastUpdatedAt: state.lastUpdatedAt,
      counts: state.counts,
    },
    failures,
  };
}

export async function writeManifest(state: ArchiveState, failures: ArchiveFailure[]): Promise<void> {
  await downloadTextOverwrite({
    text: JSON.stringify(buildManifest(state, failures), null, 2),
    channelTitle: state.title,
    peerId: state.peerId,
    filename: 'manifest.json',
    mimeType: 'application/json',
  });
}
