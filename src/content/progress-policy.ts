export interface PageCursorDecision {
  interrupted: boolean;
  hadFailures: boolean;
  sawSeenDownloadable: boolean;
}

export function shouldAdvancePageCursor(decision: PageCursorDecision): boolean {
  return !decision.interrupted && !decision.hadFailures;
}

export function shouldContinueAfterPage(input: {
  nextOffsetId: number;
  advancedCursor: boolean;
  sawSeenDownloadable: boolean;
}): boolean {
  return input.advancedCursor && input.nextOffsetId !== 0 && !input.sawSeenDownloadable;
}

export function partitionPageItemsForCatchup<T>(
  items: T[],
  isSeenDownloadable: (item: T) => boolean
): { freshCandidates: T[]; releasableItems: T[]; sawSeenDownloadable: boolean } {
  const firstSeenIndex = items.findIndex((item) => isSeenDownloadable(item));
  if (firstSeenIndex < 0) {
    return { freshCandidates: items, releasableItems: [], sawSeenDownloadable: false };
  }

  return {
    freshCandidates: items.slice(0, firstSeenIndex),
    releasableItems: items.slice(firstSeenIndex),
    sawSeenDownloadable: true,
  };
}

export function partitionPageItemsForResume<T>(
  items: T[],
  isSeenDownloadable: (item: T) => boolean
): { freshCandidates: T[]; releasableItems: T[]; sawSeenDownloadable: boolean } {
  return {
    freshCandidates: items,
    releasableItems: items.filter((item) => isSeenDownloadable(item)),
    sawSeenDownloadable: false,
  };
}

export function shouldUseCatchupMode(previousStatus: string | null | undefined, failedCount: number): boolean {
  return previousStatus === 'completed' && failedCount === 0;
}

export type PageStopReason = 'continue' | 'tail' | 'catchup' | 'failure' | 'interrupted';

export function classifyPageStop(input: {
  runActive: boolean;
  advancedCursor: boolean;
  nextOffsetId: number;
  sawSeenDownloadable: boolean;
  hadFailures: boolean;
}): { complete: boolean; reason: PageStopReason } {
  if (!input.runActive) return { complete: false, reason: 'interrupted' };
  if (input.hadFailures) return { complete: false, reason: 'failure' };
  if (input.nextOffsetId === 0) return { complete: true, reason: 'tail' };
  if (!input.advancedCursor) return { complete: false, reason: 'interrupted' };
  if (input.sawSeenDownloadable) return { complete: true, reason: 'catchup' };
  return { complete: false, reason: 'continue' };
}
