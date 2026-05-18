import { key, newArchiveState } from '../../src/background/storage';

describe('background storage helpers', () => {
  test('key namespaces archives by peer id', () => {
    expect(key(12345)).toBe('archive:12345');
  });

  test('newArchiveState initializes an in-progress archive', () => {
    const before = Date.now();
    const state = newArchiveState({ peerId: 42, title: 'Telegram News', username: 'telegram' });
    const after = Date.now();

    expect(state).toMatchObject({
      peerId: 42,
      title: 'Telegram News',
      username: 'telegram',
      cursor: { offsetId: 0 },
      counts: { downloaded: 0, skipped: 0, failed: 0 },
      status: 'in_progress',
    });
    expect(state.seenIds).toEqual(new Set());
    expect(Date.parse(state.startedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(state.startedAt)).toBeLessThanOrEqual(after);
    expect(state.lastUpdatedAt).toBe(state.startedAt);
  });
});
