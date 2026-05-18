type ChangeCallback = () => void;
type PeerIdSource = () => number | null | Promise<number | null>;

export class LifecycleWatcher {
  private currentUrl = location.href;
  private lastPeerId: number | null = null;
  private readonly callbacks = new Set<ChangeCallback>();
  private readonly intervalIds: number[] = [];
  private getCurrentPeerId: PeerIdSource | null = null;
  private peerCheckInFlight = false;
  private readonly beforeUnload = () => this.fire();

  async start(getCurrentPeerId: PeerIdSource): Promise<void> {
    this.stop();
    this.getCurrentPeerId = getCurrentPeerId;
    this.currentUrl = location.href;
    this.lastPeerId = await getCurrentPeerId();

    this.intervalIds.push(window.setInterval(() => this.checkUrl(), 500));
    this.intervalIds.push(window.setInterval(() => void this.checkPeer(), 1000));
    window.addEventListener('beforeunload', this.beforeUnload);
  }

  stop(): void {
    for (const id of this.intervalIds.splice(0)) window.clearInterval(id);
    window.removeEventListener('beforeunload', this.beforeUnload);
    this.getCurrentPeerId = null;
  }

  onChange(cb: ChangeCallback): void {
    this.callbacks.add(cb);
  }

  offChange(cb: ChangeCallback): void {
    this.callbacks.delete(cb);
  }

  private checkUrl(): void {
    if (location.href === this.currentUrl) return;
    this.currentUrl = location.href;
    this.fire();
  }

  private async checkPeer(): Promise<void> {
    if (!this.getCurrentPeerId || this.peerCheckInFlight) return;
    this.peerCheckInFlight = true;
    try {
      const peerId = await this.getCurrentPeerId();
      if (peerId === this.lastPeerId) return;
      this.lastPeerId = peerId;
      this.fire();
    } finally {
      this.peerCheckInFlight = false;
    }
  }

  private fire(): void {
    for (const cb of this.callbacks) cb();
  }
}
