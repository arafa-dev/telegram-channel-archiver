import { describe, expect, it, vi } from 'vitest';
import { handleBridgeReq } from '../../src/bridge/handler';
import { extractMediaRef, resolveMediaToken } from '../../src/bridge/media';
import type { ReqEnvelope } from '../../src/shared/envelope';
import type { TelegramHandles } from '../../src/bridge/resolve';

function req(args: unknown): ReqEnvelope {
  return { source: 'tg-archive', kind: 'req', id: 1, op: 'downloadMedia', args };
}

function handles(appDownloadManager: unknown): TelegramHandles {
  return {
    appMessagesManager: { getHistory: () => undefined },
    appDownloadManager,
    appImManager: {},
    appPeersManager: { getPeer: () => undefined },
  };
}

describe('handleBridgeReq downloadMedia token lifecycle', () => {
  it('responds to ping after Telegram handles are resolved', async () => {
    await expect(
      handleBridgeReq(
        { source: 'tg-archive', kind: 'req', id: 1, op: 'ping' },
        handles({ download: vi.fn() }),
        vi.fn()
      )
    ).resolves.toEqual({ ready: true });
  });

  it('keeps the media token after transient download failure so retry can reuse it', async () => {
    const media = { _: 'messageMediaPhoto', photo: { sizes: [] } };
    const token = extractMediaRef(media)?.rawMediaToken;
    const blob = new Blob(['ok']);
    const download = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(blob);

    await expect(
      handleBridgeReq(
        req({ rawMediaToken: token, fileName: 'a.jpg', requestId: 1 }),
        handles({ download }),
        vi.fn()
      )
    ).rejects.toThrow('DOWNLOAD_UNAVAILABLE');

    await expect(
      handleBridgeReq(
        req({ rawMediaToken: token, fileName: 'a.jpg', requestId: 1 }),
        handles({ download }),
        vi.fn()
      )
    ).resolves.toEqual({ blob });

    expect(resolveMediaToken(token)).toBe(media);
  });

  it('releases the media token only through the explicit release op', async () => {
    const media = { _: 'messageMediaPhoto', photo: { sizes: [] } };
    const token = extractMediaRef(media)?.rawMediaToken;

    await expect(
      handleBridgeReq(
        { source: 'tg-archive', kind: 'req', id: 2, op: 'releaseMediaToken', args: { rawMediaToken: token } },
        handles({ download: vi.fn() }),
        vi.fn()
      )
    ).resolves.toEqual({ released: true });

    expect(() => resolveMediaToken(token)).toThrow('UNKNOWN_MEDIA_TOKEN');
  });
});
