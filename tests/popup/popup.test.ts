import { beforeEach, describe, expect, test, vi } from 'vitest';

function createInput(initialValue = ''): HTMLInputElement {
  const listeners = new Map<string, EventListener>();
  return {
    value: initialValue,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }),
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  } as unknown as HTMLInputElement;
}

async function loadPopup(opts: { stored?: number; inputValue?: string } = {}) {
  vi.resetModules();
  vi.unstubAllGlobals();
  const input = createInput(opts.inputValue);
  const storage = {
    get: vi.fn(async () => (opts.stored === undefined ? {} : { concurrency: opts.stored })),
    set: vi.fn(async () => undefined),
  };

  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => (id === 'concurrency' ? input : null)),
  });
  vi.stubGlobal('chrome', { storage: { local: storage } });

  await import('../../src/popup/popup');

  return { input, storage };
}

describe('popup concurrency setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test('loads stored concurrency and defaults to 3', async () => {
    const defaultPopup = await loadPopup();
    await vi.waitFor(() => expect(defaultPopup.input.value).toBe('3'));

    const storedPopup = await loadPopup({ stored: 5 });
    await vi.waitFor(() => expect(storedPopup.input.value).toBe('5'));
  });

  test('clamps and saves concurrency changes to 1..6', async () => {
    const { input, storage } = await loadPopup({ stored: 3 });
    await vi.waitFor(() => expect(input.value).toBe('3'));

    input.value = '9';
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(storage.set).toHaveBeenLastCalledWith({ concurrency: 6 }));
    expect(input.value).toBe('6');

    input.value = '0';
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(storage.set).toHaveBeenLastCalledWith({ concurrency: 1 }));
    expect(input.value).toBe('1');
  });
});
