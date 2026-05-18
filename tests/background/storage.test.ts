import { packSeenIds } from '../../src/shared/seenIds';
import { key, listArchives, newArchiveState, readArchive, writeArchive } from '../../src/background/storage';

const storage = new Map<string, unknown>();

function installChromeStorageMock() {
  const local = {
    get: vi.fn(async (query: string | string[] | Record<string, unknown> | null) => {
      if (query === null) return Object.fromEntries(storage);
      if (typeof query === 'string') return { [query]: storage.get(query) };
      if (Array.isArray(query)) return Object.fromEntries(query.map((k) => [k, storage.get(k)]));
      return Object.fromEntries(Object.keys(query).map((k) => [k, storage.get(k) ?? query[k]]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) storage.set(k, v);
    }),
  };

  vi.stubGlobal('chrome', { storage: { local } });
  return local;
}

describe('background storage helpers', () => {
  beforeEach(() => {
    storage.clear();
    installChromeStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  test('writeArchive and readArchive round-trip packed seen ids', async () => {
    const state = newArchiveState({ peerId: 42, title: 'Telegram News', username: 'telegram' });
    state.seenIds = new Set([100, 200, 300]);

    await writeArchive(state);

    expect(storage.get(key(42))).toMatchObject({
      peerId: 42,
      seenIds: packSeenIds(new Set([100, 200, 300])),
    });
    const read = await readArchive(42);
    expect(read?.seenIds).toEqual(new Set([100, 200, 300]));
  });

  test('listArchives returns only archive keys', async () => {
    const first = newArchiveState({ peerId: 1, title: 'First', username: null });
    const second = newArchiveState({ peerId: 2, title: 'Second', username: 'second' });
    await writeArchive(first);
    await writeArchive(second);
    storage.set('not-an-archive', { peerId: 99 });

    const archives = await listArchives();

    expect(archives.map((archive) => archive.peerId).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  test('writeArchive updates lastUpdatedAt in stored state', async () => {
    const state = newArchiveState({ peerId: 5, title: 'Updates', username: null });
    state.lastUpdatedAt = '2020-01-01T00:00:00.000Z';
    const before = Date.now();

    await writeArchive(state);

    const stored = storage.get(key(5)) as { lastUpdatedAt: string };
    const after = Date.now();
    expect(stored.lastUpdatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(Date.parse(stored.lastUpdatedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(stored.lastUpdatedAt)).toBeLessThanOrEqual(after);
  });
});
