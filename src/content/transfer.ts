import type { SwRequest } from '../background/router';
import type { ArchiveItem } from '../shared/types';

const BYTE_CHUNK_SIZE = 48 * 1024;
let nextTransferId = 1;

type CallSw = <T = unknown>(req: SwRequest) => Promise<T>;

export interface RecordArchiveItemInput {
  peerId: number;
  item: ArchiveItem;
  blob: Blob;
  mimeType: string;
}

export async function recordArchiveItemViaTransfer<T>(
  callSw: CallSw,
  input: RecordArchiveItemInput
): Promise<T> {
  const transferId = `content-transfer-${Date.now()}-${nextTransferId++}`;
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  let complete = false;

  try {
    await callSw({
      kind: 'beginItemTransfer',
      transferId,
      peerId: input.peerId,
      item: input.item,
      mimeType: input.mimeType,
      totalBytes: bytes.byteLength,
    });

    let index = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += BYTE_CHUNK_SIZE) {
      await callSw({
        kind: 'appendItemTransferChunk',
        transferId,
        index,
        data: bytesToBase64(bytes.subarray(offset, offset + BYTE_CHUNK_SIZE)),
      });
      index += 1;
    }

    const result = await callSw<T>({ kind: 'recordItemFromTransfer', transferId });
    complete = true;
    return result;
  } finally {
    if (!complete) await callSw({ kind: 'abortItemTransfer', transferId }).catch(() => undefined);
  }
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
