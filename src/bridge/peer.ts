import type { PeerId, PeerInfo } from '../shared/types';
import type { TelegramHandles } from './resolve';

export async function getCurrentPeer(h: TelegramHandles): Promise<PeerInfo | null> {
  const peerId = normalizePeerId(h.appImManager?.chat?.peerId) ?? peerIdFromLocationHash();
  if (peerId === null) return null;

  const chat = await h.appPeersManager.getPeer(peerId);
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

function peerIdFromLocationHash(): PeerId | null {
  const hash = globalThis.location?.hash ?? '';
  const match = /^#(-?\d+)(?:$|[/?])/.exec(hash);
  return normalizePeerId(match?.[1]);
}

function normalizePeerId(value: unknown): PeerId | null {
  if (value === undefined || value === null) return null;
  const peerId = Number(value);
  return Number.isFinite(peerId) ? peerId : null;
}
