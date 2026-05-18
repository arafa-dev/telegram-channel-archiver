type OffscreenResponse<T> = { ok: true; value: T } | { ok: false; error: string };

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const OFFSCREEN_JUSTIFICATION = 'Hold Blob URLs alive for chrome.downloads';

let creating: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument?.();
  if (hasDocument) return;

  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: OFFSCREEN_JUSTIFICATION,
      })
      .finally(() => {
        creating = null;
      });
  }

  await creating;
}

function assertOk<T>(response: OffscreenResponse<T> | undefined, fallbackError: string): T {
  if (!response?.ok) {
    throw new Error(response?.error ?? fallbackError);
  }
  return response.value;
}

export async function bytesToObjectUrl(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    kind: 'bytesToUrl',
    bytes,
    mimeType,
  });
  const value = assertOk<{ url: unknown }>(response, 'OFFSCREEN_FAILED');
  if (typeof value.url !== 'string') throw new Error('OFFSCREEN_INVALID_RESPONSE');
  return value.url;
}

export async function revokeObjectUrl(url: string): Promise<void> {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    kind: 'revoke',
    url,
  });
  assertOk<null>(response, 'OFFSCREEN_REVOKE_FAILED');
}
