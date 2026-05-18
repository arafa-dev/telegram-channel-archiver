import type { MediaKind } from './types';

export function channelSlug(title: string): string {
  const ascii = title.normalize('NFKD').replace(/\p{M}/gu, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'channel';
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export function mimeToExt(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? 'bin';
}

export interface MediaFilenameInput {
  dateUtc: string;
  messageId: number;
  kind: MediaKind;
  mimeType: string;
}

export function mediaFilename(input: MediaFilenameInput): string {
  const date = input.dateUtc.slice(0, 10); // YYYY-MM-DD
  const ext = mimeToExt(input.mimeType);
  return `${date}_msg${input.messageId}_${input.kind}.${ext}`;
}
