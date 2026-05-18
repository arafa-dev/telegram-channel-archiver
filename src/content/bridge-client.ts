import {
  encodeReq,
  parseEnvelope,
  type AnyEnvelope,
  type BridgeEvent,
  type BridgeOp,
} from '../shared/envelope';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};
type EventListener = (payload: unknown) => void;

export interface BridgeClientOptions {
  callTimeoutMs?: number;
  windowRef?: Window;
}

export class BridgeClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<BridgeEvent, Set<EventListener>>();
  private readonly readyResolvers: Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private readonly windowRef: Window;
  private readonly callTimeoutMs: number;
  private isReady = false;

  constructor(options: BridgeClientOptions = {}) {
    this.windowRef = options.windowRef ?? window;
    this.callTimeoutMs = options.callTimeoutMs ?? 30_000;
    this.windowRef.addEventListener('message', (ev) => this.onMessage(ev));
  }

  call<T = unknown>(op: BridgeOp, args?: unknown): Promise<T> {
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer =
        this.callTimeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error('BRIDGE_TIMEOUT'));
            }, this.callTimeoutMs)
          : null;

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.windowRef.postMessage(encodeReq(id, op, args), '*');
    });
  }

  on(evt: BridgeEvent, fn: EventListener): void {
    const set = this.listeners.get(evt) ?? new Set<EventListener>();
    set.add(fn);
    this.listeners.set(evt, set);
  }

  off(evt: BridgeEvent, fn: EventListener): void {
    this.listeners.get(evt)?.delete(fn);
  }

  ready(timeoutMs = 30_000): Promise<void> {
    if (this.isReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        reject,
        timer: setTimeout(() => {
          const index = this.readyResolvers.indexOf(entry);
          if (index >= 0) this.readyResolvers.splice(index, 1);
          reject(new Error('BRIDGE_NOT_READY'));
        }, timeoutMs),
      };
      this.readyResolvers.push(entry);
    });
  }

  private onMessage(ev: MessageEvent): void {
    const env = parseEnvelope(ev.data) as AnyEnvelope | null;
    if (!env) return;

    if (env.kind === 'res') {
      this.handleResponse(env.id, env.ok, env.value, env.error);
      return;
    }

    if (env.kind === 'evt') {
      this.handleEvent(env.evt, env.payload);
    }
  }

  private handleResponse(id: number, ok: boolean, value: unknown, error: string | undefined): void {
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (ok) pending.resolve(value);
    else pending.reject(new Error(error ?? 'BRIDGE_ERROR'));
  }

  private handleEvent(evt: BridgeEvent, payload: unknown): void {
    if (evt === 'bridgeReady') {
      this.isReady = true;
      this.readyResolvers.splice(0).forEach((entry) => entry.resolve());
      this.listeners.get(evt)?.forEach((listener) => listener(payload));
      return;
    }

    this.listeners.get(evt)?.forEach((listener) => listener(payload));
  }
}
