import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMedia } from '../../src/bridge/download';
import type { TelegramHandles } from '../../src/bridge/resolve';

function handles(appDownloadManager: unknown, apiFileManager?: unknown): TelegramHandles {
  return {
    appMessagesManager: {},
    appDownloadManager,
    apiFileManager,
    appImManager: {},
    appPeersManager: {},
  };
}

async function bytes(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe('downloadMedia direct download path', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a Blob from appDownloadManager.download', async () => {
    const blob = new Blob(['ok'], { type: 'text/plain' });

    await expect(downloadMedia(handles({ download: vi.fn().mockResolvedValue(blob) }), {}, 'a.txt')).resolves.toBe(blob);
  });

  it('converts a Uint8Array view with a non-zero byteOffset to a Blob', async () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);
    const view = backing.subarray(1, 4);

    await expect(bytes(await downloadMedia(handles({ download: vi.fn().mockResolvedValue(view) }), {}, 'a.bin'))).resolves.toEqual([
      1,
      2,
      3,
    ]);
  });

  it('converts {bytes,type} results to a typed Blob', async () => {
    const blob = await downloadMedia(
      handles({ download: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2]), type: 'image/jpeg' }) }),
      {},
      'a.jpg'
    );

    expect(blob.type).toBe('image/jpeg');
    await expect(bytes(blob)).resolves.toEqual([1, 2]);
  });

  it('uses apiFileManager.downloadMedia for documents before appDownloadManager fallbacks', async () => {
    const blob = new Blob(['document'], { type: 'video/mp4' });
    const adm = { download: vi.fn(), downloadToDisc: vi.fn() };
    const apiFileManager = { downloadMedia: vi.fn().mockResolvedValue(blob) };

    await expect(
      downloadMedia(handles(adm, apiFileManager), { _: 'document', file_reference: new Uint8Array([1]) }, 'a.mp4')
    ).resolves.toBe(blob);

    expect(apiFileManager.downloadMedia).toHaveBeenCalledWith({
      media: { _: 'document', file_reference: new Uint8Array([1]) },
      fileName: 'a.mp4',
    });
    expect(adm.download).not.toHaveBeenCalled();
    expect(adm.downloadToDisc).not.toHaveBeenCalled();
  });

  it('does not send photos through apiFileManager.downloadMedia', async () => {
    const blob = new Blob(['photo'], { type: 'image/jpeg' });
    const adm = { download: vi.fn().mockResolvedValue(blob) };
    const apiFileManager = { downloadMedia: vi.fn().mockRejectedValue(new Error('photo unsupported')) };

    await expect(downloadMedia(handles(adm, apiFileManager), { _: 'photo' }, 'a.jpg')).resolves.toBe(blob);

    expect(apiFileManager.downloadMedia).not.toHaveBeenCalled();
    expect(adm.download).toHaveBeenCalledOnce();
  });

  it('falls back to downloadToDisc after download failure', async () => {
    const fallbackBlob = new Blob(['fallback']);
    const adm = {
      download: vi.fn().mockRejectedValue(new Error('download failed')),
      downloadToDisc: vi.fn().mockResolvedValue(fallbackBlob),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(downloadMedia(handles(adm), {}, 'a.jpg')).resolves.toBe(fallbackBlob);
    expect(adm.download).toHaveBeenCalledOnce();
    expect(adm.downloadToDisc).toHaveBeenCalledWith({ media: {}, fileName: 'a.jpg' }, true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to downloadToDisc when download never settles', async () => {
    vi.useFakeTimers();
    const fallbackBlob = new Blob(['fallback']);
    const adm = {
      download: vi.fn(() => new Promise(() => undefined)),
      downloadToDisc: vi.fn().mockResolvedValue(fallbackBlob),
    };

    const promise = downloadMedia(handles(adm), {}, 'a.jpg');
    await Promise.resolve();
    expect(adm.downloadToDisc).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(fallbackBlob);
    expect(adm.downloadToDisc).toHaveBeenCalledWith({ media: {}, fileName: 'a.jpg' }, true);
  });
});

describe('downloadMedia fallback path', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serializes concurrent fallback downloads without invoking Telegram disk writes', async () => {
    const firstBlob = new Blob(['first']);
    const secondBlob = new Blob(['second']);
    const starts: string[] = [];
    const resolvers: Array<() => void> = [];
    const adm = {
      downloadToDisc: vi.fn(({ fileName }: { fileName: string }) => {
        starts.push(fileName);
        return new Promise<Blob>((resolve) => {
          resolvers.push(() => {
            resolve(fileName === 'first.jpg' ? firstBlob : secondBlob);
          });
        });
      }),
    };

    const first = downloadMedia(handles(adm), {}, 'first.jpg');
    const second = downloadMedia(handles(adm), {}, 'second.jpg');
    await Promise.resolve();

    expect(starts).toEqual(['first.jpg']);
    resolvers[0]?.();
    await expect(first).resolves.toBe(firstBlob);
    await Promise.resolve();
    expect(starts).toEqual(['first.jpg', 'second.jpg']);
    resolvers[1]?.();
    await expect(second).resolves.toBe(secondBlob);
    expect(adm.downloadToDisc).toHaveBeenNthCalledWith(1, { media: {}, fileName: 'first.jpg' }, true);
    expect(adm.downloadToDisc).toHaveBeenNthCalledWith(2, { media: {}, fileName: 'second.jpg' }, true);
  });

  it('rejects when downloadToDisc throws', async () => {
    await expect(
      downloadMedia(
        handles({
          downloadToDisc: vi.fn(() => {
            throw new Error('disc failed');
          }),
        }),
        {},
        'a.jpg'
      )
    ).rejects.toThrow('disc failed');
  });

  it('rejects when downloadToDisc rejects', async () => {
    await expect(
      downloadMedia(
        handles({
          downloadToDisc: vi.fn(() => Promise.reject(new Error('disc rejected'))),
        }),
        {},
        'a.jpg'
      )
    ).rejects.toThrow('disc rejected');
  });

  it('times out when fallback never settles', async () => {
    vi.useFakeTimers();
    const promise = downloadMedia(handles({ downloadToDisc: vi.fn(() => new Promise(() => undefined)) }), {}, 'a.jpg');
    const expectation = expect(promise).rejects.toThrow('DOWNLOAD_TIMEOUT');

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await expectation;
  });

  it('rejects when Telegram returns no Blob-like value', async () => {
    await expect(
      downloadMedia(handles({ downloadToDisc: vi.fn().mockResolvedValue(undefined) }), {}, 'a.jpg')
    ).rejects.toThrow('DOWNLOAD_EMPTY');
  });
});
