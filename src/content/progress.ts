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

export interface FinalizePageProgressInput extends Omit<PageProgressInput, 'interrupted'> {
  initiallyInterrupted: boolean;
  drain: () => Promise<void>;
  isInterrupted: () => boolean;
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

export async function finalizePageProgress(input: FinalizePageProgressInput): Promise<PageProgress> {
  if (!input.initiallyInterrupted) await input.drain();

  return planPageProgress({
    page: input.page,
    seenIds: input.seenIds,
    currentOffsetId: input.currentOffsetId,
    interrupted: input.initiallyInterrupted || input.isInterrupted(),
  });
}
