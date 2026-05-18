import { parseFloodWait, type BackoffOptions } from '../shared/floodwait';

export interface PoolJob<T> {
  id: string | number;
  run: () => Promise<T>;
  onSuccess?: (value: T) => void | Promise<void>;
  onFailure?: (error: Error) => void | Promise<void>;
}

interface QueuedJob<T = unknown> {
  job: PoolJob<T>;
  transientFailures: number;
}

export interface DownloadPoolOptions extends BackoffOptions {}

export class DownloadPool {
  private readonly queue: Array<QueuedJob<unknown>> = [];
  private readonly drainResolvers: Array<() => void> = [];
  private readonly now: () => number;
  private readonly baseTransientMs: number;
  private readonly maxRetries: number;
  private inFlight = 0;
  private paused = false;
  private holdUntilMs = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly concurrency = 3, options: DownloadPoolOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.baseTransientMs = options.baseTransientMs ?? 2_000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  enqueue<T>(job: PoolJob<T>): void {
    this.queue.push({ job: job as PoolJob<unknown>, transientFailures: 0 });
    this.tick();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.tick();
  }

  clearQueue(): void {
    this.queue.length = 0;
    this.resolveDrainIfIdle();
  }

  pendingCount(): number {
    return this.inFlight + this.queue.length;
  }

  drain(): Promise<void> {
    if (this.inFlight === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainResolvers.push(resolve));
  }

  private tick(): void {
    if (this.paused) return;

    const delay = this.delayUntilMs();
    if (delay > 0) {
      this.scheduleTick(delay);
      return;
    }

    while (!this.paused && this.inFlight < this.concurrency && this.queue.length > 0) {
      const queued = this.queue.shift();
      if (!queued) return;
      this.inFlight += 1;
      void this.runQueued(queued);
    }
  }

  private async runQueued(queued: QueuedJob<unknown>): Promise<void> {
    try {
      const value = await queued.job.run();
      await queued.job.onSuccess?.(value);
    } catch (e: unknown) {
      await this.handleFailure(queued, toError(e));
    } finally {
      this.inFlight -= 1;
      this.resolveDrainIfIdle();
      this.tick();
    }
  }

  private async handleFailure(queued: QueuedJob<unknown>, error: Error): Promise<void> {
    const floodWaitSec = parseFloodWait(error.message);
    if (floodWaitSec !== null) {
      this.holdUntilMs = Math.max(this.holdUntilMs, this.now() + floodWaitSec * 1000);
      this.queue.unshift(queued);
      return;
    }

    queued.transientFailures += 1;
    if (queued.transientFailures <= this.maxRetries) {
      const waitMs = this.baseTransientMs * 2 ** (queued.transientFailures - 1);
      this.holdUntilMs = Math.max(this.holdUntilMs, this.now() + waitMs);
      this.queue.unshift(queued);
      return;
    }

    await queued.job.onFailure?.(error);
  }

  private delayUntilMs(): number {
    return Math.max(0, this.holdUntilMs - this.now());
  }

  private scheduleTick(delayMs: number): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tick();
    }, delayMs);
  }

  private resolveDrainIfIdle(): void {
    if (this.inFlight > 0 || this.queue.length > 0) return;
    this.drainResolvers.splice(0).forEach((resolve) => resolve());
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
