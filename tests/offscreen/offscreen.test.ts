type RuntimeListener = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | undefined;

async function importOffscreenWithListener() {
  const listeners: RuntimeListener[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      onMessage: {
        addListener: vi.fn((callback: RuntimeListener) => {
          listeners.push(callback);
        }),
      },
    },
  });

  vi.resetModules();
  await import('../../src/offscreen/offscreen');

  const listener = listeners[0];
  if (!listener) throw new Error('offscreen listener was not registered');
  return listener;
}

function send(listener: RuntimeListener, msg: unknown) {
  const sendResponse = vi.fn();
  listener(msg, { id: 'extension-id' }, sendResponse);
  return sendResponse;
}

function base64(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes));
}

describe('offscreen document message bridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('reconstructs chunked bytes into an object URL', async () => {
    const listener = await importOffscreenWithListener();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');

    expect(
      send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'image/png', totalBytes: 5 })
    ).toHaveBeenCalledWith({ ok: true, value: null });
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 0, data: base64([1, 2]) })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 1, data: base64([3, 4, 5]) })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'transfer-1' })).toHaveBeenCalledWith({
      ok: true,
      value: { url: 'blob:extension/test' },
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('image/png');
    await expect((blob as Blob).arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5]).buffer);
  });

  test('revokes object URLs', async () => {
    const listener = await importOffscreenWithListener();
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    expect(send(listener, { target: 'offscreen', kind: 'revoke', url: 'blob:extension/test' })).toHaveBeenCalledWith({ ok: true, value: null });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:extension/test');
  });

  test('ignores messages from other senders and targets', async () => {
    const listener = await importOffscreenWithListener();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    const sendResponse = vi.fn();

    listener({ target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 0 }, { id: 'other' }, sendResponse);
    listener({ target: 'background', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 0 }, { id: 'extension-id' }, sendResponse);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test('rejects malformed offscreen-targeted payloads', async () => {
    const listener = await importOffscreenWithListener();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: '', mimeType: 'image/png', totalBytes: 1 })).toHaveBeenCalledWith({
      ok: false,
      error: 'INVALID_OFFSCREEN_MESSAGE',
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 0, data: 42 })).toHaveBeenCalledWith({
      ok: false,
      error: 'INVALID_OFFSCREEN_MESSAGE',
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 0, data: 'not base64!' })).toHaveBeenCalledWith({
      ok: false,
      error: 'INVALID_OFFSCREEN_MESSAGE',
    });
    expect(send(listener, { target: 'offscreen', kind: 'revoke', url: 42 })).toHaveBeenCalledWith({
      ok: false,
      error: 'INVALID_OFFSCREEN_MESSAGE',
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  test('rejects invalid chunk order and missing transfers', async () => {
    const listener = await importOffscreenWithListener();

    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'missing', index: 0, data: base64([1]) })).toHaveBeenCalledWith({
      ok: false,
      error: 'UNKNOWN_TRANSFER',
    });
    send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 2 });
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 1, data: base64([1]) })).toHaveBeenCalledWith({
      ok: false,
      error: 'INVALID_CHUNK_ORDER',
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'transfer-1' })).toHaveBeenCalledWith({
      ok: false,
      error: 'UNKNOWN_TRANSFER',
    });
  });

  test('aborts transfer state', async () => {
    const listener = await importOffscreenWithListener();

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 1 })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesAbort', transferId: 'transfer-1' })).toHaveBeenCalledWith({ ok: true, value: null });
    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'transfer-1' })).toHaveBeenCalledWith({
      ok: false,
      error: 'UNKNOWN_TRANSFER',
    });
  });

  test('responds with an error when object URL creation fails and clears transfer state', async () => {
    const listener = await importOffscreenWithListener();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('create failed');
    });

    send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 1 });
    send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 0, data: base64([1]) });

    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'transfer-1' })).toHaveBeenCalledWith({ ok: false, error: 'create failed' });
    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'transfer-1' })).toHaveBeenCalledWith({
      ok: false,
      error: 'UNKNOWN_TRANSFER',
    });
  });

  test('responds with an error when object URL revocation fails', async () => {
    const listener = await importOffscreenWithListener();
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      throw new Error('revoke failed');
    });

    expect(send(listener, { target: 'offscreen', kind: 'revoke', url: 'blob:extension/test' })).toHaveBeenCalledWith({ ok: false, error: 'revoke failed' });
  });

  test('rejects transfers that exceed receiver limits', async () => {
    const listener = await importOffscreenWithListener();
    const telegramLargeVideoBytes = 700_015_062;
    const oversizedTotalBytes = 2 * 1024 * 1024 * 1024 + 1;

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'telegram-large-video', mimeType: 'video/mp4', totalBytes: telegramLargeVideoBytes })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesAbort', transferId: 'telegram-large-video' })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'huge', mimeType: 'application/octet-stream', totalBytes: oversizedTotalBytes })).toHaveBeenCalledWith({
      ok: false,
      error: 'TRANSFER_TOO_LARGE',
    });

    send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'application/octet-stream', totalBytes: 100_000 });
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 0, data: 'A'.repeat(300 * 1024) })).toHaveBeenCalledWith({
      ok: false,
      error: 'CHUNK_TOO_LARGE',
    });
  });

  test('rejects new transfers when the active transfer limit is reached', async () => {
    const listener = await importOffscreenWithListener();

    for (let index = 0; index < 8; index += 1) {
      expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: `transfer-${index}`, mimeType: 'text/plain', totalBytes: 0 })).toHaveBeenCalledWith({
        ok: true,
        value: null,
      });
    }

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-8', mimeType: 'text/plain', totalBytes: 0 })).toHaveBeenCalledWith({
      ok: false,
      error: 'TOO_MANY_TRANSFERS',
    });

    for (let index = 0; index < 8; index += 1) {
      send(listener, { target: 'offscreen', kind: 'bytesAbort', transferId: `transfer-${index}` });
    }
  });

  test('cleans up abandoned transfers after TTL and permits id reuse', async () => {
    vi.useFakeTimers();
    const listener = await importOffscreenWithListener();

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 1 })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 1 })).toHaveBeenCalledWith({
      ok: false,
      error: 'TRANSFER_ALREADY_EXISTS',
    });

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 1 })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
  });

  test('refreshes transfer TTL while chunks are arriving', async () => {
    vi.useFakeTimers();
    const listener = await importOffscreenWithListener();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');

    expect(send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'slow-large-transfer', mimeType: 'text/plain', totalBytes: 2 })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'slow-large-transfer', index: 0, data: base64([1]) })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'slow-large-transfer', index: 1, data: base64([2]) })).toHaveBeenCalledWith({
      ok: true,
      value: null,
    });
    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'slow-large-transfer' })).toHaveBeenCalledWith({
      ok: true,
      value: { url: 'blob:extension/test' },
    });
  });

  test('uses accumulated chunks directly when creating the Blob', async () => {
    const listener = await importOffscreenWithListener();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    const blobParts: unknown[][] = [];
    const RealBlob = Blob;
    class RecordingBlob extends RealBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        blobParts.push([...(parts ?? [])]);
        super(parts, options);
      }
    }
    vi.stubGlobal('Blob', RecordingBlob);

    send(listener, { target: 'offscreen', kind: 'bytesBegin', transferId: 'transfer-1', mimeType: 'text/plain', totalBytes: 2 });
    send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 0, data: base64([1]) });
    send(listener, { target: 'offscreen', kind: 'bytesChunk', transferId: 'transfer-1', index: 1, data: base64([2]) });

    expect(send(listener, { target: 'offscreen', kind: 'bytesEnd', transferId: 'transfer-1' })).toHaveBeenCalledWith({
      ok: true,
      value: { url: 'blob:extension/test' },
    });
    expect(blobParts[0]).toHaveLength(2);
    expect(blobParts[0]?.every((part) => part instanceof Uint8Array)).toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});

export {};
