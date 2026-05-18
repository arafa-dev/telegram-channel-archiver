type OffscreenResponse<T> = { ok: true; value: T } | { ok: false; error: string };

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const OFFSCREEN_JUSTIFICATION = 'Hold Blob URLs alive for chrome.downloads';
const BYTE_CHUNK_SIZE = 48 * 1024;

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

function transferId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const batchSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += batchSize) {
    const batch = bytes.subarray(offset, offset + batchSize);
    binary += String.fromCharCode(...batch);
  }
  return btoa(binary);
}

async function sendOffscreen<T>(message: Record<string, unknown>, fallbackError: string): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  return assertOk<T>(response, fallbackError);
}

export async function bytesToObjectUrl(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  await ensureOffscreenDocument();
  const id = transferId();
  const view = new Uint8Array(bytes);
  let complete = false;

  try {
    await sendOffscreen<null>(
      {
        target: 'offscreen',
        kind: 'bytesBegin',
        transferId: id,
        mimeType,
        totalBytes: view.byteLength,
      },
      'OFFSCREEN_BEGIN_FAILED'
    );

    for (let offset = 0, index = 0; offset < view.byteLength; offset += BYTE_CHUNK_SIZE, index += 1) {
      await sendOffscreen<null>(
        {
          target: 'offscreen',
          kind: 'bytesChunk',
          transferId: id,
          index,
          data: bytesToBase64(view.subarray(offset, offset + BYTE_CHUNK_SIZE)),
        },
        'OFFSCREEN_CHUNK_FAILED'
      );
    }

    const value = await sendOffscreen<{ url: unknown }>(
      {
        target: 'offscreen',
        kind: 'bytesEnd',
        transferId: id,
      },
      'OFFSCREEN_FAILED'
    );
    complete = true;
    if (typeof value.url !== 'string') throw new Error('OFFSCREEN_INVALID_RESPONSE');
    return value.url;
  } catch (error) {
    if (!complete) {
      await chrome.runtime
        .sendMessage({
          target: 'offscreen',
          kind: 'bytesAbort',
          transferId: id,
        })
        .catch(() => undefined);
    }
    throw error;
  }
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
