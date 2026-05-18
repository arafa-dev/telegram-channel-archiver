import { beforeEach, describe, expect, test, vi } from 'vitest';

const offscreen = vi.hoisted(() => ({
  bytesToObjectUrl: vi.fn<[ArrayBuffer, string], Promise<string>>(async () => 'blob:archive/test'),
  revokeObjectUrl: vi.fn<[string], Promise<void>>(async () => undefined),
}));

vi.mock('../../src/background/offscreen-client', () => offscreen);

function installChromeDownloadsMock() {
  const listeners = new Set<(delta: chrome.downloads.DownloadDelta) => void>();
  const downloads = {
    download: vi.fn(async () => 77),
    search: vi.fn(async () => [{ id: 77, state: 'complete', filename: '/Users/arafa/Downloads/TelegramArchive/test/file.jpg' }]),
    onChanged: {
      addListener: vi.fn((listener: (delta: chrome.downloads.DownloadDelta) => void) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn((listener: (delta: chrome.downloads.DownloadDelta) => void) => {
        listeners.delete(listener);
      }),
    },
  };
  vi.stubGlobal('chrome', { downloads });
  return { downloads, emit: (delta: chrome.downloads.DownloadDelta) => listeners.forEach((listener) => listener(delta)) };
}

describe('background downloads', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test('downloadBlob writes media into the channel archive folder and revokes the URL after completion', async () => {
    const { downloads, emit } = installChromeDownloadsMock();
    const { downloadBlob } = await import('../../src/background/downloads');

    const promise = downloadBlob({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      mimeType: 'image/jpeg',
      channelTitle: 'Telegram News!',
      peerId: 123,
      filename: '2026-05-18_msg9_photo.jpg',
    });
    await vi.waitFor(() => expect(downloads.onChanged.addListener).toHaveBeenCalledOnce());
    emit({ id: 77, state: { current: 'complete' } });

    await expect(promise).resolves.toEqual({
      downloadId: 77,
      relPath: 'TelegramArchive/telegram-news__123/2026-05-18_msg9_photo.jpg',
      filename: 'file.jpg',
    });
    expect(offscreen.bytesToObjectUrl).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/jpeg');
    expect(downloads.download).toHaveBeenCalledWith({
      url: 'blob:archive/test',
      filename: 'TelegramArchive/telegram-news__123/2026-05-18_msg9_photo.jpg',
      conflictAction: 'uniquify',
      saveAs: false,
    });
    expect(offscreen.revokeObjectUrl).toHaveBeenCalledWith('blob:archive/test');
    expect(downloads.onChanged.removeListener).toHaveBeenCalledOnce();
  });

  test('downloadBlob rejects interrupted downloads and still revokes the URL', async () => {
    const { downloads, emit } = installChromeDownloadsMock();
    downloads.search.mockResolvedValue([{ id: 77, state: 'in_progress', filename: '' }]);
    const { downloadBlob } = await import('../../src/background/downloads');

    const promise = downloadBlob({
      bytes: new ArrayBuffer(0),
      mimeType: 'video/mp4',
      channelTitle: 'Videos',
      peerId: 9,
      filename: 'clip.mp4',
    });
    await vi.waitFor(() => expect(chrome.downloads.onChanged.addListener).toHaveBeenCalledOnce());
    emit({ id: 77, state: { current: 'interrupted' }, error: { current: 'NETWORK_FAILED' } });

    await expect(promise).rejects.toThrow('DOWNLOAD_INTERRUPTED: NETWORK_FAILED');
    expect(offscreen.revokeObjectUrl).toHaveBeenCalledWith('blob:archive/test');
  });

  test('downloadTextOverwrite encodes text and overwrites sidecar files', async () => {
    const { downloads, emit } = installChromeDownloadsMock();
    const { downloadTextOverwrite } = await import('../../src/background/downloads');

    const promise = downloadTextOverwrite({
      text: '{"ok":true}\n',
      channelTitle: 'A/B',
      peerId: 5,
      filename: 'manifest.json',
    });
    await vi.waitFor(() => expect(downloads.onChanged.addListener).toHaveBeenCalledOnce());
    emit({ id: 77, state: { current: 'complete' } });

    await expect(promise).resolves.toEqual({
      downloadId: 77,
      relPath: 'TelegramArchive/a-b__5/manifest.json',
      filename: 'file.jpg',
    });
    expect(offscreen.bytesToObjectUrl).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'application/json');
    const [encoded] = offscreen.bytesToObjectUrl.mock.calls[0]!;
    expect(new TextDecoder().decode(encoded)).toBe('{"ok":true}\n');
    expect(downloads.download).toHaveBeenCalledWith({
      url: 'blob:archive/test',
      filename: 'TelegramArchive/a-b__5/manifest.json',
      conflictAction: 'overwrite',
      saveAs: false,
    });
  });

  test('downloadBlob reconciles a terminal state missed before listener registration', async () => {
    const { downloads } = installChromeDownloadsMock();
    downloads.search.mockResolvedValue([
      {
        id: 77,
        state: 'complete',
        filename: '/Users/arafa/Downloads/TelegramArchive/telegram-news__123/photo (1).jpg',
      },
    ]);
    const { downloadBlob } = await import('../../src/background/downloads');

    await expect(
      downloadBlob({
        bytes: new ArrayBuffer(0),
        mimeType: 'image/jpeg',
        channelTitle: 'Telegram News',
        peerId: 123,
        filename: 'photo.jpg',
      })
    ).resolves.toEqual({
      downloadId: 77,
      relPath: 'TelegramArchive/telegram-news__123/photo.jpg',
      filename: 'photo (1).jpg',
    });

    expect(downloads.onChanged.removeListener).toHaveBeenCalledOnce();
  });
});
