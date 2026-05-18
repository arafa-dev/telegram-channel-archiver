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

describe('offscreen document message bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('converts ArrayBuffer payloads into object URLs', async () => {
    const listener = await importOffscreenWithListener();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const sendResponse = vi.fn();

    listener({ target: 'offscreen', kind: 'bytesToUrl', bytes, mimeType: 'image/png' }, { id: 'extension-id' }, sendResponse);

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('image/png');
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, value: { url: 'blob:extension/test' } });
  });

  test('revokes object URLs', async () => {
    const listener = await importOffscreenWithListener();
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const sendResponse = vi.fn();

    listener({ target: 'offscreen', kind: 'revoke', url: 'blob:extension/test' }, { id: 'extension-id' }, sendResponse);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:extension/test');
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, value: null });
  });

  test('ignores messages from other senders and targets', async () => {
    const listener = await importOffscreenWithListener();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:extension/test');
    const sendResponse = vi.fn();

    listener({ target: 'offscreen', kind: 'bytesToUrl', bytes: new ArrayBuffer(0), mimeType: 'text/plain' }, { id: 'other' }, sendResponse);
    listener({ target: 'background', kind: 'bytesToUrl', bytes: new ArrayBuffer(0), mimeType: 'text/plain' }, { id: 'extension-id' }, sendResponse);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
