import type { PeerId } from '../shared/types';
import type { TelegramHandles } from './resolve';

export interface HistoryPage {
  messages: any[];
  nextOffsetId: number;
}

const WEBK_PACKED_MESSAGE_ID_OFFSET = 4_294_967_296;

export async function getHistory(
  h: TelegramHandles,
  peerId: PeerId,
  offsetId: number,
  limit: number
): Promise<HistoryPage> {
  const messagesManager = h.appMessagesManager;
  if (!messagesManager) throw new Error('BRIDGE_INCOMPATIBLE: missing appMessagesManager');
  if (typeof messagesManager.getHistory !== 'function') {
    throw new Error('BRIDGE_INCOMPATIBLE: missing appMessagesManager.getHistory');
  }

  const result = await messagesManager.getHistory({ peerId, offsetId, limit });

  let messages: any[];
  let nextOffsetSource: number | null = null;
  if (Array.isArray(result?.messages)) {
    messages = result.messages;
  } else if (Array.isArray(result?.history)) {
    if (typeof messagesManager.getMessageByPeer !== 'function') {
      throw new Error('BRIDGE_INCOMPATIBLE: missing appMessagesManager.getMessageByPeer');
    }
    nextOffsetSource = result.history.length < limit ? 0 : result.history[result.history.length - 1] ?? 0;
    messages = await Promise.all(
      result.history.map((mid: number) => messagesManager.getMessageByPeer(peerId, mid))
    );
  } else {
    throw new Error('UNEXPECTED_HISTORY_SHAPE');
  }

  const oldest = messages.length > 0 ? messages[messages.length - 1] : null;
  const nextOffsetId = nextOffsetSource ?? (messages.length < limit || !oldest ? 0 : oldest.id);

  return { messages, nextOffsetId };
}

export async function getMessageById(h: TelegramHandles, peerId: PeerId, messageId: number): Promise<any | null> {
  const messagesManager = h.appMessagesManager;
  if (!messagesManager) throw new Error('BRIDGE_INCOMPATIBLE: missing appMessagesManager');
  if (typeof messagesManager.getMessageByPeer !== 'function') {
    throw new Error('BRIDGE_INCOMPATIBLE: missing appMessagesManager.getMessageByPeer');
  }

  const candidates = [WEBK_PACKED_MESSAGE_ID_OFFSET + messageId, messageId];
  for (const candidate of candidates) {
    const message = await Promise.resolve(messagesManager.getMessageByPeer(peerId, candidate)).catch(() => null);
    if (message?.id === messageId) return message;
  }

  const page = await getHistory(h, peerId, WEBK_PACKED_MESSAGE_ID_OFFSET + messageId + 1, 200).catch(() => null);
  return page?.messages.find((message) => message?.id === messageId) ?? null;
}
