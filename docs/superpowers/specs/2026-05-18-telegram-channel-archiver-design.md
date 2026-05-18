# Telegram Channel Archiver — Design

**Status:** Design approved, ready for implementation planning
**Date:** 2026-05-18
**Owner:** Mohamed Arafa

## Goal

A Chrome extension that archives every photo and video from a Telegram channel — including channels where the admin has disabled saving — to the user's local disk, with a JSON sidecar manifest that captures message IDs, dates, captions, and senders. Personal-use, unpacked extension. One channel at a time, manual trigger, resumable.

## Non-goals

These are explicitly excluded from v1. They can be added later but should not be smuggled into the initial implementation.

- Telegram Web A support (Web K only).
- Non-channel chats (DMs, groups, Saved Messages).
- Audio, voice notes, stickers, polls, service messages.
- Original ("document") uncompressed attachments — we take highest-streaming-quality only.
- Bulk / multi-channel queue.
- Auto-resume across browser launches without user action.
- Secret-chat decryption.
- Re-downloading existing items at a different quality.
- Telemetry, analytics, remote logging.
- Chrome Web Store distribution.
- Firefox / Safari / Edge.

## Research basis

Three findings drive the architecture:

1. **Telegram Web K exposes its internal app state on `window`.** `window.appDownloadManager`, `window.appMessagesManager`, and similar managers are reachable from JavaScript running in the page's main world. This is what existing userscripts ([Telegram Web - Allow Saving Content](https://greasyfork.org/en/scripts/477900-telegram-web-allow-saving-content), [Telegram Media Downloader](https://github.com/Neet-Nestor/Telegram-Media-Downloader)) rely on.
2. **The "saving disabled" restriction is purely client-side UI.** It hides download buttons, blocks the `copy` event, applies a `.no-forwards` CSS class, and adds CSS `pointer-events` rules. The MTProto layer beneath has no concept of "this user can't save this file" — call the internal download function directly and the bytes arrive normally.
3. **MV3 extensions need `world: "MAIN"` injection to touch page JS.** Default content scripts run in an isolated world and cannot see `window.appDownloadManager`. The `chrome.scripting.registerContentScripts` API supports `world: "MAIN"` for this case. Communication between MAIN-world and ISOLATED-world content scripts uses `window.postMessage`.

## Architecture

Three pieces, all in the browser, no external server.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser tab on web.telegram.org/k/                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Telegram Web K page (MAIN world)                      │  │
│  │   ├─ window.appMessagesManager, appDownloadManager…   │  │
│  │   └─ bridge.js  ◄──┐                                  │  │
│  └────────────────────┼──────────────────────────────────┘  │
│  ┌────────────────────▼──────────────────────────────────┐  │
│  │ content.js (ISOLATED world)                           │  │
│  │   ├─ UI overlay panel (Archive this channel button)   │  │
│  │   └─ window.postMessage <-> bridge                    │  │
│  └─────────────────────────┬─────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────┘
                             │ chrome.runtime.sendMessage
                             ▼
       ┌─────────────────────────────────────────┐
       │ MV3 Service Worker (background)         │
       │   ├─ chrome.downloads.download(…)       │
       │   ├─ chrome.storage.local (cursor +     │
       │   │   seenIds, keyed by peerId)         │
       │   └─ Offscreen Document (Blob → URL)    │
       └─────────────────────────────────────────┘
