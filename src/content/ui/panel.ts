const PANEL_ID = 'tga-panel';

export interface PanelView {
  title: string;
  status: 'idle' | 'walking' | 'downloading' | 'paused' | 'completed' | 'error';
  found: number;
  downloaded: number;
  failed: number;
  bandwidthBps: number;
  etaSec: number | null;
  error?: string;
}

export interface PanelCallbacks {
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export class Panel {
  private readonly root: HTMLDivElement;
  private status: PanelView['status'] = 'idle';

  constructor(private readonly callbacks: PanelCallbacks) {
    this.injectCss();
    this.root = this.build();
    document.documentElement.appendChild(this.root);
  }

  update(view: PanelView): void {
    this.status = view.status;
    this.field('title').textContent = view.title;
    this.field('status').textContent = view.status;
    this.field('found').textContent = String(view.found);
    this.field('downloaded').textContent = String(view.downloaded);
    this.field('failed').textContent = String(view.failed);
    this.field('bw').textContent = formatBps(view.bandwidthBps);
    this.field('eta').textContent = view.etaSec === null ? '-' : formatEta(view.etaSec);

    const error = this.field('error');
    if (view.error) {
      error.textContent = view.error;
      error.style.display = '';
    } else {
      error.textContent = '';
      error.style.display = 'none';
    }

    const running = view.status === 'walking' || view.status === 'downloading';
    const start = this.field<HTMLButtonElement>('start');
    start.disabled = running || view.status === 'completed';
    start.textContent = view.status === 'paused' ? 'Resume' : 'Archive this channel';
    this.field<HTMLButtonElement>('pause').disabled = !running;
    this.field<HTMLButtonElement>('cancel').disabled = view.status === 'idle' || view.status === 'completed';
  }

  private injectCss(): void {
    if (document.querySelector('link[data-tga-panel-css="true"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/panel.css');
    link.dataset.tgaPanelCss = 'true';
    document.documentElement.appendChild(link);
  }

  private build(): HTMLDivElement {
    const existing = document.getElementById(PANEL_ID);
    if (existing instanceof HTMLDivElement) existing.remove();

    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'tga-panel';
    el.innerHTML = `
      <h3 data-tga="title">Telegram Channel Archiver</h3>
      <div class="tga-row"><span>Status</span><span data-tga="status">idle</span></div>
      <div class="tga-row"><span>Found</span><span data-tga="found">0</span></div>
      <div class="tga-row"><span>Downloaded</span><span data-tga="downloaded">0</span></div>
      <div class="tga-row"><span>Failed</span><span data-tga="failed">0</span></div>
      <div class="tga-row"><span>Bandwidth</span><span data-tga="bw">0 KB/s</span></div>
      <div class="tga-row"><span>ETA</span><span data-tga="eta">-</span></div>
      <div data-tga="error" class="tga-error" style="display:none"></div>
      <div class="tga-actions">
        <button type="button" data-tga="start">Archive this channel</button>
        <button type="button" data-tga="pause" disabled>Pause</button>
        <button type="button" data-tga="cancel" disabled>Cancel</button>
      </div>
    `;

    this.fieldFrom<HTMLButtonElement>(el, 'start').addEventListener('click', () => {
      if (this.status === 'paused') this.callbacks.onResume();
      else this.callbacks.onStart();
    });
    this.fieldFrom<HTMLButtonElement>(el, 'pause').addEventListener('click', () => this.callbacks.onPause());
    this.fieldFrom<HTMLButtonElement>(el, 'cancel').addEventListener('click', () => this.callbacks.onCancel());

    return el;
  }

  private field<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.fieldFrom<T>(this.root, name);
  }

  private fieldFrom<T extends HTMLElement = HTMLElement>(root: ParentNode, name: string): T {
    const el = root.querySelector<T>(`[data-tga="${name}"]`);
    if (!el) throw new Error(`Missing panel field: ${name}`);
    return el;
  }
}

function formatBps(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.round(bps / 1024)} KB/s`;
}

function formatEta(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
