import { installKeepalive } from './keepalive';
import { installRouter, type SwHandler } from './router';

const log = (...args: unknown[]) => console.log('[tg-archive/sw]', ...args);

const handler: SwHandler = async (req, _sender) => {
  log('req', req.kind);
  switch (req.kind) {
    case 'heartbeat':
      return { ok: true, value: { now: Date.now() } };
    default:
      return { ok: false, error: `UNHANDLED: ${req.kind}` };
  }
};

installKeepalive();
installRouter(handler);
log('service worker booted');
