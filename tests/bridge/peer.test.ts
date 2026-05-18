import { describe, expect, it } from 'vitest';
import { getCurrentPeer } from '../../src/bridge/peer';
import type { TelegramHandles } from '../../src/bridge/resolve';

function handles(chat: unknown, peer: unknown): TelegramHandles {
  return {
    appMessagesManager: {},
    appDownloadManager: {},
    appImManager: { chat },
    appPeersManager: { getPeer: () => peer },
  };
}

describe('getCurrentPeer', () => {
  it('returns null when there is no active peer id', () => {
    expect(getCurrentPeer(handles({}, {}))).toBeNull();
  });

  it('maps Telegram peer metadata to PeerInfo', () => {
    expect(
      getCurrentPeer(
        handles(
          { peerId: 123 },
          {
            _: 'channel',
            title: 'Example Channel',
            username: 'example',
          }
        )
      )
    ).toEqual({ peerId: 123, title: 'Example Channel', username: 'example', type: 'channel' });
  });

  it('falls back to first and last name for users', () => {
    expect(
      getCurrentPeer(handles({ peerId: 456 }, { _: 'user', first_name: 'Ada', last_name: 'Lovelace' }))
    ).toMatchObject({ title: 'Ada Lovelace', username: null, type: 'user' });
  });
});
