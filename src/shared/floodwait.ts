export function parseFloodWait(message: string): number | null {
  const match = /^FLOOD_WAIT_(\d+)$/.exec(message);
  return match ? parseInt(match[1]!, 10) : null;
}

export interface BackoffOptions {
  now?: () => number;
  baseTransientMs?: number;
  maxRetries?: number;
}

export class BackoffScheduler {
  private readonly now: () => number;
  private readonly baseTransientMs: number;
  private readonly maxRetries: number;
  private holdUntilMs = 0;
  private transientFailureCount = 0;

  constructor(opts: BackoffOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.baseTransientMs = opts.baseTransientMs ?? 2000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  delayUntilMs(): number {
    return Math.max(0, this.holdUntilMs - this.now());
  }

  holdFor(seconds: number): void {
    this.holdUntilMs = this.now() + seconds * 1000;
  }

  /** Returns true if we should retry, false if retries are exhausted. */
  recordTransientFailure(): boolean {
    this.transientFailureCount += 1;
    if (this.transientFailureCount > this.maxRetries) return false;
    const waitMs = this.baseTransientMs * 2 ** (this.transientFailureCount - 1);
    this.holdUntilMs = this.now() + waitMs;
    return true;
  }

  recordSuccess(): void {
    this.transientFailureCount = 0;
  }
}
