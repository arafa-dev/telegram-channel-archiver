import type { MediaRef, MessageMeta, PhotoSize, VideoVariant } from '../shared/types';

export interface MessageNormalized {
  meta: MessageMeta;
  mediaRef: MediaRef | null;
}

const mediaRegistry = new Map<string, any>();
let nextMediaToken = 1;

export function registerMediaToken(media: any): string {
  const token = `media:${nextMediaToken}`;
  nextMediaToken += 1;
  mediaRegistry.set(token, media);
  return token;
}

export function resolveMediaToken(token: unknown): any {
  if (typeof token !== 'string' || !mediaRegistry.has(token)) throw new Error('UNKNOWN_MEDIA_TOKEN');
  return mediaRegistry.get(token);
}

export function releaseMediaToken(token: unknown): boolean {
  return typeof token === 'string' && mediaRegistry.delete(token);
}

export function extractMessage(msg: any): MessageNormalized {
  if (!isRecord(msg) || !Number.isFinite(msg.id) || !Number.isFinite(msg.date)) {
    throw new Error('MALFORMED_MESSAGE');
  }

  const meta: MessageMeta = {
    messageId: msg.id,
    albumGroupedId: toFiniteNumberOrNull(msg.grouped_id),
    dateUtc: new Date(msg.date * 1000).toISOString(),
    fromId: toFiniteNumberOrNull(msg.fromId ?? (isRecord(msg.from_id) ? msg.from_id.user_id : null)),
    fromName: null,
    caption: typeof msg.message === 'string' ? msg.message : '',
  };

  return {
    meta,
    mediaRef: extractMediaRef(msg.media),
  };
}

export function extractMediaRef(media: any): MediaRef | null {
  if (!isRecord(media)) return null;

  if (media._ === 'messageMediaPhoto' && isRecord(media.photo)) {
    return {
      kind: 'photo',
      mimeType: 'image/jpeg',
      fileName: null,
      photoSizes: extractPhotoSizes(Array.isArray(media.photo.sizes) ? media.photo.sizes : []),
      rawMediaToken: registerMediaToken(media),
    };
  }

  if (media._ === 'messageMediaDocument' && isRecord(media.document)) {
    const doc = media.document;
    const mime: string = typeof doc.mime_type === 'string' ? doc.mime_type : 'application/octet-stream';
    if (!mime.startsWith('video/') && mime !== 'image/gif') return null;

    const attrs = Array.isArray(doc.attributes) ? doc.attributes : [];
    const videoAttr = attrs.find((a: any) => a._ === 'documentAttributeVideo');
    const fileNameAttr = attrs.find((a: any) => a._ === 'documentAttributeFilename');
    if (!isRecord(videoAttr)) return null;

    const variant: VideoVariant = {
      width: toFiniteNumberOrNull(videoAttr.w) ?? 0,
      height: toFiniteNumberOrNull(videoAttr.h) ?? 0,
      durationSec: toFiniteNumberOrNull(videoAttr.duration) ?? 0,
      byteSize: toFiniteNumberOrNull(doc.size),
      mimeType: mime,
      isStreaming: true,
      isDocumentAttachment: false,
    };

    return {
      kind: 'video',
      mimeType: mime,
      fileName: isRecord(fileNameAttr) && typeof fileNameAttr.file_name === 'string' ? fileNameAttr.file_name : null,
      videoVariants: [variant],
      rawMediaToken: registerMediaToken(media),
    };
  }

  return null;
}

function extractPhotoSizes(rawSizes: any[]): PhotoSize[] {
  const out: PhotoSize[] = [];

  for (const s of rawSizes) {
    if (!isRecord(s) || typeof s.type !== 'string') continue;

    if (s._ === 'photoSizeProgressive') {
      const width = toFiniteNumberOrNull(s.w);
      const height = toFiniteNumberOrNull(s.h);
      if (width === null || height === null) continue;
      const sizes = Array.isArray(s.sizes) ? s.sizes.filter((size) => Number.isFinite(size)) : [];
      out.push({
        type: s.type,
        width,
        height,
        byteSize: sizes.length > 0 ? Math.max(...sizes) : null,
      });
    } else if (s._ === 'photoSize') {
      const width = toFiniteNumberOrNull(s.w);
      const height = toFiniteNumberOrNull(s.h);
      if (width === null || height === null) continue;
      out.push({
        type: s.type,
        width,
        height,
        byteSize: toFiniteNumberOrNull(s.size),
      });
    }
  }

  return out;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
