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
