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
type ReadyResolver = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const DEFAULT_READY_TIMEOUT_MS = 120_000;

export interface BridgeClientOptions {
  callTimeoutMs?: number;
  windowRef?: Window;
}

export class BridgeClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<BridgeEvent, Set<EventListener>>();
  private readonly readyResolvers: ReadyResolver[] = [];
  private readonly windowRef: Window;
  private readonly callTimeoutMs: number;
  private readyProbeActive = false;
  private readyProbeCancel: (() => void) | null = null;
  private isReady = false;

  constructor(options: BridgeClientOptions = {}) {
    this.windowRef = options.windowRef ?? window;
    this.callTimeoutMs = options.callTimeoutMs ?? 30_000;
    this.windowRef.addEventListener('message', (ev) => this.onMessage(ev));
  }

  call<T = unknown>(op: BridgeOp, args?: unknown, timeoutMs = this.callTimeoutMs): Promise<T> {
    return this.createRequest<T>(op, args, timeoutMs).promise;
  }

  private createRequest<T = unknown>(
    op: BridgeOp,
    args: unknown,
    timeoutMs: number
  ): { promise: Promise<T>; cancel: () => void } {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error('BRIDGE_TIMEOUT'));
            }, timeoutMs)
          : null;

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.windowRef.postMessage(encodeReq(id, op, args), '*');
    });

    return {
      promise,
      cancel: () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error('BRIDGE_CANCELLED'));
      },
    };
  }

  on(evt: BridgeEvent, fn: EventListener): void {
    const set = this.listeners.get(evt) ?? new Set<EventListener>();
    set.add(fn);
    this.listeners.set(evt, set);
  }

  off(evt: BridgeEvent, fn: EventListener): void {
    this.listeners.get(evt)?.delete(fn);
  }

  ready(timeoutMs = DEFAULT_READY_TIMEOUT_MS): Promise<void> {
    if (this.isReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(entry.timer);
          reject(error);
        },
        timer: setTimeout(() => {
          const index = this.readyResolvers.indexOf(entry);
          if (index >= 0) this.readyResolvers.splice(index, 1);
          if (this.readyResolvers.length === 0) this.cancelReadyProbe();
          reject(new Error('BRIDGE_NOT_READY'));
        }, timeoutMs),
      };
      this.readyResolvers.push(entry);
      this.ensureReadyProbe();
    });
  }

  private ensureReadyProbe(): void {
    if (this.readyProbeActive) return;
    this.readyProbeActive = true;
    void this.probeReady();
  }

  private async probeReady(): Promise<void> {
    try {
      while (!this.isReady && this.readyResolvers.length > 0) {
        const request = this.createRequest<{ ready?: unknown }>('ping', undefined, this.readyProbeTimeoutMs());
        this.readyProbeCancel = request.cancel;
        try {
          const value = await request.promise;
          if (this.readyProbeCancel === request.cancel) this.readyProbeCancel = null;
          if (value?.ready === true) {
            this.markReady();
            return;
          }
        } catch {
          if (this.readyProbeCancel === request.cancel) this.readyProbeCancel = null;
        }
      }
    } finally {
      this.readyProbeActive = false;
      if (!this.isReady && this.readyResolvers.length > 0) this.ensureReadyProbe();
    }
  }

  private readyProbeTimeoutMs(): number {
    return this.callTimeoutMs > 0 ? Math.min(this.callTimeoutMs, 250) : 250;
  }

  private cancelReadyProbe(): void {
    this.readyProbeCancel?.();
    this.readyProbeCancel = null;
  }

  private markReady(): void {
    this.isReady = true;
    this.cancelReadyProbe();
    this.readyResolvers.splice(0).forEach((entry) => entry.resolve());
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
      this.markReady();
      this.listeners.get(evt)?.forEach((listener) => listener(payload));
      return;
    }

    this.listeners.get(evt)?.forEach((listener) => listener(payload));
  }
}
