import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { encodeEvt, encodeRes, type AnyEnvelope, type ReqEnvelope } from '../../src/shared/envelope';

describe('BridgeClient', () => {
  let listeners: Array<(ev: MessageEvent) => void>;
  let posted: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = [];
    posted = [];
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, fn: (ev: MessageEvent) => void) => {
        if (type === 'message') listeners.push(fn);
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn((msg: unknown) => {
        posted.push(msg);
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function dispatch(data: AnyEnvelope) {
    for (const listener of listeners) listener({ data } as MessageEvent);
  }

  test('posts encoded requests and resolves matching responses', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient();

    const pending = bridge.call<{ ok: boolean }>('getCurrentPeer');
    const req = posted[0] as ReqEnvelope;

    expect(req).toEqual(expect.objectContaining({ source: 'tg-archive', kind: 'req', id: 1, op: 'getCurrentPeer' }));
    dispatch(encodeRes(req.id, true, { ok: true }));

    await expect(pending).resolves.toEqual({ ok: true });
  });

  test('ready resolves on bridgeReady and rejects on timeout', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient();

    const ready = bridge.ready(100);
    dispatch(encodeEvt('bridgeReady'));
    await expect(ready).resolves.toBeUndefined();
    await expect(bridge.ready(1)).resolves.toBeUndefined();

    const timedOut = expect(new BridgeClient().ready(100)).rejects.toThrow('BRIDGE_NOT_READY');
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
  });

  test('default ready timeout tolerates slow Telegram Web K startup', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient();

    const ready = bridge.ready();
    let rejected: unknown;
    ready.catch((e) => {
      rejected = e;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rejected).toBeUndefined();

    dispatch(encodeEvt('bridgeReady'));
    await expect(ready).resolves.toBeUndefined();
  });

  test('ready resolves from ping when bridgeReady fired before client construction', async () => {
    dispatch(encodeEvt('bridgeReady'));
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient({ callTimeoutMs: 100 });

    const ready = bridge.ready(1_000);
    await vi.advanceTimersByTimeAsync(0);

    const req = posted[0] as ReqEnvelope;
    expect(req).toEqual(expect.objectContaining({ kind: 'req', op: 'ping' }));
    dispatch(encodeRes(req.id, true, { ready: true }));

    await expect(ready).resolves.toBeUndefined();
  });

  test('ready keeps probing when initial ping is missed before the bridge listener exists', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient({ callTimeoutMs: 25 });

    const ready = bridge.ready(1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect((posted[0] as ReqEnvelope).op).toBe('ping');

    await vi.advanceTimersByTimeAsync(25);
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(1));
    const retryReq = posted.at(-1) as ReqEnvelope;
    expect(retryReq.op).toBe('ping');
    dispatch(encodeRes(retryReq.id, true, { ready: true }));

    await expect(ready).resolves.toBeUndefined();
  });

  test('ready timeout cancels the in-flight ping so late responses are ignored', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient({ callTimeoutMs: 1_000 });

    const ready = bridge.ready(50);
    await vi.advanceTimersByTimeAsync(0);
    const timedOutReq = posted[0] as ReqEnvelope;

    const rejected = expect(ready).rejects.toThrow('BRIDGE_NOT_READY');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;

    dispatch(encodeRes(timedOutReq.id, true, { ready: true }));

    const retryReady = bridge.ready(1_000);
    await vi.advanceTimersByTimeAsync(0);
    const retryReq = posted[1] as ReqEnvelope;
    expect(retryReq).toEqual(expect.objectContaining({ kind: 'req', op: 'ping' }));
    dispatch(encodeRes(retryReq.id, true, { ready: true }));
    await expect(retryReady).resolves.toBeUndefined();
  });

  test('removes pending calls after timeout and ignores late responses', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient({ callTimeoutMs: 100 });

    const pending = bridge.call('getCurrentPeer');
    const rejected = expect(pending).rejects.toThrow('BRIDGE_TIMEOUT');
    const req = posted[0] as ReqEnvelope;

    await vi.advanceTimersByTimeAsync(100);
    await rejected;

    dispatch(encodeRes(req.id, true, { late: true }));
    const second = bridge.call('getCurrentPeer');
    const secondReq = posted[1] as ReqEnvelope;
    dispatch(encodeRes(secondReq.id, true, { ok: true }));
    await expect(second).resolves.toEqual({ ok: true });
  });

  test('allows a longer timeout for individual slow calls', async () => {
    const { BridgeClient } = await import('../../src/content/bridge-client');
    const bridge = new BridgeClient({ callTimeoutMs: 100 });

    const pending = bridge.call('downloadMedia', { rawMediaToken: 'media:1' }, 1_000);
    const req = posted[0] as ReqEnvelope;

    await vi.advanceTimersByTimeAsync(100);
    dispatch(encodeRes(req.id, true, { blob: 'ok' }));

    await expect(pending).resolves.toEqual({ blob: 'ok' });
  });
});
