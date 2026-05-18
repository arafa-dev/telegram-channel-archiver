import { encodeEvt, encodeRes, parseEnvelope, type ReqEnvelope } from '../shared/envelope';
import { handleBridgeReq } from './handler';
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
      const value = await handleBridgeReq(req, handles);
      window.postMessage(encodeRes(req.id, true, value), '*');
    } catch (e) {
      const message = e instanceof BridgeIncompatibleError ? e.message : e instanceof Error ? e.message : String(e);
      window.postMessage(encodeRes(req.id, false, undefined, message), '*');
    }
  });

}

main().catch((e) => log('fatal', e));
