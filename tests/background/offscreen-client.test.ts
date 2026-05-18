function installChromeMock(options: { hasDocument?: () => Promise<boolean> } = {}) {
  const offscreen = {
    hasDocument: options.hasDocument,
    createDocument: vi.fn(async (_parameters: chrome.offscreen.CreateParameters): Promise<void> => undefined),
    Reason: { BLOBS: 'BLOBS' },
  };
  const runtime = {
    sendMessage: vi.fn(async (message: unknown): Promise<unknown> => {
      if ((message as { kind?: string }).kind === 'bytesToUrl') {
        return { ok: true, value: { url: 'blob:extension/test' } };
      }
      return { ok: true, value: null };
    }),
  };

  vi.stubGlobal('chrome', { offscreen, runtime });
  return { offscreen, runtime };
}

async function importClient() {
  vi.resetModules();
  return import('../../src/background/offscreen-client');
}

describe('background offscreen client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('creates the offscreen document before converting bytes to a URL', async () => {
    const { offscreen, runtime } = installChromeMock({ hasDocument: vi.fn(async () => false) });
    const { bytesToObjectUrl } = await importClient();
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    await expect(bytesToObjectUrl(bytes, 'image/png')).resolves.toBe('blob:extension/test');

    expect(offscreen.createDocument).toHaveBeenCalledWith({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Hold Blob URLs alive for chrome.downloads',
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'bytesToUrl',
      bytes,
      mimeType: 'image/png',
    });
  });

  test('deduplicates concurrent offscreen document creation', async () => {
    let finishCreate!: () => void;
    const { offscreen } = installChromeMock({ hasDocument: vi.fn(async () => false) });
    const { bytesToObjectUrl } = await importClient();
    offscreen.createDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        })
    );

    const first = bytesToObjectUrl(new ArrayBuffer(0), 'text/plain');
    const second = bytesToObjectUrl(new ArrayBuffer(0), 'text/plain');
    await vi.waitFor(() => expect(offscreen.createDocument).toHaveBeenCalledOnce());
    finishCreate?.();

    await expect(Promise.all([first, second])).resolves.toEqual(['blob:extension/test', 'blob:extension/test']);
    expect(offscreen.createDocument).toHaveBeenCalledOnce();
  });

  test('skips creation when an offscreen document already exists', async () => {
    const { offscreen } = installChromeMock({ hasDocument: vi.fn(async () => true) });
    const { bytesToObjectUrl } = await importClient();

    await expect(bytesToObjectUrl(new ArrayBuffer(0), 'text/plain')).resolves.toBe('blob:extension/test');

    expect(offscreen.createDocument).not.toHaveBeenCalled();
  });

  test('throws when bytesToUrl returns an error response', async () => {
    const { runtime } = installChromeMock({ hasDocument: vi.fn(async () => true) });
    const { bytesToObjectUrl } = await importClient();
    runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: 'OFFSCREEN_FAILED' });

    await expect(bytesToObjectUrl(new ArrayBuffer(0), 'text/plain')).rejects.toThrow('OFFSCREEN_FAILED');
  });

  test('sends revoke messages after ensuring the offscreen document exists', async () => {
    const { runtime } = installChromeMock({ hasDocument: vi.fn(async () => true) });
    const { revokeObjectUrl } = await importClient();

    await revokeObjectUrl('blob:extension/test');

    expect(runtime.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      kind: 'revoke',
      url: 'blob:extension/test',
    });
  });
});
