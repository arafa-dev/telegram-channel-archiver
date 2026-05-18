import { describe, expect, test } from 'vitest';

describe('content progress policy', () => {
  test('does not advance a page cursor when terminal download failures occurred', async () => {
    const { shouldAdvancePageCursor } = await import('../../src/content/progress-policy');

    expect(shouldAdvancePageCursor({ interrupted: false, hadFailures: true, sawSeenDownloadable: false })).toBe(false);
  });

  test('stops catch-up when a page reaches already-seen downloadable media', async () => {
    const { shouldContinueAfterPage } = await import('../../src/content/progress-policy');

    expect(shouldContinueAfterPage({ nextOffsetId: 123, advancedCursor: true, sawSeenDownloadable: true })).toBe(false);
  });

  test('selects only not-seen items before the first seen downloadable for catch-up', async () => {
    const { partitionPageItemsForCatchup } = await import('../../src/content/progress-policy');
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

    const result = partitionPageItemsForCatchup(items, (item) => item.id === 3);

    expect(result.freshCandidates).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.releasableItems).toEqual([{ id: 3 }, { id: 4 }]);
    expect(result.sawSeenDownloadable).toBe(true);
  });
});
