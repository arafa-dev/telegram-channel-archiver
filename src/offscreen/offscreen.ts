type OffscreenResponse<T> = { ok: true; value: T } | { ok: false; error: string };

type OffscreenMessage =
  | { target: 'offscreen'; kind: 'bytesToUrl'; bytes: ArrayBuffer; mimeType: string }
  | { target: 'offscreen'; kind: 'revoke'; url: string };

function isOffscreenTarget(msg: unknown): msg is { target: 'offscreen'; kind?: unknown } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { target?: unknown }).target === 'offscreen'
  );
}

function isOffscreenMessage(msg: { target: 'offscreen'; kind?: unknown }): msg is OffscreenMessage {
  if (msg.kind === 'bytesToUrl') {
    const bytesToUrlMsg = msg as { bytes?: unknown; mimeType?: unknown };
    return bytesToUrlMsg.bytes instanceof ArrayBuffer && typeof bytesToUrlMsg.mimeType === 'string';
  }

  if (msg.kind === 'revoke') {
    return typeof (msg as { url?: unknown }).url === 'string';
  }

  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (response: OffscreenResponse<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!isOffscreenTarget(msg)) return false;
  if (!isOffscreenMessage(msg)) {
    sendResponse({ ok: false, error: 'INVALID_OFFSCREEN_MESSAGE' });
    return false;
  }

  try {
    if (msg.kind === 'bytesToUrl') {
      const blob = new Blob([msg.bytes], { type: msg.mimeType });
      const url = URL.createObjectURL(blob);
      sendResponse({ ok: true, value: { url } });
      return false;
    }

    URL.revokeObjectURL(msg.url);
    sendResponse({ ok: true, value: null });
  } catch (error) {
    sendResponse({ ok: false, error: errorMessage(error) });
  }
  return false;
});

export {};
