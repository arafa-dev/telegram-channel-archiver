import { channelSlug } from '../shared/filename';
import { bytesToObjectUrl, revokeObjectUrl } from './offscreen-client';

export interface DownloadInput {
  bytes: ArrayBuffer;
  mimeType: string;
  channelTitle: string;
  peerId: number;
  filename: string;
}

export interface TextDownloadInput {
  text: string;
  channelTitle: string;
  peerId: number;
  filename: string;
  mimeType?: string;
}

export interface DownloadResult {
  downloadId: number;
  relPath: string;
}

function archiveRelPath(input: { channelTitle: string; peerId: number; filename: string }): string {
  const folder = `TelegramArchive/${channelSlug(input.channelTitle)}__${input.peerId}`;
  return `${folder}/${input.filename}`;
}

export async function downloadBlob(input: DownloadInput): Promise<DownloadResult> {
  const relPath = archiveRelPath(input);
  const url = await bytesToObjectUrl(input.bytes, input.mimeType);

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: relPath,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    await waitForCompletion(downloadId);
    return { downloadId, relPath };
  } finally {
    await revokeObjectUrl(url);
  }
}

export async function downloadTextOverwrite(input: TextDownloadInput): Promise<DownloadResult> {
  const relPath = archiveRelPath(input);
  const bytes = new TextEncoder().encode(input.text).buffer;
  const url = await bytesToObjectUrl(bytes, input.mimeType ?? 'application/json');

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: relPath,
      conflictAction: 'overwrite',
      saveAs: false,
    });
    await waitForCompletion(downloadId);
    return { downloadId, relPath };
  } finally {
    await revokeObjectUrl(url);
  }
}

function waitForCompletion(id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => chrome.downloads.onChanged.removeListener(onChange);
    const onChange = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id) return;

      if (delta.state?.current === 'complete') {
        cleanup();
        resolve();
        return;
      }

      if (delta.state?.current === 'interrupted') {
        cleanup();
        reject(new Error(`DOWNLOAD_INTERRUPTED: ${delta.error?.current ?? 'unknown'}`));
      }
    };

    chrome.downloads.onChanged.addListener(onChange);
  });
}
