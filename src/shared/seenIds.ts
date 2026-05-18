function hasBuffer(): boolean {
  return typeof Buffer !== 'undefined';
}

function base64UrlEncode(bytes: Uint8Array): string {
  if (hasBuffer()) {
    return Buffer.from(bytes).toString('base64url');
  }

  if (typeof btoa !== 'function') {
    throw new Error('No base64 encoder available');
  }

  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  if (hasBuffer()) {
    return new Uint8Array(Buffer.from(s, 'base64url'));
  }

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

export function packSeenIds(ids: Set<number>): string {
  const arr = new Uint32Array(ids.size);
  let i = 0;
  for (const id of ids) arr[i++] = id;
  return base64UrlEncode(new Uint8Array(arr.buffer));
}

export function unpackSeenIds(packed: string): Set<number> {
  if (!packed) return new Set();
  const bytes = base64UrlDecode(packed);
  const copy = new Uint8Array(bytes);
  const arr = new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / Uint32Array.BYTES_PER_ELEMENT);
  return new Set(arr);
}

export function addSeenId(ids: Set<number>, id: number): void {
  ids.add(id);
}

export function hasSeenId(ids: Set<number>, id: number): boolean {
  return ids.has(id);
}
