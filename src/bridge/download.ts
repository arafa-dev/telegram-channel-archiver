import type { TelegramHandles } from './resolve';

export interface DownloadProgressCallback {
  (loaded: number, total: number): void;
}

export async function downloadMedia(
  h: TelegramHandles,
  rawMedia: any,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Blob> {
  const adm = h.appDownloadManager;

  if (typeof adm.download === 'function') {
    try {
      const result = adm.download({ media: rawMedia, fileName });
      attachProgress(result, onProgress);
      const out = await result;
      const blob = toBlob(out);
      if (blob) return blob;
    } catch (e) {
      console.warn('[tg-archive/bridge] appDownloadManager.download failed, trying downloadToDisc fallback:', e);
    }
  }

  return enqueueFallbackDownload(() => downloadToDiscBlob(adm, rawMedia, fileName));
}

let fallbackQueue: Promise<void> = Promise.resolve();

function enqueueFallbackDownload<T>(task: () => Promise<T>): Promise<T> {
  const run = fallbackQueue.then(task, task);
  fallbackQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function attachProgress(result: any, onProgress?: DownloadProgressCallback): void {
  if (!onProgress || !result) return;

  const notify = (p: any) => onProgress(p?.done ?? p?.loaded ?? 0, p?.total ?? p?.size ?? 0);

  if (typeof result.addEventListener === 'function') {
    result.addEventListener('progress', notify);
  } else if (typeof result.on === 'function') {
    result.on('progress', notify);
  } else if ('notify' in result) {
    result.notify = notify;
  }
}

function toBlob(out: any): Blob | null {
  if (out instanceof Blob) return out;
  if (out instanceof Uint8Array) return new Blob([copyToArrayBuffer(out)]);

  if (out && typeof out === 'object' && 'bytes' in out) {
    const type = typeof out.type === 'string' ? out.type : 'application/octet-stream';
    const bytes = out.bytes;
    if (bytes instanceof Uint8Array) return new Blob([copyToArrayBuffer(bytes)], { type });
    if (bytes instanceof ArrayBuffer) return new Blob([bytes], { type });
    if (ArrayBuffer.isView(bytes)) return new Blob([copyToArrayBuffer(bytes)], { type });
  }

  return null;
}

function copyToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function downloadToDiscBlob(adm: any, rawMedia: any, fileName: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof adm.downloadToDisc !== 'function') {
      reject(new Error('DOWNLOAD_UNAVAILABLE'));
      return;
    }

    const origCreate = URL.createObjectURL;
    let settled = false;
    let restored = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const restore = () => {
      if (restored) return;
      restored = true;
      URL.createObjectURL = origCreate;
      if (timer !== undefined) clearTimeout(timer);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      restore();
      fn();
    };

    URL.createObjectURL = (value: Blob | MediaSource) => {
      if (value instanceof Blob) {
        settle(() => resolve(value));
      }
      return origCreate.call(URL, value);
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error('DOWNLOAD_TIMEOUT')));
    }, 5 * 60 * 1000);

    try {
      Promise.resolve(adm.downloadToDisc({ media: rawMedia, fileName })).catch((e: unknown) => {
        settle(() => reject(e));
      });
    } catch (e) {
      settle(() => reject(e));
    }
  });
}
