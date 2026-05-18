import { describe, expect, test, vi } from 'vitest';
import { newArchiveState } from '../../src/background/storage';
import type { ArchiveFailure } from '../../src/shared/types';

const downloads = vi.hoisted(() => ({
  downloadTextOverwrite: vi.fn(async () => ({ downloadId: 1, relPath: 'manifest.json' })),
}));

vi.mock('../../src/background/downloads', () => downloads);

describe('manifest writer', () => {
  test('buildManifest produces the versioned sidecar document', async () => {
    const { buildManifest } = await import('../../src/background/manifest-writer');
    const state = newArchiveState({ peerId: 42, title: 'Telegram News', username: 'telegram' });
    state.cursor = { offsetId: 1234 };
    state.counts = { downloaded: 3, skipped: 1, failed: 2 };
    state.status = 'paused';
    const failures: ArchiveFailure[] = [{ messageId: 9, reason: 'FLOOD_WAIT_5', lastTriedAt: '2026-05-18T10:00:00.000Z' }];

    expect(buildManifest(state, failures)).toEqual({
      schemaVersion: 1,
      peerId: 42,
      channel: {
        title: 'Telegram News',
        username: 'telegram',
        archivedAt: state.startedAt,
      },
      progress: {
        status: 'paused',
        cursor: { offsetId: 1234 },
        lastUpdatedAt: state.lastUpdatedAt,
        counts: { downloaded: 3, skipped: 1, failed: 2 },
      },
      failures,
    });
  });

  test('writeManifest overwrites manifest.json as pretty JSON', async () => {
    const { writeManifest } = await import('../../src/background/manifest-writer');
    const state = newArchiveState({ peerId: 42, title: 'Telegram News', username: null });

    await writeManifest(state, []);

    expect(downloads.downloadTextOverwrite).toHaveBeenCalledWith({
      text: expect.stringContaining('\n  "schemaVersion": 1'),
      channelTitle: 'Telegram News',
      peerId: 42,
      filename: 'manifest.json',
      mimeType: 'application/json',
    });
  });
});
