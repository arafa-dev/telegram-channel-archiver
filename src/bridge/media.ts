import type { MediaRef, MessageMeta, PhotoSize, VideoVariant } from '../shared/types';

export interface MessageNormalized {
  meta: MessageMeta;
  mediaRef: MediaRef | null;
}

export function extractMessage(msg: any): MessageNormalized {
  const meta: MessageMeta = {
    messageId: msg.id,
    albumGroupedId: msg.grouped_id ? Number(msg.grouped_id) : null,
    dateUtc: new Date(msg.date * 1000).toISOString(),
    fromId: msg.fromId ?? msg.from_id?.user_id ?? null,
    fromName: null,
    caption: msg.message ?? '',
  };

  return {
    meta,
    mediaRef: extractMediaRef(msg.media),
  };
}

export function extractMediaRef(media: any): MediaRef | null {
  if (!media) return null;

  if (media._ === 'messageMediaPhoto' && media.photo) {
    return {
      kind: 'photo',
      mimeType: 'image/jpeg',
      fileName: null,
      photoSizes: extractPhotoSizes(media.photo.sizes ?? []),
      rawMediaToken: media,
    };
  }

  if (media._ === 'messageMediaDocument' && media.document) {
    const doc = media.document;
    const mime: string = doc.mime_type ?? 'application/octet-stream';
    if (!mime.startsWith('video/') && mime !== 'image/gif') return null;

    const attrs = doc.attributes ?? [];
    const videoAttr = attrs.find((a: any) => a._ === 'documentAttributeVideo');
    const fileNameAttr = attrs.find((a: any) => a._ === 'documentAttributeFilename');
    if (!videoAttr) return null;

    const variant: VideoVariant = {
      width: videoAttr.w ?? 0,
      height: videoAttr.h ?? 0,
      durationSec: videoAttr.duration ?? 0,
      byteSize: doc.size ?? null,
      mimeType: mime,
      isStreaming: true,
      isDocumentAttachment: false,
    };

    return {
      kind: 'video',
      mimeType: mime,
      fileName: fileNameAttr?.file_name ?? null,
      videoVariants: [variant],
      rawMediaToken: media,
    };
  }

  return null;
}

function extractPhotoSizes(rawSizes: any[]): PhotoSize[] {
  const out: PhotoSize[] = [];

  for (const s of rawSizes) {
    if (s._ === 'photoSizeProgressive') {
      out.push({
        type: s.type,
        width: s.w,
        height: s.h,
        byteSize: Math.max(...(s.sizes ?? [0])),
      });
    } else if (s._ === 'photoSize') {
      out.push({
        type: s.type,
        width: s.w,
        height: s.h,
        byteSize: s.size ?? null,
      });
    }
  }

  return out;
}
