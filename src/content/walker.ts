import { isMediaDownloadable } from '../shared/quality';
import type { MediaRef, MessageMeta } from '../shared/types';
import type { BridgeClient } from './bridge-client';

export interface WalkItem {
  meta: MessageMeta;
  mediaRef: MediaRef;
}

export interface WalkPage {
  items: WalkItem[];
  skippedIds: number[];
  nextOffsetId: number;
}

interface HistoryMessage {
  meta: MessageMeta;
  mediaRef: MediaRef | null;
}

interface HistoryPage {
  messages: HistoryMessage[];
  nextOffsetId: number;
}

export async function walkPage(
  bridge: BridgeClient,
  peerId: number,
  offsetId: number,
  limit: number
): Promise<WalkPage> {
  const page = await bridge.call<HistoryPage>('getHistory', { peerId, offsetId, limit });
  const items: WalkItem[] = [];
  const skippedIds: number[] = [];

  for (const message of page.messages) {
    if (!message.mediaRef || !isMediaDownloadable(message.mediaRef)) {
      skippedIds.push(message.meta.messageId);
      continue;
    }

    items.push({ meta: message.meta, mediaRef: message.mediaRef });
  }

  return { items, skippedIds, nextOffsetId: page.nextOffsetId };
}
