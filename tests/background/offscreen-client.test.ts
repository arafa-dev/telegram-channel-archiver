type RuntimeListener = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | undefined;

function assertJsonSafe(value: unknown) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new Error('runtime.sendMessage payload contained raw bytes');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSafe(item);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) assertJsonSafe(item);
  }
}

async function installChromeBoundaryMock(options: { hasDocument?: () => Promise<boolean> } = {}) {
  const listeners: RuntimeListener[] = [];
  const offscreen = {
    hasDocument: options.hasDocument,
    createDocument: vi.fn(async (_parameters: chrome.offscreen.CreateParameters): Promise<void> => undefined),
    Reason: { BLOBS: 'BLOBS' },
  };
  const runtime = {
    id: 'extension-id',
    onMessage: {
      addListener: vi.fn((callback: RuntimeListener) => {
        listeners.push(callback);
      }),
    },
    sendMessage: vi.fn(async (message: unknown): Promise<unknown> => {
      assertJsonSafe(message);
      const serialized = JSON.parse(JSON.stringify(message)) as unknown;
      const listener = listeners[0];
      if (!listener) throw new Error('offscreen listener was not registered');

      return new Promise((resolve) => {
        listener(serialized, { id: 'extension-id' }, resolve);
      });
    }),
  };

  vi.stubGlobal('chrome', { offscreen, runtime });
  vi.resetModules();
  await import('../../src/offscreen/offscreen');
  return { offscreen, runtime };
}

async function importClient() {
  return import('../../src/background/offscreen-client');
}

describe('background offscreen client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('creates the offscreen document and converts bytes over JSON-safe chunks', async () => {
    const { offscreen, runtime } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => false) });
    const { bytesToObjectUrl } = await importClient();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    const bytes = new Uint8Array(70_000);
    bytes[0] = 1;
    bytes[69_999] = 255;

    await expect(bytesToObjectUrl(bytes.buffer, 'image/png')).resolves.toBe('blob:extension/test');

    expect(offscreen.createDocument).toHaveBeenCalledWith({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Hold Blob URLs alive for chrome.downloads',
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'bytesBegin',
      transferId: expect.any(String),
      mimeType: 'image/png',
      totalBytes: 70_000,
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'bytesEnd',
      transferId: expect.any(String),
    });
    expect(runtime.sendMessage.mock.calls.some(([message]) => (message as { kind?: string }).kind === 'bytesToUrl')).toBe(false);
    expect(runtime.sendMessage.mock.calls.filter(([message]) => (message as { kind?: string }).kind === 'bytesChunk').length).toBeGreaterThan(1);

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    await expect((blob as Blob).arrayBuffer()).resolves.toEqual(bytes.buffer);
  });

  test('deduplicates concurrent offscreen document creation', async () => {
    let finishCreate!: () => void;
    const { offscreen } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => false) });
    const { bytesToObjectUrl } = await importClient();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    offscreen.createDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        })
    );

    const first = bytesToObjectUrl(new ArrayBuffer(0), 'text/plain');
    const second = bytesToObjectUrl(new ArrayBuffer(0), 'text/plain');
    await vi.waitFor(() => expect(offscreen.createDocument).toHaveBeenCalledOnce());
    finishCreate();

    await expect(Promise.all([first, second])).resolves.toEqual(['blob:extension/test', 'blob:extension/test']);
    expect(offscreen.createDocument).toHaveBeenCalledOnce();
  });

  test('skips creation when an offscreen document already exists', async () => {
    const { offscreen } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => true) });
    const { bytesToObjectUrl } = await importClient();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');

    await expect(bytesToObjectUrl(new ArrayBuffer(0), 'text/plain')).resolves.toBe('blob:extension/test');

    expect(offscreen.createDocument).not.toHaveBeenCalled();
  });

  test('aborts transfer when a chunk send fails', async () => {
    const { runtime } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => true) });
    const { bytesToObjectUrl } = await importClient();
    const sendMessage = runtime.sendMessage.getMockImplementation();
    if (!sendMessage) throw new Error('sendMessage mock was not installed');
    runtime.sendMessage.mockImplementation(async (message: unknown) => {
      if ((message as { kind?: string }).kind === 'bytesChunk') {
        return { ok: false, error: 'CHUNK_FAILED' };
      }
      return sendMessage(message);
    });

    await expect(bytesToObjectUrl(new Uint8Array([1, 2, 3]).buffer, 'text/plain')).rejects.toThrow('CHUNK_FAILED');
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'bytesAbort',
      transferId: expect.any(String),
    });
  });

  test('throws when bytesEnd returns an error response', async () => {
    const { runtime } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => true) });
    const { bytesToObjectUrl } = await importClient();
    const sendMessage = runtime.sendMessage.getMockImplementation();
    if (!sendMessage) throw new Error('sendMessage mock was not installed');
    runtime.sendMessage.mockImplementation(async (message: unknown) => {
      if ((message as { kind?: string }).kind === 'bytesEnd') {
        return { ok: false, error: 'OFFSCREEN_FAILED' };
      }
      return sendMessage(message);
    });

    await expect(bytesToObjectUrl(new ArrayBuffer(0), 'text/plain')).rejects.toThrow('OFFSCREEN_FAILED');
  });

  test('aborts transfer when bytesEnd returns an invalid URL response', async () => {
    const { runtime } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => true) });
    const { bytesToObjectUrl } = await importClient();
    const sendMessage = runtime.sendMessage.getMockImplementation();
    if (!sendMessage) throw new Error('sendMessage mock was not installed');
    runtime.sendMessage.mockImplementation(async (message: unknown) => {
      if ((message as { kind?: string }).kind === 'bytesEnd') {
        return { ok: true, value: { url: 42 } };
      }
      return sendMessage(message);
    });

    await expect(bytesToObjectUrl(new ArrayBuffer(0), 'text/plain')).rejects.toThrow('OFFSCREEN_INVALID_RESPONSE');
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'bytesAbort',
      transferId: expect.any(String),
    });
  });

  test('sends revoke messages after ensuring the offscreen document exists', async () => {
    const { runtime } = await installChromeBoundaryMock({ hasDocument: vi.fn(async () => true) });
    const { revokeObjectUrl } = await importClient();
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await revokeObjectUrl('blob:extension/test');

    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'revoke',
      url: 'blob:extension/test',
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:extension/test');
  });
});

export {};
