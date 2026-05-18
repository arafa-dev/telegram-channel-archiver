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
  it('releases the media token after download success', async () => {
    const media = { _: 'messageMediaPhoto', photo: { sizes: [] } };
    const token = extractMediaRef(media)?.rawMediaToken;
    const blob = new Blob(['ok']);

    await expect(
      handleBridgeReq(
        req({ rawMediaToken: token, fileName: 'a.jpg', requestId: 1 }),
        handles({ download: vi.fn().mockResolvedValue(blob) }),
        vi.fn()
      )
    ).resolves.toEqual({ blob });

    expect(() => resolveMediaToken(token)).toThrow('UNKNOWN_MEDIA_TOKEN');
  });

  it('releases the media token after download failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const media = { _: 'messageMediaPhoto', photo: { sizes: [] } };
    const token = extractMediaRef(media)?.rawMediaToken;

    await expect(
      handleBridgeReq(
        req({ rawMediaToken: token, fileName: 'a.jpg', requestId: 1 }),
        handles({ download: vi.fn().mockRejectedValue(new Error('failed')) }),
        vi.fn()
      )
    ).rejects.toThrow('DOWNLOAD_UNAVAILABLE');

    expect(() => resolveMediaToken(token)).toThrow('UNKNOWN_MEDIA_TOKEN');
  });
});