```

### Why the split

- **MAIN-world bridge** is mandatory: `window.appDownloadManager` only exists in page JS context.
- **Service worker** owns `chrome.downloads`; content scripts can't call it.
- **Offscreen document** is required because MV3 service workers can't call `URL.createObjectURL` on a `Blob`. The offscreen doc holds Blob → object URL conversions alive until each download completes.

## Page-world bridge

`bridge.js` is registered dynamically via `chrome.scripting.registerContentScripts` with `world: "MAIN"` and `runAt: "document_start"`. It runs in the same realm as Telegram Web K and can directly call its managers.

`bridge.js` and `content.js` communicate over `window.postMessage` with a namespaced envelope. Numeric `id` correlates request/response; errors normalize to strings.

```js
// content -> bridge
{ source: 'tg-archive', kind: 'req', id: 42, op: 'getCurrentPeer' }
{ source: 'tg-archive', kind: 'req', id: 43, op: 'getHistory',
  args: { peerId, offsetId: 0, limit: 100 } }
{ source: 'tg-archive', kind: 'req', id: 44, op: 'downloadMedia',
  args: { messageId, mediaRef } }

// bridge -> content
{ source: 'tg-archive', kind: 'res', id: 42, ok: true, value: {…} }
{ source: 'tg-archive', kind: 'res', id: 43, ok: false, error: 'FLOOD_WAIT_30' }
{ source: 'tg-archive', kind: 'evt', kind2: 'downloadProgress',
  payload: { messageId, loaded, total } }
```

### Bridge operations (minimal surface)

| Op | Purpose |
|---|---|
| `getCurrentPeer` | Returns `{peerId, title, username, type}` for the open channel. |
| `getHistory(peerId, offsetId, limit)` | Calls `appMessagesManager.getHistory` and returns `{messages[], nextOffsetId}`. |
| `extractMediaRef(message)` | Normalizes `message.media` into `{kind, sizes, mimeType, fileName, durationSec?, captionText, dateSec, fromId, albumGroupedId?}`. |
| `downloadMedia(mediaRef, qualityHint)` | Returns a Blob (or transferable Blob URL). Emits `downloadProgress` events. |

All network access goes through Telegram's own pipeline via these calls. We do not reimplement MTProto and we do not make raw fetches to Telegram CDNs.

### Resilience to internal renames

Internal symbol names (`appDownloadManager`, etc.) are not API-stable. Bridge has a `resolveTelegramHandles()` helper that probes a small set of known names at startup, logs what it found, and reports `BRIDGE_INCOMPATIBLE` cleanly if any are missing. That gives exactly one place to patch when Telegram renames things.

## Archive flow

When the user clicks "Archive this channel" in the overlay panel:

**1. Identify the channel.**
`getCurrentPeer` via the bridge. If the open peer isn't a channel, show a one-line "this isn't a channel" message and stop.

**2. Resume or fresh start.**
Service worker reads `archive:<peerId>` from `chrome.storage.local`. If present, resume from `cursor.offsetId`. Otherwise start fresh at `offsetId: 0` (newest).

```js
{
  peerId, title, username,
  startedAt, lastUpdatedAt,
  cursor: { offsetId: 12345 },
  seenIds: <base64url Uint32Array>,
  counts: { downloaded, skipped, failed },
  status: 'in_progress' | 'paused' | 'completed'
}
```

**3. Walk history backwards in pages.**

```
loop:
  page = getHistory(peerId, cursor.offsetId, limit=100)
  for msg in page.messages:
    if msg.id ∈ seenIds: skip
    mediaRef = extractMediaRef(msg)
    if mediaRef is None: skip (not a photo/video)
    if mediaRef would require "document" quality: skip (per qualityHint policy)
    enqueue download job
  persist cursor.offsetId + new seenIds (atomic)
  if page.messages.length < limit: break  # tail
