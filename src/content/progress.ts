import type { WalkPage } from './walker';

export interface PageProgressInput {
  page: WalkPage;
  seenIds: Set<number>;
  currentOffsetId: number;
  interrupted: boolean;
}

export interface PageProgress {
  recordSeen: {
    messageIds: number[];
    skippedIds: number[];
    cursor: { offsetId: number };
  };
  newOffsetId: number;
}

export function planPageProgress(input: PageProgressInput): PageProgress {
  const skippedIds = [...input.page.skippedIds];
  for (const id of skippedIds) input.seenIds.add(id);

  const nextOffsetId = input.interrupted ? input.currentOffsetId : input.page.nextOffsetId;

  return {
    recordSeen: {
      messageIds: skippedIds,
      skippedIds,
      cursor: { offsetId: nextOffsetId },
    },
    newOffsetId: nextOffsetId,
  };
}
