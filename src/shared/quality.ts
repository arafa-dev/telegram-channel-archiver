import type { MediaRef, PhotoSize, VideoVariant } from './types';

export function pickPhotoSize(sizes: PhotoSize[]): PhotoSize | null {
  const real = sizes.filter((size) => size.width > 0 && size.height > 0);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

export function pickVideoVariant(variants: VideoVariant[]): VideoVariant | null {
  const streaming = variants.filter((variant) => variant.isStreaming && !variant.isDocumentAttachment);
  if (streaming.length === 0) return null;
  return streaming.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

export function isMediaDownloadable(ref: MediaRef): boolean {
  if (ref.kind === 'photo') {
    return !!ref.photoSizes && pickPhotoSize(ref.photoSizes) !== null;
  }
  return !!ref.videoVariants && pickVideoVariant(ref.videoVariants) !== null;
}
