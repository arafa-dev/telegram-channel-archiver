import { encodeEvt, encodeRes, parseEnvelope, type ReqEnvelope } from '../shared/envelope';
import { downloadMedia } from './download';
import { getHistory } from './history';
import { extractMessage } from './media';
import { getCurrentPeer } from './peer';
import { BridgeIncompatibleError, waitForTelegramHandles } from './resolve';

const log = (...args: unknown[]) => console.log('[tg-archive/bridge]', ...args);

async function main(): Promise<void> {
  log('starting');
  const handles = await waitForTelegramHandles();
  log('handles resolved');

  window.postMessage(encodeEvt('bridgeReady'), '*');

  window.addEventListener('message', async (ev: MessageEvent) => {
    const env = parseEnvelope(ev.data);
    if (!env || env.kind !== 'req') return;

    const req = env as ReqEnvelope;
    try {
      const value = await handleReq(req);
      window.postMessage(encodeRes(req.id, true, value), '*');
    } catch (e) {
      const message = e instanceof BridgeIncompatibleError ? e.message : e instanceof Error ? e.message : String(e);
      window.postMessage(encodeRes(req.id, false, undefined, message), '*');
    }
  });

  async function handleReq(req: ReqEnvelope): Promise<unknown> {
    switch (req.op) {
      case 'getCurrentPeer':
        return getCurrentPeer(handles);

      case 'getHistory': {
        const args = req.args as { peerId: number; offsetId: number; limit: number };
        const page = await getHistory(handles, args.peerId, args.offsetId, args.limit);
        return {
          messages: page.messages.map((m) => extractMessage(m)),
          nextOffsetId: page.nextOffsetId,
        };
      }

      case 'extractMediaRef': {
        const args = req.args as { message: any };
        return extractMessage(args.message);
      }

      case 'downloadMedia': {
        const args = req.args as { rawMediaToken: any; fileName: string; requestId: number };
        const blob = await downloadMedia(handles, args.rawMediaToken, args.fileName, (loaded, total) => {
          window.postMessage(encodeEvt('downloadProgress', { requestId: args.requestId, loaded, total }), '*');
        });
        return { blob };
      }
    }
  }
}

main().catch((e) => log('fatal', e));
