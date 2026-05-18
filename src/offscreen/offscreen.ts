type OffscreenResponse<T> = { ok: true; value: T } | { ok: false; error: string };

type OffscreenMessage =
  | { target: 'offscreen'; kind: 'bytesBegin'; transferId: string; mimeType: string; totalBytes: number }
  | { target: 'offscreen'; kind: 'bytesChunk'; transferId: string; index: number; data: string }
  | { target: 'offscreen'; kind: 'bytesEnd'; transferId: string }
  | { target: 'offscreen'; kind: 'bytesAbort'; transferId: string }
  | { target: 'offscreen'; kind: 'revoke'; url: string };

type TransferState = {
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  chunks: Uint8Array[];
};

const transfers = new Map<string, TransferState>();

function isOffscreenTarget(msg: unknown): msg is { target: 'offscreen'; kind?: unknown } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { target?: unknown }).target === 'offscreen'
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBase64String(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

function isOffscreenMessage(msg: { target: 'offscreen'; kind?: unknown }): msg is OffscreenMessage {
  if (msg.kind === 'bytesBegin') {
    const begin = msg as { transferId?: unknown; mimeType?: unknown; totalBytes?: unknown };
    return isNonEmptyString(begin.transferId) && typeof begin.mimeType === 'string' && isNonNegativeInteger(begin.totalBytes);
  }

  if (msg.kind === 'bytesChunk') {
    const chunk = msg as { transferId?: unknown; index?: unknown; data?: unknown };
    return isNonEmptyString(chunk.transferId) && isNonNegativeInteger(chunk.index) && isBase64String(chunk.data);
  }

  if (msg.kind === 'bytesEnd' || msg.kind === 'bytesAbort') {
    return isNonEmptyString((msg as { transferId?: unknown }).transferId);
  }

  if (msg.kind === 'revoke') {
    return typeof (msg as { url?: unknown }).url === 'string';
  }

  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): ArrayBuffer {
  const buffer = new ArrayBuffer(totalBytes);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (response: OffscreenResponse<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!isOffscreenTarget(msg)) return false;
  if (!isOffscreenMessage(msg)) {
    sendResponse({ ok: false, error: 'INVALID_OFFSCREEN_MESSAGE' });
    return false;
  }

  try {
    if (msg.kind === 'bytesBegin') {
      if (transfers.has(msg.transferId)) {
        sendResponse({ ok: false, error: 'TRANSFER_ALREADY_EXISTS' });
        return false;
      }
      transfers.set(msg.transferId, { mimeType: msg.mimeType, totalBytes: msg.totalBytes, receivedBytes: 0, chunks: [] });
      sendResponse({ ok: true, value: null });
      return false;
    }

    if (msg.kind === 'bytesChunk') {
      const transfer = transfers.get(msg.transferId);
      if (!transfer) {
        sendResponse({ ok: false, error: 'UNKNOWN_TRANSFER' });
        return false;
      }
      if (msg.index !== transfer.chunks.length) {
        sendResponse({ ok: false, error: 'INVALID_CHUNK_ORDER' });
        return false;
      }

      const chunk = decodeBase64(msg.data);
      if (transfer.receivedBytes + chunk.byteLength > transfer.totalBytes) {
        sendResponse({ ok: false, error: 'TRANSFER_SIZE_MISMATCH' });
        return false;
      }

      transfer.chunks.push(chunk);
      transfer.receivedBytes += chunk.byteLength;
      sendResponse({ ok: true, value: null });
      return false;
    }

    if (msg.kind === 'bytesEnd') {
      const transfer = transfers.get(msg.transferId);
      if (!transfer) {
        sendResponse({ ok: false, error: 'UNKNOWN_TRANSFER' });
        return false;
      }
      transfers.delete(msg.transferId);

      if (transfer.receivedBytes !== transfer.totalBytes) {
        sendResponse({ ok: false, error: 'TRANSFER_SIZE_MISMATCH' });
        return false;
      }

      const bytes = concatChunks(transfer.chunks, transfer.totalBytes);
      const blob = new Blob([bytes], { type: transfer.mimeType });
      const url = URL.createObjectURL(blob);
      sendResponse({ ok: true, value: { url } });
      return false;
    }

    if (msg.kind === 'bytesAbort') {
      transfers.delete(msg.transferId);
      sendResponse({ ok: true, value: null });
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
