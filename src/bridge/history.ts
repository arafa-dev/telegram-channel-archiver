import type { PeerId } from '../shared/types';
import type { TelegramHandles } from './resolve';

export interface HistoryPage {
  messages: any[];
  nextOffsetId: number;
}

export async function getHistory(
  h: TelegramHandles,
  peerId: PeerId,
  offsetId: number,
  limit: number
): Promise<HistoryPage> {
  const result = await h.appMessagesManager.getHistory({ peerId, offsetId, limit });

  let messages: any[];
  if (Array.isArray(result?.messages)) {
    messages = result.messages;
  } else if (Array.isArray(result?.history)) {
    messages = await Promise.all(
      result.history.map((mid: number) => h.appMessagesManager.getMessageByPeer(peerId, mid))
    );
  } else {
    throw new Error('UNEXPECTED_HISTORY_SHAPE');
  }

  const oldest = messages.length > 0 ? messages[messages.length - 1] : null;
  const nextOffsetId = messages.length < limit || !oldest ? 0 : oldest.id;

  return { messages, nextOffsetId };
}
