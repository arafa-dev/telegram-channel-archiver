export type SwRequest =
  | { kind: 'init'; peerId: number; title: string; username: string | null }
  | { kind: 'getState'; peerId: number }
  | { kind: 'recordSeen'; peerId: number; messageIds: number[]; skippedIds?: number[]; cursor: { offsetId: number } }
  | { kind: 'beginItemTransfer'; transferId: string; peerId: number; item: import('../shared/types').ArchiveItem; mimeType: string; totalBytes: number }
  | { kind: 'appendItemTransferChunk'; transferId: string; index: number; data: string }
  | { kind: 'recordItemFromTransfer'; transferId: string }
  | { kind: 'abortItemTransfer'; transferId: string }
  | { kind: 'recordFailure'; peerId: number; failure: import('../shared/types').ArchiveFailure }
  | { kind: 'flushPersist'; peerId: number }
  | { kind: 'complete'; peerId: number }
  | { kind: 'heartbeat' }
  | { kind: 'getPeerProgress'; peerId: number };

export type SwResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

export type SwHandler = (req: SwRequest, sender: chrome.runtime.MessageSender) => Promise<SwResponse>;

export function installRouter(handler: SwHandler) {
  chrome.runtime.onMessage.addListener((req: SwRequest, sender, sendResponse) => {
    // Offscreen-targeted messages go to the offscreen doc's listener, not us.
    if ((req as { target?: string } | null)?.target === 'offscreen') return false;
    handler(req, sender)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  });
}
