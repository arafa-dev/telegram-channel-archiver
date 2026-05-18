# Telegram Web K Reconnaissance

Captured on: 2026-05-18

Telegram Web K version: not captured in this environment

This document is a recon stub and implementation contract for v0.1. It is not verified evidence from a live authenticated Telegram Web K session.

Live authenticated probing is pending and must be repeated in Chrome with a logged-in Telegram Web K session at `https://web.telegram.org/k/`. Copy exact console outputs into this document when that session is available.

## Manager globals confirmed present

### Assumption for implementation

- `window.appMessagesManager` is available in Telegram Web K's main world.
- `window.appDownloadManager` is available in Telegram Web K's main world.
- `window.appImManager` is available in Telegram Web K's main world.
- `window.appPeersManager` is available in Telegram Web K's main world.
- `window.rootScope` may be available and is optional for the v0.1 bridge.

### Live probe status

Not captured in this environment. Manager presence, constructor names, prototype keys, and exact casing must be confirmed in Chrome DevTools while logged into Telegram Web K.

## Peer access

### Assumption for implementation

- The currently open chat or channel peer id is readable from `window.appImManager.chat.peerId`.
- Peer metadata is readable with `window.appPeersManager.getPeer(peerId)`.
- The returned peer object is expected to contain the channel/chat metadata needed by downstream bridge tasks, including title and username when Telegram exposes them for the peer.

### Live probe status

Not captured in this environment. The exact peer id type, title field, username field, and behavior for private channels must be confirmed in a logged-in Telegram Web K session.

## History pagination

### Assumption for implementation

- History is requested through `window.appMessagesManager.getHistory({ peerId, offsetId, limit })`.
- The result may be either a hydrated shape like `{ messages: any[] }` or an id-based shape like `{ history: number[] }`.
- When the result is id-based, message records are resolved through `window.appMessagesManager.getMessageByPeer(peerId, messageId)`.
- Pagination should compute the next `offsetId` from the oldest returned message id unless live probing confirms a continuation cursor.

### Live probe status

Not captured in this environment. The exact `getHistory` signature, return shape, ordering, empty-page behavior, and continuation semantics must be confirmed with live console output.

## Media download

### Assumption for implementation

- Media downloads should first try `window.appDownloadManager.download({ media, fileName })`.
- `download()` is assumed to return a Blob-like promise or cancellable promise that resolves to data usable by the extension download pipeline.
- If `download()` does not return a Blob-like value, the fallback is to call Telegram's save path, such as `downloadToDisc`, while intercepting the Blob with a scoped `URL.createObjectURL` monkey patch.
- The fallback must restore `URL.createObjectURL` after interception and must be treated as compatibility code, not the primary path.

### Live probe status

Not captured in this environment. The exact callable method, argument shape, return type, cancellation wrapper, filename handling, and `downloadToDisc` interception behavior must be confirmed against a small known media message.

## Event bus

### Assumption for implementation

- `window.rootScope` is optional.
- If present, it may expose an event API such as `addEventListener` and `dispatchEvent`.
- v0.1 should not require rootScope events for correctness; progress tracking should continue to work with polling or request lifecycle state when event names are unknown.

### Live probe status

Not captured in this environment. Whether `rootScope` exists, which event methods are available, and whether download-progress events are emitted must be verified in a logged-in Telegram Web K session.

## Message shape

### Assumption for implementation

- Photo media can appear as `messageMediaPhoto` with `photo.sizes`.
- Document-backed media can appear as `messageMediaDocument` with `document.attributes`.
- Video documents are identified through a `documentAttributeVideo` attribute.
- Filenames may be exposed through a `documentAttributeFilename` attribute.
- Animated GIFs are expected to be document-backed media whose video attribute flags distinguish them from normal videos, for example `nosound` or `round`.
- Grouped or album messages are expected to expose grouping metadata on the message or media object, but the exact field name is not verified.

### Live probe status

Not captured in this environment. Redacted `msg.media` examples for photo, video, grouped album, and animated GIF messages must be pasted here after live probing.

## Restricted-saving signal

### Assumption for implementation

- Channels with restricted saving may expose a channel/chat flag, potentially on the peer object returned by `window.appPeersManager.getPeer(peerId)`.
- The v0.1 bridge should not depend on this flag being present. It should attempt internal media access and report clear failures if Telegram blocks access or if internal APIs change.

### Live probe status

Not captured in this environment. The presence, field name, and behavior of any restricted-saving or `noforwards` signal must be confirmed against a channel where saving/forwarding restrictions are enabled.

## Open follow-ups

### Assumption for implementation

- Downstream bridge tasks can proceed against the assumptions in this document.
- All bridge code should include compatibility checks and fallbacks for missing managers, changed method names, changed return shapes, and failed Blob extraction.

### Live probe status

- Repeat the original DevTools probes in Chrome with an authenticated Telegram Web K session.
- Record the Telegram Web K build/version from `window.__BUILD_VERSION__` or the current `/k/` build tag when available.
- Paste exact manager global output and constructor/prototype information.
- Confirm `appImManager.chat.peerId` and `appPeersManager.getPeer(peerId)` fields for the open channel.
- Confirm `appMessagesManager.getHistory({ peerId, offsetId, limit })` arguments, return shape, ordering, and pagination behavior.
- Confirm whether `appMessagesManager.getMessageByPeer(peerId, messageId)` resolves id-based history entries.
- Confirm `appDownloadManager.download({ media, fileName })` return type with a small known media message.
- Confirm whether `downloadToDisc` plus scoped `URL.createObjectURL` interception is needed or viable as a fallback.
- Capture redacted media shapes for photo, video, grouped album, and animated GIF messages.
- Identify any channel/chat flag that signals restricted saving.
