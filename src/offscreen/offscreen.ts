type OffscreenResponse<T> = { ok: true; value: T } | { ok: false; error: string };

type OffscreenMessage =
  | { target: 'offscreen'; kind: 'bytesToUrl'; bytes: ArrayBuffer; mimeType: string }
  | { target: 'offscreen'; kind: 'revoke'; url: string };

function isOffscreenMessage(msg: unknown): msg is OffscreenMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { target?: unknown }).target === 'offscreen' &&
    ((msg as { kind?: unknown }).kind === 'bytesToUrl' || (msg as { kind?: unknown }).kind === 'revoke')
  );
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (response: OffscreenResponse<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!isOffscreenMessage(msg)) return false;

  if (msg.kind === 'bytesToUrl') {
    const blob = new Blob([msg.bytes], { type: msg.mimeType });
    const url = URL.createObjectURL(blob);
    sendResponse({ ok: true, value: { url } });
    return false;
  }

  URL.revokeObjectURL(msg.url);
  sendResponse({ ok: true, value: null });
  return false;
});

export {};
