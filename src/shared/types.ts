export type PeerId = number;

export type ArchiveStatus = 'idle' | 'in_progress' | 'paused' | 'completed' | 'error';

export interface Cursor {
  offsetId: number; // 0 = newest
}

export interface Counts {
  downloaded: number;
  skipped: number;
  failed: number;
}

export interface PeerInfo {
  peerId: PeerId;
  title: string;
  username: string | null;
  type: 'channel' | 'chat' | 'user';
}

export type MediaKind = 'photo' | 'video';

export interface PhotoSize {
  // Telegram's size letter, e.g. 's', 'm', 'x', 'y', 'w'
  type: string;
  width: number;
  height: number;
  byteSize: number | null;
}

export interface VideoVariant {
  width: number;
  height: number;
  durationSec: number;
  byteSize: number | null;
  mimeType: string;
  isStreaming: boolean; // true if Telegram serves this for inline playback
  isDocumentAttachment: boolean; // true if this is an uncompressed "original" attached as a file
}

export interface MediaRef {
  kind: MediaKind;
  mimeType: string;
  fileName: string | null;
  photoSizes?: PhotoSize[];
  videoVariants?: VideoVariant[];
  // Raw reference the bridge can hand back to downloadMedia()
  rawMediaToken: unknown;
}

export interface MessageMeta {
  messageId: number;
  albumGroupedId: number | null;
  dateUtc: string; // ISO
  fromId: number | null;
  fromName: string | null;
  caption: string;
}

export interface ArchiveItem extends MessageMeta {
  kind: MediaKind;
  filename: string;
  mimeType: string;
  byteSize: number;
  qualityTier: string;
  downloadedAt: string; // ISO
}

export interface ArchiveFailure {
  messageId: number;
  reason: string;
  lastTriedAt: string;
}