```

**4. Download with bounded concurrency.**
N=3 concurrent workers. Each completed download:

1. Bridge returns a Blob.
2. Content script forwards to service worker via `chrome.runtime.sendMessage`.
3. Service worker hands to offscreen doc → object URL → `chrome.downloads.download({url, filename, conflictAction: 'uniquify'})`.
4. On success, append a row to `items.ndjson` and add `messageId` to `seenIds`.

**5. Live progress.**
Content script shows a floating panel on the page: `downloaded / found so far`, current bandwidth (30s rolling window), ETA. Pause and Cancel buttons.

**6. Completion.**
On tail reached: final manifest flush, status = `completed`, panel becomes a summary card.

## Byte path: blob → offscreen → chrome.downloads

This is the part that needs prototyping against current `tweb` source before locking the implementation.

The userscript pattern `appDownloadManager.downloadToDisc({media})` triggers Telegram's own save-to-disk, which means Telegram picks the filename and folder. Useless for our manifest.

Two options, to try in order:

- **(a)** Call `appDownloadManager.download()` (or equivalent inner method) to get a Blob, then route through our pipeline. This is the documented inner method.
- **(b)** Monkey-patch `downloadToDisc` to intercept the Blob before it's handed off to the browser. Fallback if (a) isn't exposed cleanly.

Either way, the goal is "Bridge ends up with a Blob it can postMessage back to the content script" — at which point everything downstream is standard MV3 plumbing.

## File output

```
Downloads/
└── TelegramArchive/
    └── <channel-slug>__<peerId>/
        ├── manifest.json
        ├── items.ndjson
        ├── 2024-08-12_msg18432_photo.jpg
        ├── 2024-08-12_msg18433_video.mp4
        └── …
