import type { TelegramHandles } from './resolve';

export interface DownloadProgressCallback {
  (loaded: number, total: number): void;
}

const DIRECT_DOWNLOAD_GRACE_MS = 750;
const FALLBACK_CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;
const DIRECT_DOWNLOAD_TIMEOUT = Symbol('DIRECT_DOWNLOAD_TIMEOUT');

interface DownloadTarget {
  media: any;
  thumb?: any;
}

export async function downloadMedia(
  h: TelegramHandles,
  rawMedia: any,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Blob> {
  const adm = h.appDownloadManager;
  const target = toDownloadTarget(rawMedia);
  const request = downloadRequest(target, fileName);

  if (shouldUseApiFileManager(target) && typeof h.apiFileManager?.downloadMedia === 'function') {
    try {
      const out = await withTimeout(
        Promise.resolve(h.apiFileManager.downloadMedia(request)),
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
      const result = adm.download(request);
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

  return enqueueFallbackDownload(() => downloadToDiscBlob(adm, target, fileName, onProgress));
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
  target: DownloadTarget,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Blob> {
  if (typeof adm.downloadToDisc !== 'function') throw new Error('DOWNLOAD_UNAVAILABLE');

  return captureObjectUrlBlob(async (capturedBlob) => {
    const result = adm.downloadToDisc(downloadRequest(target, fileName), true);
    attachProgress(result, onProgress);

    const directBlob = Promise.resolve(result).then((out) => {
      const blob = toBlob(out);
      if (blob) return blob;
      if (isPromiseLike(result)) throw new Error('DOWNLOAD_EMPTY');
      return capturedBlob;
    });

    return withTimeout(Promise.race([capturedBlob, directBlob]), FALLBACK_CAPTURE_TIMEOUT_MS);
  });
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

async function captureObjectUrlBlob<T>(fn: (capturedBlob: Promise<Blob>) => Promise<T>): Promise<T> {
  if (typeof URL.createObjectURL !== 'function') {
    return fn(Promise.reject(new Error('DOWNLOAD_EMPTY')));
  }

  const originalCreateObjectURL = URL.createObjectURL;
  let resolveCapturedBlob: (blob: Blob) => void = () => undefined;
  const capturedBlob = new Promise<Blob>((resolve) => {
    resolveCapturedBlob = resolve;
  });
  const patchedCreateObjectURL: typeof URL.createObjectURL = (object) => {
    if (object instanceof Blob) resolveCapturedBlob(object);
    return originalCreateObjectURL.call(URL, object);
  };

  URL.createObjectURL = patchedCreateObjectURL;
  try {
    return await fn(capturedBlob);
  } finally {
    if (URL.createObjectURL === patchedCreateObjectURL) {
      URL.createObjectURL = originalCreateObjectURL;
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function toDownloadTarget(rawMedia: any): DownloadTarget {
  if (isRecord(rawMedia) && isRecord(rawMedia.media)) {
    return { media: rawMedia.media, thumb: rawMedia.thumb };
  }

  return { media: rawMedia };
}

function downloadRequest(target: DownloadTarget, fileName: string): { media: any; fileName: string; thumb?: any } {
  return target.thumb ? { media: target.media, thumb: target.thumb, fileName } : { media: target.media, fileName };
}

function shouldUseApiFileManager(target: DownloadTarget): boolean {
  return target.media?._ === 'document' || (target.media?._ === 'photo' && !!target.thumb);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
