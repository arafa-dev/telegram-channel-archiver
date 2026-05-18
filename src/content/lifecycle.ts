type ChangeCallback = () => void;

export class LifecycleWatcher {
  private currentUrl = location.href;
  private lastPeerId: number | null = null;
  private readonly callbacks = new Set<ChangeCallback>();
  private readonly intervalIds: number[] = [];
  private getCurrentPeerId: (() => number | null) | null = null;
  private readonly beforeUnload = () => this.fire();

  start(getCurrentPeerId: () => number | null): void {
    this.stop();
    this.getCurrentPeerId = getCurrentPeerId;
    this.currentUrl = location.href;
    this.lastPeerId = getCurrentPeerId();

    this.intervalIds.push(window.setInterval(() => this.checkUrl(), 500));
    this.intervalIds.push(window.setInterval(() => this.checkPeer(), 1000));
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

  private checkPeer(): void {
    if (!this.getCurrentPeerId) return;
    const peerId = this.getCurrentPeerId();
    if (peerId === this.lastPeerId) return;
    this.lastPeerId = peerId;
    this.fire();
  }

  private fire(): void {
    for (const cb of this.callbacks) cb();
  }
}
