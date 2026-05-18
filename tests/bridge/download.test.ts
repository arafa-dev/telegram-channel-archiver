import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMedia } from '../../src/bridge/download';
import type { TelegramHandles } from '../../src/bridge/resolve';

function handles(appDownloadManager: unknown): TelegramHandles {
  return {
    appMessagesManager: {},
    appDownloadManager,
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

  it('falls back to downloadToDisc after download failure', async () => {
    const fallbackBlob = new Blob(['fallback']);
    const adm = {
      download: vi.fn().mockRejectedValue(new Error('download failed')),
      downloadToDisc: vi.fn(() => {
        URL.createObjectURL(fallbackBlob);
      }),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(downloadMedia(handles(adm), {}, 'a.jpg')).resolves.toBe(fallbackBlob);
    expect(adm.downloadToDisc).toHaveBeenCalledOnce();
  });
});

describe('downloadMedia fallback path', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serializes concurrent fallback downloads so URL.createObjectURL patches do not overlap', async () => {
    const origCreate = URL.createObjectURL;
    const firstBlob = new Blob(['first']);
    const secondBlob = new Blob(['second']);
    const starts: string[] = [];
    const resolvers: Array<() => void> = [];
    const adm = {
      downloadToDisc: vi.fn(({ fileName }: { fileName: string }) => {
        starts.push(fileName);
        return new Promise<void>((resolve) => {
          resolvers.push(() => {
            URL.createObjectURL(fileName === 'first.jpg' ? firstBlob : secondBlob);
            resolve();
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
    expect(URL.createObjectURL).toBe(origCreate);
  });

  it('restores URL.createObjectURL when downloadToDisc throws', async () => {
    const origCreate = URL.createObjectURL;

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
    expect(URL.createObjectURL).toBe(origCreate);
  });

  it('restores URL.createObjectURL when downloadToDisc rejects', async () => {
    const origCreate = URL.createObjectURL;

    await expect(
      downloadMedia(
        handles({
          downloadToDisc: vi.fn(() => Promise.reject(new Error('disc rejected'))),
        }),
        {},
        'a.jpg'
      )
    ).rejects.toThrow('disc rejected');
    expect(URL.createObjectURL).toBe(origCreate);
  });

  it('restores URL.createObjectURL when fallback times out', async () => {
    vi.useFakeTimers();
    const origCreate = URL.createObjectURL;
    const promise = downloadMedia(handles({ downloadToDisc: vi.fn(() => new Promise(() => undefined)) }), {}, 'a.jpg');
    const expectation = expect(promise).rejects.toThrow('DOWNLOAD_TIMEOUT');

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await expectation;
    expect(URL.createObjectURL).toBe(origCreate);
  });
});
