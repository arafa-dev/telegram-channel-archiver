import type { TelegramHandles } from './resolve';

export interface DownloadProgressCallback {
  (loaded: number, total: number): void;
}

const DIRECT_DOWNLOAD_GRACE_MS = 750;
const DIRECT_DOWNLOAD_TIMEOUT = Symbol('DIRECT_DOWNLOAD_TIMEOUT');

export async function downloadMedia(
  h: TelegramHandles,
  rawMedia: any,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Blob> {
  const adm = h.appDownloadManager;

  if (rawMedia?._ === 'document' && typeof h.apiFileManager?.downloadMedia === 'function') {
    try {
      const out = await withTimeout(
        Promise.resolve(h.apiFileManager.downloadMedia({ media: rawMedia, fileName })),
        5 * 60 * 1000
      );
      const blob = toBlob(out);
      if (blob) return blob;
    } catch {
      // Keep Telegram manager fallbacks available for Web K builds where apiFileManager
      // cannot serve this document directly.
    }
  }

  if (typeof adm.download === 'function') {
    try {
      const result = adm.download({ media: rawMedia, fileName });
      attachProgress(result, onProgress);
      const out = await waitForDirectDownload(result);
      if (out !== DIRECT_DOWNLOAD_TIMEOUT) {
        const blob = toBlob(out);
        if (blob) return blob;
      }
    } catch (e) {
      // Telegram Web K can throw here for media objects that still work through downloadToDisc.
      // Treat the direct path as an optional fast path and keep the console clean.
    }
  }

  return enqueueFallbackDownload(() => downloadToDiscBlob(adm, rawMedia, fileName, onProgress));
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

function waitForDirectDownload(result: any): Promise<any | typeof DIRECT_DOWNLOAD_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof DIRECT_DOWNLOAD_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(DIRECT_DOWNLOAD_TIMEOUT), DIRECT_DOWNLOAD_GRACE_MS);
  });

  return Promise.race([Promise.resolve(result), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
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

async function downloadToDiscBlob(
  adm: any,
  rawMedia: any,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Blob> {
  if (typeof adm.downloadToDisc !== 'function') throw new Error('DOWNLOAD_UNAVAILABLE');

  const result = adm.downloadToDisc({ media: rawMedia, fileName }, true);
  attachProgress(result, onProgress);
  const out = await withTimeout(Promise.resolve(result), 5 * 60 * 1000);
  const blob = toBlob(out);
  if (!blob) throw new Error('DOWNLOAD_EMPTY');
  return blob;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
