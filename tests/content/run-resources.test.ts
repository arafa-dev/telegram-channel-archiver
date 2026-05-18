import { describe, expect, test, vi } from 'vitest';

describe('clearRunGlobalsIfCurrent', () => {
  test('stale run cleanup leaves newer global resources intact', async () => {
    const { clearRunGlobalsIfCurrent } = await import('../../src/content/run-resources');
    const oldPool = { id: 'old-pool' };
    const oldPort = { disconnect: vi.fn() };
    const newPool = { id: 'new-pool' };
    const newPort = { disconnect: vi.fn() };
    const globals = {
      activeRunId: 2,
      pool: newPool,
      keepalivePort: newPort,
    };

    const result = clearRunGlobalsIfCurrent(globals, {
      runId: 1,
      pool: oldPool,
      keepalivePort: oldPort,
    });

    expect(result.pool).toBe(newPool);
    expect(result.keepalivePort).toBe(newPort);
    expect(newPort.disconnect).not.toHaveBeenCalled();
  });
});
