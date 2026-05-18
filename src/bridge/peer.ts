import type { PeerId, PeerInfo } from '../shared/types';
import type { TelegramHandles } from './resolve';

export function getCurrentPeer(h: TelegramHandles): PeerInfo | null {
  const peerId = h.appImManager.chat?.peerId as PeerId | undefined;
  if (peerId === undefined || peerId === null) return null;

  const chat = h.appPeersManager.getPeer(peerId);
  if (!chat) return null;

  const title =
    chat.title ??
    (chat.first_name ? `${chat.first_name}${chat.last_name ? ` ${chat.last_name}` : ''}` : null) ??
    String(peerId);

  const type: PeerInfo['type'] = chat._ === 'channel' ? 'channel' : chat._ === 'chat' ? 'chat' : 'user';

  return {
    peerId,
    title,
    username: chat.username ?? null,
    type,
  };
}
