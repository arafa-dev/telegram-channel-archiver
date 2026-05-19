import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when there is no active peer id', () => {
    return expect(getCurrentPeer(handles({}, {}))).resolves.toBeNull();
  });

  it('maps Telegram peer metadata to PeerInfo', () => {
    return expect(
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
    ).resolves.toEqual({ peerId: 123, title: 'Example Channel', username: 'example', type: 'channel' });
  });

  it('awaits async Telegram peer manager proxies', () => {
    return expect(
      getCurrentPeer({
        appMessagesManager: {},
        appDownloadManager: {},
        appImManager: { chat: { peerId: -3942659786 } },
        appPeersManager: {
          getPeer: async () => ({ _: 'channel', id: 3942659786, title: 'highclass neeek' }),
        },
      })
    ).resolves.toEqual({
      peerId: -3942659786,
      title: 'highclass neeek',
      username: null,
      type: 'channel',
    });
  });

  it('falls back to the Telegram Web K hash when appImManager has no active chat', () => {
    vi.stubGlobal('location', { hash: '#-3942659786' });

    return expect(
      getCurrentPeer({
        appMessagesManager: {},
        appDownloadManager: {},
        appImManager: undefined,
        appPeersManager: {
          getPeer: async (peerId: number) => ({ _: 'channel', id: Math.abs(peerId), title: 'highclass neeek' }),
        },
      })
    ).resolves.toEqual({
      peerId: -3942659786,
      title: 'highclass neeek',
      username: null,
      type: 'channel',
    });
  });

  it('falls back to first and last name for users', () => {
    return expect(
      getCurrentPeer(handles({ peerId: 456 }, { _: 'user', first_name: 'Ada', last_name: 'Lovelace' }))
    ).resolves.toMatchObject({ title: 'Ada Lovelace', username: null, type: 'user' });
  });
});
