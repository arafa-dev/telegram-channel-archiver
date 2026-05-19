import { pickPhotoSize, pickVideoVariant } from '../shared/quality';
import type { ArchiveItem, MediaRef, MessageMeta } from '../shared/types';

export interface ArchiveRecord {
  item: ArchiveItem;
  mimeType: string;
}

export async function buildArchiveRecord(
  meta: MessageMeta,
  mediaRef: MediaRef,
  filename: string,
  blob: Blob
): Promise<ArchiveRecord> {
  const mimeType = mediaRef.mimeType;
  return {
    item: {
      ...meta,
      kind: mediaRef.kind,
      filename,
      mimeType,
      byteSize: blob.size,
      qualityTier: qualityTier(mediaRef),
      downloadedAt: new Date().toISOString(),
    },
    mimeType,
  };
}

function qualityTier(mediaRef: MediaRef): string {
  if (mediaRef.kind === 'photo') return pickPhotoSize(mediaRef.photoSizes ?? [])?.type ?? 'photo';

  const variant = pickVideoVariant(mediaRef.videoVariants ?? []);
  if (!variant) return 'video';
  const size = variant.width > 0 && variant.height > 0 ? `${variant.width}x${variant.height}` : 'unknown';
  return `video:${size}`;
}
