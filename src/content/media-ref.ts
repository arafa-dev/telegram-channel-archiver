import { isMediaDownloadable } from '../shared/quality';
import type { MediaRef, MessageMeta } from '../shared/types';
import type { WalkItem } from './walker';

interface BridgeLike {
  call<T = unknown>(op: 'getMessageById', args?: unknown, timeoutMs?: number): Promise<T>;
}

interface HistoryMessage {
  meta: MessageMeta;
  mediaRef: MediaRef | null;
}

export async function resolveDownloadItemForAttempt(
  bridge: BridgeLike,
  peerId: number,
  item: WalkItem,
  timeoutMs = 30_000
): Promise<WalkItem> {
  const refreshed = await bridge
    .call<HistoryMessage | null>(
      'getMessageById',
      {
        peerId,
        messageId: item.meta.messageId,
      },
      timeoutMs
    )
    .catch(() => null);

  if (!refreshed?.mediaRef || !isMediaDownloadable(refreshed.mediaRef)) return item;
  return { meta: refreshed.meta, mediaRef: refreshed.mediaRef };
}

export function mediaToken(mediaRef: MediaRef): string | null {
  return typeof mediaRef.rawMediaToken === 'string' ? mediaRef.rawMediaToken : null;
}