```

- **`<channel-slug>`**: channel title, ASCII-folded, non-alphanumerics → `-`, max 60 chars.
- **`<peerId>`** appended so name collisions / renames don't break resume.
- **Filenames**: `YYYY-MM-DD_msg<msgId>_<kind>.<ext>`. Date is UTC. Kind is `photo` or `video`. Extension from MIME. Albums use the same prefix and Chrome's `uniquify` appends ` (1)`, ` (2)`.
- **Animated GIFs** are treated as videos: `kind: "video"`, extension `.mp4`. Telegram serves them as MP4 internally so no transcoding is involved.
- **Conflict action**: media files use `conflictAction: 'uniquify'`. `manifest.json` and `items.ndjson` use `conflictAction: 'overwrite'` so each batch flush replaces the prior copy in place. See [NDJSON write strategy](#ndjson-write-strategy) for why "append-only on disk" is not achievable with `chrome.downloads` and what we do instead.

### `manifest.json` — channel summary, rewritten in batches

```json
{
  "schemaVersion": 1,
  "peerId": -1001234567890,
  "channel": {
    "title": "Example Channel",
    "username": "examplechannel",
    "archivedAt": "2026-05-18T14:22:09Z"
  },
  "progress": {
    "status": "in_progress",
    "cursor": { "offsetId": 12345 },
    "lastUpdatedAt": "2026-05-18T15:01:33Z",
    "counts": { "downloaded": 1847, "skipped": 14, "failed": 2 }
  },
  "failures": [
    { "messageId": 19001, "reason": "FLOOD_WAIT_300 retries exhausted",
      "lastTriedAt": "2026-05-18T14:51:18Z" }
  ]
}
```

Rewritten every 50 items or every 30s, whichever first. Final flush on pause/completion. Failures that later succeed move from `failures` into `items.ndjson` and out of this list.

### `items.ndjson` — per-item rows, logically append-only

One JSON object per line. The file is logically append-only — once a row is written, it's never edited. Physically it's rewritten in batches (see below) because `chrome.downloads` cannot append to an existing file.

```ndjson
{"messageId":18432,"albumGroupedId":null,"kind":"photo","filename":"2024-08-12_msg18432_photo.jpg","mimeType":"image/jpeg","byteSize":412330,"dateUtc":"2024-08-12T09:14:00Z","fromId":11223344,"fromName":"Alex","caption":"First test post","qualityTier":"y","downloadedAt":"2026-05-18T14:23:01Z"}
{"messageId":18433,"albumGroupedId":18432,"kind":"video","filename":"2024-08-12_msg18433_video.mp4","mimeType":"video/mp4","byteSize":7204998,"dateUtc":"2024-08-12T09:14:00Z","fromId":11223344,"fromName":"Alex","caption":"First test post","qualityTier":"x","downloadedAt":"2026-05-18T14:23:04Z"}
```

- `albumGroupedId` populated when the source message was part of an album (each attachment is its own item per design choice, but the grouping is preserved for downstream readers).
- `caption` is full message text, no truncation. Duplicated across album members.
- `qualityTier` is Telegram's internal size letter (e.g. `x`, `y`, `w` for photos).

### NDJSON write strategy

`chrome.downloads.download` cannot append to existing files — only create them — so per-row appends are not possible. Strategy:

1. **In-memory buffer** in the service worker holds NDJSON rows for the current batch (up to 50 rows or 30s of work).
2. **IndexedDB-backed canonical copy** stores the complete NDJSON content for the channel under key `ndjson:<peerId>`. SW has IndexedDB access; the per-channel content is not subject to the 10 MB `chrome.storage.local` quota. A 5k-item channel = ~2.5 MB; 50k-item channel = ~25 MB; both comfortable.
3. **Batch flush** every 50 items or 30s: append the buffered rows to the IndexedDB copy, then write the full IndexedDB copy to disk as `items.ndjson` via `chrome.downloads.download` with `conflictAction: 'overwrite'`.
4. **Crash recovery**: if the browser dies mid-batch, the IndexedDB copy and the on-disk copy may diverge by at most one batch (50 rows). The dedup ledger's `seenIds` is the source of truth for "has this msgId been downloaded" — on resume, NDJSON rows for any msgIds in `seenIds` that aren't yet in the IndexedDB NDJSON are rebuilt from `chrome.storage.local` (which holds the row payload until the next batch flush succeeds).

This design tolerates "rewrite 25 MB every 30s" comfortably even on a slow disk, and avoids both the chrome.storage.local quota and the User-gesture friction of File System Access API.

### Dedup ledger (in `chrome.storage.local`)

```js
{ 'archive:<peerId>': {
    seenIds: <base64url Uint32Array>,
    cursor: { offsetId },
    counts,
    status
  }
}
```

Packed `seenIds` ≈ 4 bytes per message id. 5k items ≈ 20 KB. 2.5M items ≈ 10 MB (the quota ceiling). We're never close.

## Scale and robustness

Designed for channels with 5,000+ media items. End-to-end runs can be 30–90 minutes. The design assumes everything that can happen in an hour will happen.

- **Streaming manifest, not rewrite-per-item.** NDJSON content kept in IndexedDB, batched rewrites to disk for both `items.ndjson` and `manifest.json` (every 50 items or 30s).
- **Hard state in `chrome.storage.local`** before download is acked complete. Crash recovery: re-download at most the last in-flight item.
- **Resume is the default.** Clicking "Archive this channel" on a partial archive picks up at the recorded `offsetId`. Clicking on a completed channel with new posts walks newest-down until hitting a seen msgId (catch-up mode). Same cursor logic in both flows.
- **Bounded concurrency with global backoff.** N=3 workers. On `FLOOD_WAIT_<n>`, *all three* sleep n seconds — FLOOD_WAIT is per-account, fanning out during a wait worsens it. Exponential backoff on non-FLOOD errors, max 3 retries before failure.
- **Tab-pinned, not focus-pinned.** Downloads continue when the user switches to another Chrome tab — the Telegram Web K tab can be in the background. They only stop if the Telegram tab is closed, navigated to a different URL, or the user switches Telegram to a different channel. Any of those three events triggers a clean pause + Chrome notification: "Archive paused — reopen Example Channel to resume."
- **SW keepalive.** Content script heartbeats SW every 20s during active jobs.
- **Memory peak < ~200 MB** even on video-heavy 5k channels.
- **Hard wall**: 200k+ media channels are technically possible but would take many hours and require the tab to stay open the whole time. Approach C (embedded MTProto client) would be the right architecture if that's ever a requirement.

## Extension manifest

```json
{
  "manifest_version": 3,
  "name": "Telegram Channel Archiver",
  "version": "0.1.0",
  "description": "Archive all media from a Telegram Web K channel for personal use.",

  "permissions": [
    "downloads",
    "storage",
    "scripting",
    "offscreen",
    "notifications"
  ],
  "host_permissions": [
    "https://web.telegram.org/*"
  ],

  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },

  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
  },

  "content_scripts": [
    {
      "matches": ["https://web.telegram.org/k/*"],
      "js": ["content/content.js"],
      "run_at": "document_idle",
      "world": "ISOLATED"
    }
  ]
}
```

`bridge.js` is registered at runtime via `chrome.scripting.registerContentScripts` (not in the manifest above) so we can specify `world: "MAIN"` + `runAt: "document_start"` and hot-swap during development.

### Permission rationale

| Permission | Reason |
|---|---|
| `downloads` | Write archive files and manifest to disk. |
| `storage` | Cursor, seenIds, settings. |
| `scripting` | Register MAIN-world bridge dynamically. |
| `offscreen` | `URL.createObjectURL` for blobs (not available in SW). |
| `notifications` | Pause / completion / rate-limit notifications. |
| `host_permissions: web.telegram.org/*` | Only site we touch. |

### Explicitly NOT requested

`tabs`, `webRequest`, `declarativeNetRequest`, `cookies`, `<all_urls>`.

## Components and units

Each unit owns one responsibility, communicates through a well-defined message protocol, and can be tested independently.

| Unit | Owns | Depends on |
|---|---|---|
| `bridge.js` (MAIN world) | Calling Telegram Web K internals, normalizing media refs, surfacing FLOOD_WAIT errors as strings. | `window.appMessagesManager`, `window.appDownloadManager`. |
| `content.js` (ISOLATED world) | UI overlay panel, channel-walk loop, concurrency, progress display, pause/cancel. | bridge (via `postMessage`), service worker (via `chrome.runtime.sendMessage`). |
| `service-worker.js` | `chrome.downloads` calls, `chrome.storage` reads/writes, NDJSON append, manifest batch flush, notifications. | offscreen doc (via `chrome.runtime.sendMessage`). |
| `offscreen.js` | Holding Blob URLs alive long enough for downloads to start. | Nothing — pure plumbing. |
| `popup/popup.html` | Settings: quality preference, concurrency override. Shortcut to docs. | service worker via `chrome.runtime.sendMessage`. |

## Open implementation questions

To resolve during the implementation plan, not now:

1. Exact name/signature of `appDownloadManager.download()` (option (a)) vs. need to monkey-patch `downloadToDisc()` (option (b)). Requires reading current tweb source at implementation time.
2. Exact name of `appMessagesManager.getHistory()` and whether it returns `{messages[], count, nextOffsetId}` directly or requires a wrapper.
3. Whether `getCurrentPeer` reads `appImManager.chat.peerId` or another canonical location.
4. Whether the bridge can listen to existing `download progress` events on the AppDownloadManager event bus instead of polling.

## Acceptance criteria

The extension is considered v1-complete when:

- It installs as an unpacked extension on Chrome and shows an "Archive this channel" button when the user opens any channel on `web.telegram.org/k/*`.
- It archives every photo and video from a test channel with ≥100 items, including a test channel marked as "saving disabled," producing a valid `manifest.json` + `items.ndjson` and the expected media files.
- A run interrupted (tab closed, browser restart, network drop) resumes correctly from the persisted cursor on next click of "Archive this channel."
- A re-run on an already-completed channel that has received new posts catches up to the new tail without re-downloading prior items.
- A 5k-item channel completes without exhausting browser memory, getting FLOOD_WAIT-banned, or losing more than one in-flight item across an induced crash.
- No telemetry, no `<all_urls>`, no `tabs`/`webRequest`/`cookies` permissions.
