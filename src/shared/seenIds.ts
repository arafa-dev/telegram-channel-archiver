function hasBuffer(): boolean {
  return typeof Buffer !== 'undefined';
}

function assertValidPackedSeenIds(packed: string): void {
  if (!/^[A-Za-z0-9_-]*$/.test(packed) || packed.length % 4 === 1) {
    throw new Error('Corrupt seen ids: invalid base64url data');
  }
}

function base64UrlEncodeBinaryString(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') {
    throw new Error('No base64 encoder available');
  }

  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeBinaryString(s: string): Uint8Array {
  if (typeof atob !== 'function') {
    throw new Error('No base64 decoder available');
  }

  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  if (hasBuffer()) {
    return Buffer.from(bytes).toString('base64url');
  }

  return base64UrlEncodeBinaryString(bytes);
}

function base64UrlDecode(s: string): Uint8Array {
  assertValidPackedSeenIds(s);

  if (hasBuffer()) {
    return new Uint8Array(Buffer.from(s, 'base64url'));
  }

  return base64UrlDecodeBinaryString(s);
}

function assertValidSeenId(id: number): void {
  if (!Number.isFinite(id) || !Number.isInteger(id) || id < 0 || id > 0xffffffff) {
    throw new Error(`Invalid seen id: ${String(id)}`);
  }
}

function idsToBytes(ids: Set<number>): Uint8Array {
  const bytes = new Uint8Array(ids.size * Uint32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  for (const id of ids) {
    assertValidSeenId(id);
    view.setUint32(offset, id, true);
    offset += Uint32Array.BYTES_PER_ELEMENT;
  }

  return bytes;
}

function bytesToIds(bytes: Uint8Array): Set<number> {
  if (bytes.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Corrupt seen ids: decoded byte length ${bytes.byteLength} is not divisible by 4`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ids = new Set<number>();
  for (let offset = 0; offset < bytes.byteLength; offset += Uint32Array.BYTES_PER_ELEMENT) {
    ids.add(view.getUint32(offset, true));
  }
  return ids;
}

export function packSeenIds(ids: Set<number>): string {
  return base64UrlEncode(idsToBytes(ids));
}

export function unpackSeenIds(packed: string): Set<number> {
  if (!packed) return new Set();
  const bytes = base64UrlDecode(packed);
  return bytesToIds(bytes);
}

export function addSeenId(ids: Set<number>, id: number): void {
  assertValidSeenId(id);
  ids.add(id);
}

export function hasSeenId(ids: Set<number>, id: number): boolean {
  return ids.has(id);
}

export const __seenIdsInternals = {
  base64UrlEncodeBinaryString,
  base64UrlDecodeBinaryString,
  idsToBytes,
  bytesToIds,
};
