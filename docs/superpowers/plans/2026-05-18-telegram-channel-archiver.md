# Telegram Channel Archiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that archives every photo and video from a Telegram Web K channel — including channels marked as no-forwards — into a per-channel folder with a JSON sidecar manifest, NDJSON item rows, and resumable downloads.

**Architecture:** Three components running in the browser, no external server. A MAIN-world `bridge.js` script calls Telegram Web K's internal managers (`appMessagesManager`, `appDownloadManager`) and returns Blobs via `postMessage`. An ISOLATED-world `content.js` drives the channel walk, orchestrates a 3-worker download pool, and renders an in-page overlay. An MV3 service worker owns `chrome.downloads`, `chrome.storage.local`, and IndexedDB; an offscreen document holds Blob URLs alive long enough for downloads to start.

**Tech Stack:** TypeScript, esbuild, vitest, Chrome MV3, IndexedDB, `chrome.storage.local`, `chrome.scripting`, `chrome.downloads`, `chrome.offscreen`, `chrome.notifications`.

**Reference spec:** `docs/superpowers/specs/2026-05-18-telegram-channel-archiver-design.md`

---

## File Structure

```
telegram_downloader/
├── docs/
│   ├── recon.md                          # Phase 1 reconnaissance findings
│   └── superpowers/
│       ├── specs/2026-05-18-telegram-channel-archiver-design.md
│       └── plans/2026-05-18-telegram-channel-archiver.md
├── src/
│   ├── shared/
│   │   ├── envelope.ts                   # postMessage envelope helpers
│   │   ├── types.ts                      # MediaRef, Cursor, Counts, ArchiveStatus
│   │   ├── filename.ts                   # filename + slug generation
│   │   ├── quality.ts                    # size/variant selection
│   │   ├── seenIds.ts                    # packed Uint32Array codec
│   │   ├── floodwait.ts                  # FLOOD_WAIT parsing + backoff
│   │   └── ndjson.ts                     # NDJSON row builder
│   ├── bridge/
│   │   ├── bridge.ts                     # entry (MAIN world)
│   │   ├── resolve.ts                    # resolveTelegramHandles
│   │   ├── peer.ts                       # getCurrentPeer
│   │   ├── history.ts                    # getHistory
│   │   ├── media.ts                      # extractMediaRef
│   │   └── download.ts                   # downloadMedia → Blob
│   ├── content/
│   │   ├── content.ts                    # entry (ISOLATED world)
│   │   ├── bridge-client.ts              # postMessage proxy
│   │   ├── sw-client.ts                  # chrome.runtime.sendMessage proxy
│   │   ├── walker.ts                     # channel-walk loop
│   │   ├── pool.ts                       # bounded-concurrency worker pool
│   │   ├── lifecycle.ts                  # tab/peer change detection
│   │   └── ui/
│   │       ├── panel.ts                  # overlay panel
│   │       └── panel.css
│   ├── background/
│   │   ├── service-worker.ts             # entry
│   │   ├── router.ts                     # message router
│   │   ├── storage.ts                    # chrome.storage.local wrappers
│   │   ├── idb.ts                        # IndexedDB wrappers
│   │   ├── downloads.ts                  # download orchestrator
│   │   ├── manifest-writer.ts            # manifest.json batched flush
│   │   ├── ndjson-writer.ts              # items.ndjson batched flush
│   │   ├── notifications.ts              # chrome.notifications wrapper
│   │   ├── keepalive.ts                  # SW heartbeat handling
│   │   └── install.ts                    # onInstalled: register bridge.js
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.ts                  # Blob → objectURL
│   └── popup/
│       ├── popup.html
│       ├── popup.ts
│       └── popup.css
├── public/
│   ├── manifest.json
│   └── icons/{16,48,128}.png             # placeholder icons (1×1 PNGs in v0.1)
├── tests/
│   └── shared/
│       ├── envelope.test.ts
│       ├── filename.test.ts
│       ├── quality.test.ts
│       ├── seenIds.test.ts
│       ├── floodwait.test.ts
│       └── ndjson.test.ts
├── scripts/build.mjs                     # esbuild orchestrator
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .gitignore
```

**Decomposition notes:**
- `src/shared/` holds pure logic only — no Chrome APIs, no DOM, no `window`. Everything here is unit-tested with vitest.
- Bridge files split by op so each is small and one-purpose.
- Service worker is split into a thin entry + a router + per-concern modules. The entry imports everything but the modules don't import each other except through the router.
- Files that change together live together (e.g. `manifest-writer` + `ndjson-writer` both batched against IndexedDB).

---

## Phase 0 — Bootstrap

### Task 0.1: Initialize package + TypeScript + tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "telegram-channel-archiver",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:watch": "node scripts/build.mjs --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@types/node": "^20.12.7",
    "esbuild": "^0.21.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

Run: `npm install`
Expected: exits 0, `node_modules/` created.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["chrome", "node", "vitest/globals"],
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@shared': new URL('./src/shared', import.meta.url).pathname },
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
```

- [ ] **Step 5: Verify typecheck passes on empty project**

Run: `npm run typecheck`
Expected: exits 0 with no output (no files to check yet but config is valid).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: init TypeScript + vitest + esbuild tooling"
```

### Task 0.2: Create directory skeleton + esbuild script

**Files:**
- Create: `scripts/build.mjs`
- Create directories: `src/shared/`, `src/bridge/`, `src/content/`, `src/content/ui/`, `src/background/`, `src/offscreen/`, `src/popup/`, `tests/shared/`, `public/icons/`

- [ ] **Step 1: Create directory skeleton**

Run:
```bash
mkdir -p src/shared src/bridge src/content/ui src/background src/offscreen src/popup public/icons tests/shared scripts
```

- [ ] **Step 2: Create `scripts/build.mjs`**

```js
#!/usr/bin/env node
import esbuild from 'esbuild';
import { rm, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const entries = {
  'bridge/bridge': 'src/bridge/bridge.ts',
  'content/content': 'src/content/content.ts',
  'background/service-worker': 'src/background/service-worker.ts',
  'offscreen/offscreen': 'src/offscreen/offscreen.ts',
  'popup/popup': 'src/popup/popup.ts',
};

const common = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  platform: 'browser',
  sourcemap: 'inline',
  logLevel: 'info',
};

async function build() {
  if (existsSync(outdir)) await rm(outdir, { recursive: true });
  await mkdir(outdir, { recursive: true });

  const ctxs = await Promise.all(
    Object.entries(entries).map(([name, entry]) =>
      watch
        ? esbuild.context({ ...common, entryPoints: [entry], outfile: `${outdir}/${name}.js` })
        : esbuild.build({ ...common, entryPoints: [entry], outfile: `${outdir}/${name}.js` })
    )
  );

  // Copy static assets
  await cp('public/manifest.json', `${outdir}/manifest.json`);
  await cp('public/icons', `${outdir}/icons`, { recursive: true });
  await cp('src/offscreen/offscreen.html', `${outdir}/offscreen/offscreen.html`);
  await cp('src/popup/popup.html', `${outdir}/popup/popup.html`);
  await cp('src/popup/popup.css', `${outdir}/popup/popup.css`);
  await cp('src/content/ui/panel.css', `${outdir}/content/panel.css`);

  if (watch) {
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log('watching...');
  } else {
    console.log('build complete →', outdir);
  }
}

build().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Generate placeholder icons**

Run:
```bash
# Tiny 1×1 transparent PNG, base64-decoded into each size
ICON_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
for size in 16 48 128; do
  echo "$ICON_B64" | base64 -d > "public/icons/${size}.png"
done
ls -la public/icons/
```

Expected: three 67-byte PNGs.

- [ ] **Step 4: Commit**

```bash
git add scripts/build.mjs public/icons/
git commit -m "chore: add esbuild orchestrator and placeholder icons"
```

### Task 0.3: Minimum-viable manifest.json (refined later)

**Files:**
- Create: `public/manifest.json`

- [ ] **Step 1: Write initial manifest**

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
    "default_icon": {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://web.telegram.org/k/*"],
      "js": ["content/content.js"],
      "run_at": "document_idle",
      "world": "ISOLATED"
    }
  ],
  "web_accessible_resources": []
}
```

- [ ] **Step 2: Commit**

```bash
git add public/manifest.json
git commit -m "chore: add MV3 manifest"
```

---

## Phase 1 — Reconnaissance (manual)

This phase resolves the open implementation questions from the spec. The engineer logs into Telegram Web K in a sandbox browser profile and records the names of internal managers and methods that the bridge will call. **No code is written in this phase.** Output is a single notes file used as a reference by every bridge task.

### Task 1.1: Probe Telegram Web K internals

**Files:**
- Create: `docs/recon.md`

- [ ] **Step 1: Open a clean Chrome profile, navigate to https://web.telegram.org/k/ and log in.**

- [ ] **Step 2: Open a channel and open DevTools → Console. Run the following probes, copying output verbatim into `docs/recon.md`:**

```js
// Probe 1: Which manager-like globals exist?
Object.keys(window).filter(k => /^app[A-Z]/.test(k))

// Probe 2: AppDownloadManager surface
const adm = window.appDownloadManager || window.AppDownloadManager;
console.log(adm && Object.keys(adm.constructor.prototype));
console.log(typeof adm?.download, typeof adm?.downloadToDisc);

// Probe 3: AppMessagesManager.getHistory signature
const amm = window.appMessagesManager || window.AppMessagesManager;
console.log(amm && Object.keys(amm.constructor.prototype).filter(k => /history/i.test(k)));
console.log(typeof amm?.getHistory);

// Probe 4: AppImManager (peer state)
const aim = window.appImManager || window.AppImManager;
console.log(aim?.chat);
console.log(aim?.chat?.peerId);

// Probe 5: rootScope / event bus
console.log(typeof window.rootScope?.addEventListener);
console.log(typeof window.rootScope?.dispatchEvent);
```

- [ ] **Step 3: Call `adm.download({...})` on a known message in the open channel to confirm it returns a CancellablePromise / Promise<Blob>.**

Find a small image message, hover to see the message id in the URL when right-clicked → "Copy Link". Note `msgId` and `peerId`. Then in the console:

```js
const msg = await window.appMessagesManager.getMessageByPeer(window.appImManager.chat.peerId, <msgId>);
console.log(msg);
console.log(msg.media);

// Try calling download() — adjust shape based on what msg.media looks like
const promise = adm.download({ media: msg.media });
const result = await promise;
console.log(result instanceof Blob, result?.constructor?.name, result?.size);
```

If `adm.download()` does not return a Blob, try `downloadToDisc` while monkey-patching `URL.createObjectURL` to intercept the produced URL:

```js
const orig = URL.createObjectURL;
URL.createObjectURL = (b) => { console.log('intercepted blob:', b.size, b.type); window.__lastBlob = b; return orig(b); };
adm.downloadToDisc({ media: msg.media });
// Wait, then check window.__lastBlob
```

- [ ] **Step 4: Write findings to `docs/recon.md`.**

Required content:

````markdown
# Telegram Web K Reconnaissance

Captured on: <DATE>
Telegram Web K version: <check window.__BUILD_VERSION__ or check git tag of /k/>

## Manager globals confirmed present
- `window.appMessagesManager` — type: `<class name>`
- `window.appDownloadManager` — type: `<class name>`
- `window.appImManager` — type: `<class name>`
- `window.rootScope` — type: `<class name>`

## Peer access
- Open channel peer id: read from `window.appImManager.chat.peerId` → returns `<number or PeerId type>`.
- Channel title: `<which method/field>`.
- Channel username: `<which method/field>`.

## History pagination
- Method: `appMessagesManager.getHistory(peerId, offsetId, limit, ...)` — args: `<actual signature>`
- Returns: `<shape>` — note whether it's `{history: number[], messages?: Message[]}` (a slice of message ids requiring a separate `getMessagesByPeer` call) or a fully-hydrated `{messages: Message[]}`.
- Whether the result includes a continuation cursor or whether the engineer must compute next-offsetId from the oldest returned message id.

## Media download
- Inner method to call: `<adm.download(args) | adm.downloadToDisc(args) | other>`
- Args shape: `<actual>`
- Returns: `<Blob | Promise<Blob> | CancellablePromise<...> | void>`
- If does NOT return Blob: how we intercept (monkey-patch `URL.createObjectURL`? subscribe to an event?)

## Event bus (optional)
- Whether `rootScope` exposes download-progress events we can listen on instead of polling.

## Message shape
- Photo message: paste a redacted `msg.media` object for a single photo.
- Video message: paste a redacted `msg.media` object for a video.
- Album (grouped) message: paste a redacted `msg.media` object and note where `groupedId` / `albumId` lives.
- Animated GIF: paste the `msg.media` shape and note that it's a `Document` with a `DocumentAttributeVideo` whose `nosound` / `round` flags differ.

## Restricted-saving signal
- Whether channels with `noforwards` enabled expose any flag on the channel/chat object the bridge can read.

## Open follow-ups
- List anything that was unclear or that broke during probing.
````

- [ ] **Step 5: Commit**

```bash
git add docs/recon.md
git commit -m "docs: capture Telegram Web K internal API reconnaissance"
```

---

## Phase 2 — Shared pure-logic units

All files in this phase are pure TypeScript. No Chrome APIs, no DOM, no `window`. Each file gets a vitest test that fully covers its public surface.

### Task 2.1: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write types**

```ts
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
  isStreaming: boolean;       // true if Telegram serves this for inline playback
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): define core types"
```

### Task 2.2: Filename builder + channel slug

**Files:**
- Create: `tests/shared/filename.test.ts`
- Create: `src/shared/filename.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/filename.test.ts
import { describe, it, expect } from 'vitest';
import { channelSlug, mediaFilename, mimeToExt } from '../../src/shared/filename';

describe('channelSlug', () => {
  it('lowercases, ASCII-folds, hyphenates, caps at 60', () => {
    expect(channelSlug('Example Channel')).toBe('example-channel');
    expect(channelSlug('Crème Brûlée')).toBe('creme-brulee');
    expect(channelSlug('!!!Spaces & Symbols!!!')).toBe('spaces-symbols');
    expect(channelSlug('a'.repeat(200))).toHaveLength(60);
  });

  it('falls back when slug would be empty', () => {
    expect(channelSlug('???')).toBe('channel');
    expect(channelSlug('')).toBe('channel');
  });
});

describe('mediaFilename', () => {
  it('builds YYYY-MM-DD_msgID_kind.ext', () => {
    expect(
      mediaFilename({
        dateUtc: '2024-08-12T09:14:00Z',
        messageId: 18432,
        kind: 'photo',
        mimeType: 'image/jpeg',
      })
    ).toBe('2024-08-12_msg18432_photo.jpg');
  });

  it('handles video', () => {
    expect(
      mediaFilename({
        dateUtc: '2024-08-12T09:14:00Z',
        messageId: 18433,
        kind: 'video',
        mimeType: 'video/mp4',
      })
    ).toBe('2024-08-12_msg18433_video.mp4');
  });

  it('falls back to .bin for unknown MIME', () => {
    expect(
      mediaFilename({
        dateUtc: '2024-01-01T00:00:00Z',
        messageId: 1,
        kind: 'video',
        mimeType: 'application/octet-stream',
      })
    ).toBe('2024-01-01_msg1_video.bin');
  });
});

describe('mimeToExt', () => {
  it('maps known image and video MIME types', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/webp')).toBe('webp');
    expect(mimeToExt('video/mp4')).toBe('mp4');
    expect(mimeToExt('video/quicktime')).toBe('mov');
    expect(mimeToExt('image/gif')).toBe('gif');
  });

  it('returns bin for unknowns', () => {
    expect(mimeToExt('application/x-weird')).toBe('bin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: tests fail with "Cannot find module '../../src/shared/filename'".

- [ ] **Step 3: Implement `src/shared/filename.ts`**

```ts
import type { MediaKind } from './types';

export function channelSlug(title: string): string {
  const ascii = title.normalize('NFKD').replace(/\p{M}/gu, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/filename.ts tests/shared/filename.test.ts
git commit -m "feat(shared): filename builder and channel slug"
```

### Task 2.3: Quality selection (which photo size / video variant to download)

**Files:**
- Create: `tests/shared/quality.test.ts`
- Create: `src/shared/quality.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/quality.test.ts
import { describe, it, expect } from 'vitest';
import { pickPhotoSize, pickVideoVariant, isMediaDownloadable } from '../../src/shared/quality';
import type { MediaRef } from '../../src/shared/types';

describe('pickPhotoSize', () => {
  it('picks the largest sized variant', () => {
    const sizes = [
      { type: 's', width: 320, height: 240, byteSize: 10000 },
      { type: 'y', width: 1280, height: 960, byteSize: 200000 },
      { type: 'x', width: 800, height: 600, byteSize: 80000 },
    ];
    expect(pickPhotoSize(sizes)?.type).toBe('y');
  });

  it('returns null when no sizes are present', () => {
    expect(pickPhotoSize([])).toBeNull();
  });

  it('ignores stripped/cached sizes (negative width)', () => {
    const sizes = [
      { type: 'i', width: -1, height: -1, byteSize: 200 },
      { type: 'x', width: 800, height: 600, byteSize: 80000 },
    ];
    expect(pickPhotoSize(sizes)?.type).toBe('x');
  });
});

describe('pickVideoVariant', () => {
  it('prefers streaming variant over document attachment', () => {
    const variants = [
      { width: 1920, height: 1080, durationSec: 60, byteSize: 50000000, mimeType: 'video/mp4',
        isStreaming: true, isDocumentAttachment: false },
      { width: 3840, height: 2160, durationSec: 60, byteSize: 200000000, mimeType: 'video/mp4',
        isStreaming: false, isDocumentAttachment: true },
    ];
    expect(pickVideoVariant(variants)?.width).toBe(1920);
  });

  it('returns null if only document attachments exist (per spec policy)', () => {
    const variants = [
      { width: 3840, height: 2160, durationSec: 60, byteSize: 200000000, mimeType: 'video/mp4',
        isStreaming: false, isDocumentAttachment: true },
    ];
    expect(pickVideoVariant(variants)).toBeNull();
  });

  it('among streaming variants, picks the highest resolution', () => {
    const variants = [
      { width: 640, height: 480, durationSec: 60, byteSize: 5_000_000, mimeType: 'video/mp4',
        isStreaming: true, isDocumentAttachment: false },
      { width: 1920, height: 1080, durationSec: 60, byteSize: 50_000_000, mimeType: 'video/mp4',
        isStreaming: true, isDocumentAttachment: false },
    ];
    expect(pickVideoVariant(variants)?.width).toBe(1920);
  });
});

describe('isMediaDownloadable', () => {
  it('returns true for photo with sizes', () => {
    const ref: MediaRef = {
      kind: 'photo', mimeType: 'image/jpeg', fileName: null,
      photoSizes: [{ type: 'x', width: 800, height: 600, byteSize: 1 }],
      rawMediaToken: null,
    };
    expect(isMediaDownloadable(ref)).toBe(true);
  });

  it('returns false for video with only document attachments', () => {
    const ref: MediaRef = {
      kind: 'video', mimeType: 'video/mp4', fileName: null,
      videoVariants: [{ width: 3840, height: 2160, durationSec: 60, byteSize: 1,
        mimeType: 'video/mp4', isStreaming: false, isDocumentAttachment: true }],
      rawMediaToken: null,
    };
    expect(isMediaDownloadable(ref)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- quality`
Expected: tests fail (module not found).

- [ ] **Step 3: Implement `src/shared/quality.ts`**

```ts
import type { MediaRef, PhotoSize, VideoVariant } from './types';

export function pickPhotoSize(sizes: PhotoSize[]): PhotoSize | null {
  const real = sizes.filter((s) => s.width > 0 && s.height > 0);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

export function pickVideoVariant(variants: VideoVariant[]): VideoVariant | null {
  const streaming = variants.filter((v) => v.isStreaming && !v.isDocumentAttachment);
  if (streaming.length === 0) return null;
  return streaming.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

export function isMediaDownloadable(ref: MediaRef): boolean {
  if (ref.kind === 'photo') {
    return !!ref.photoSizes && pickPhotoSize(ref.photoSizes) !== null;
  }
  return !!ref.videoVariants && pickVideoVariant(ref.videoVariants) !== null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- quality`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/quality.ts tests/shared/quality.test.ts
git commit -m "feat(shared): quality tier and variant selection"
```

### Task 2.4: Packed seenIds codec

**Files:**
- Create: `tests/shared/seenIds.test.ts`
- Create: `src/shared/seenIds.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/seenIds.test.ts
import { describe, it, expect } from 'vitest';
import { packSeenIds, unpackSeenIds, addSeenId, hasSeenId } from '../../src/shared/seenIds';

describe('seenIds codec', () => {
  it('round-trips an empty set', () => {
    const packed = packSeenIds(new Set<number>());
    expect(unpackSeenIds(packed)).toEqual(new Set());
  });

  it('round-trips a populated set', () => {
    const ids = new Set([1, 42, 18432, 18433, 999999]);
    const packed = packSeenIds(ids);
    expect(unpackSeenIds(packed)).toEqual(ids);
  });

  it('produces compact base64url output (no padding, urlsafe)', () => {
    const packed = packSeenIds(new Set([1, 2, 3]));
    expect(packed).not.toContain('=');
    expect(packed).not.toContain('+');
    expect(packed).not.toContain('/');
  });

  it('addSeenId is idempotent', () => {
    const ids = new Set([1]);
    addSeenId(ids, 1);
    expect(ids.size).toBe(1);
    addSeenId(ids, 2);
    expect(ids.size).toBe(2);
  });

  it('hasSeenId works on a Set', () => {
    const ids = new Set([1, 2, 3]);
    expect(hasSeenId(ids, 2)).toBe(true);
    expect(hasSeenId(ids, 4)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- seenIds`
Expected: fail (module not found).

- [ ] **Step 3: Implement `src/shared/seenIds.ts`**

```ts
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function packSeenIds(ids: Set<number>): string {
  const arr = new Uint32Array(ids.size);
  let i = 0;
  for (const id of ids) arr[i++] = id;
  return base64UrlEncode(new Uint8Array(arr.buffer));
}

export function unpackSeenIds(packed: string): Set<number> {
  if (!packed) return new Set();
  const bytes = base64UrlDecode(packed);
  const arr = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return new Set(arr);
}

export function addSeenId(ids: Set<number>, id: number): void {
  ids.add(id);
}

export function hasSeenId(ids: Set<number>, id: number): boolean {
  return ids.has(id);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- seenIds`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/seenIds.ts tests/shared/seenIds.test.ts
git commit -m "feat(shared): packed Uint32Array seenIds codec"
```

### Task 2.5: FLOOD_WAIT parser + global backoff scheduler

**Files:**
- Create: `tests/shared/floodwait.test.ts`
- Create: `src/shared/floodwait.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/floodwait.test.ts
import { describe, it, expect } from 'vitest';
import { parseFloodWait, BackoffScheduler } from '../../src/shared/floodwait';

describe('parseFloodWait', () => {
  it('extracts seconds from FLOOD_WAIT_<n>', () => {
    expect(parseFloodWait('FLOOD_WAIT_30')).toBe(30);
    expect(parseFloodWait('FLOOD_WAIT_3600')).toBe(3600);
  });

  it('returns null for non-FLOOD_WAIT errors', () => {
    expect(parseFloodWait('CHAT_FORBIDDEN')).toBeNull();
    expect(parseFloodWait('')).toBeNull();
    expect(parseFloodWait('FLOOD_WAIT')).toBeNull();
  });
});

describe('BackoffScheduler', () => {
  it('starts not delayed', () => {
    const b = new BackoffScheduler({ now: () => 1000 });
    expect(b.delayUntilMs()).toBe(0);
  });

  it('applies a hold for FLOOD_WAIT seconds', () => {
    let t = 1_000_000;
    const b = new BackoffScheduler({ now: () => t });
    b.holdFor(30);
    expect(b.delayUntilMs()).toBe(30000);
    t += 10_000;
    expect(b.delayUntilMs()).toBe(20000);
    t += 25_000;
    expect(b.delayUntilMs()).toBe(0);
  });

  it('exponential backoff caps at 3 retries', () => {
    let t = 0;
    const b = new BackoffScheduler({ now: () => t });
    expect(b.recordTransientFailure()).toBe(true);  // retry #1
    expect(b.recordTransientFailure()).toBe(true);  // retry #2
    expect(b.recordTransientFailure()).toBe(true);  // retry #3
    expect(b.recordTransientFailure()).toBe(false); // exhausted
  });

  it('exponential backoff doubles wait time', () => {
    let t = 0;
    const b = new BackoffScheduler({ now: () => t, baseTransientMs: 1000 });
    b.recordTransientFailure();
    expect(b.delayUntilMs()).toBe(1000);
    t = 1000;
    b.recordTransientFailure();
    expect(b.delayUntilMs()).toBe(2000);
  });

  it('resets retry counter after a success', () => {
    let t = 0;
    const b = new BackoffScheduler({ now: () => t, baseTransientMs: 1000 });
    b.recordTransientFailure();
    b.recordTransientFailure();
    b.recordSuccess();
    expect(b.recordTransientFailure()).toBe(true); // back to retry #1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- floodwait`
Expected: fail.

- [ ] **Step 3: Implement `src/shared/floodwait.ts`**

```ts
export function parseFloodWait(message: string): number | null {
  const match = /^FLOOD_WAIT_(\d+)$/.exec(message);
  return match ? parseInt(match[1]!, 10) : null;
}

export interface BackoffOptions {
  now?: () => number;
  baseTransientMs?: number;
  maxRetries?: number;
}

export class BackoffScheduler {
  private now: () => number;
  private baseTransientMs: number;
  private maxRetries: number;
  private holdUntilMs = 0;
  private transientFailureCount = 0;

  constructor(opts: BackoffOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.baseTransientMs = opts.baseTransientMs ?? 2000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  delayUntilMs(): number {
    return Math.max(0, this.holdUntilMs - this.now());
  }

  holdFor(seconds: number): void {
    this.holdUntilMs = this.now() + seconds * 1000;
  }

  /** Returns true if we should retry, false if retries are exhausted. */
  recordTransientFailure(): boolean {
    this.transientFailureCount += 1;
    if (this.transientFailureCount > this.maxRetries) return false;
    const waitMs = this.baseTransientMs * 2 ** (this.transientFailureCount - 1);
    this.holdUntilMs = this.now() + waitMs;
    return true;
  }

  recordSuccess(): void {
    this.transientFailureCount = 0;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- floodwait`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/floodwait.ts tests/shared/floodwait.test.ts
git commit -m "feat(shared): FLOOD_WAIT parser and global backoff scheduler"
```

### Task 2.6: NDJSON row builder

**Files:**
- Create: `tests/shared/ndjson.test.ts`
- Create: `src/shared/ndjson.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/ndjson.test.ts
import { describe, it, expect } from 'vitest';
import { ndjsonRow, ndjsonAppend } from '../../src/shared/ndjson';
import type { ArchiveItem } from '../../src/shared/types';

const sampleItem: ArchiveItem = {
  messageId: 18432,
  albumGroupedId: null,
  kind: 'photo',
  filename: '2024-08-12_msg18432_photo.jpg',
  mimeType: 'image/jpeg',
  byteSize: 412330,
  dateUtc: '2024-08-12T09:14:00Z',
  fromId: 11223344,
  fromName: 'Alex',
  caption: 'First test post',
  qualityTier: 'y',
  downloadedAt: '2026-05-18T14:23:01Z',
};

describe('ndjsonRow', () => {
  it('serializes an ArchiveItem to a single-line JSON string ending in \\n', () => {
    const row = ndjsonRow(sampleItem);
    expect(row.endsWith('\n')).toBe(true);
    expect(row.split('\n')).toHaveLength(2); // payload + trailing
    expect(JSON.parse(row.trim())).toEqual(sampleItem);
  });

  it('preserves newlines inside captions by encoding them', () => {
    const item = { ...sampleItem, caption: 'line1\nline2' };
    const row = ndjsonRow(item);
    expect(row.split('\n')).toHaveLength(2); // payload + trailing only
    expect(JSON.parse(row.trim()).caption).toBe('line1\nline2');
  });
});

describe('ndjsonAppend', () => {
  it('returns existing + new row, no double newline', () => {
    const existing = ndjsonRow(sampleItem);
    const next = { ...sampleItem, messageId: 18433 };
    const out = ndjsonAppend(existing, next);
    const lines = out.split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).messageId).toBe(18433);
  });

  it('appends to empty correctly', () => {
    const out = ndjsonAppend('', sampleItem);
    expect(out.startsWith('{')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ndjson`
Expected: fail.

- [ ] **Step 3: Implement `src/shared/ndjson.ts`**

```ts
import type { ArchiveItem } from './types';

export function ndjsonRow(item: ArchiveItem): string {
  return JSON.stringify(item) + '\n';
}

export function ndjsonAppend(existing: string, item: ArchiveItem): string {
  // existing always ends in \n if non-empty
  return existing + ndjsonRow(item);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- ndjson`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ndjson.ts tests/shared/ndjson.test.ts
git commit -m "feat(shared): NDJSON row builder"
```

### Task 2.7: PostMessage envelope helpers

**Files:**
- Create: `tests/shared/envelope.test.ts`
- Create: `src/shared/envelope.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/envelope.test.ts
import { describe, it, expect } from 'vitest';
import { encodeReq, encodeRes, encodeEvt, isOurMessage, parseEnvelope } from '../../src/shared/envelope';

describe('envelope encoding', () => {
  it('encodes a request', () => {
    const e = encodeReq(42, 'getCurrentPeer');
    expect(e).toEqual({ source: 'tg-archive', kind: 'req', id: 42, op: 'getCurrentPeer', args: undefined });
  });

  it('encodes a request with args', () => {
    const e = encodeReq(7, 'getHistory', { peerId: 1, offsetId: 0, limit: 100 });
    expect(e.args).toEqual({ peerId: 1, offsetId: 0, limit: 100 });
  });

  it('encodes a success response', () => {
    const e = encodeRes(42, true, { peerId: 1 });
    expect(e).toEqual({ source: 'tg-archive', kind: 'res', id: 42, ok: true, value: { peerId: 1 } });
  });

  it('encodes an error response', () => {
    const e = encodeRes(42, false, undefined, 'FLOOD_WAIT_30');
    expect(e).toEqual({ source: 'tg-archive', kind: 'res', id: 42, ok: false, error: 'FLOOD_WAIT_30', value: undefined });
  });

  it('encodes an event', () => {
    const e = encodeEvt('downloadProgress', { messageId: 1, loaded: 100, total: 200 });
    expect(e).toMatchObject({ source: 'tg-archive', kind: 'evt', evt: 'downloadProgress' });
  });
});

describe('isOurMessage', () => {
  it('rejects foreign messages', () => {
    expect(isOurMessage({})).toBe(false);
    expect(isOurMessage(null)).toBe(false);
    expect(isOurMessage({ source: 'other' })).toBe(false);
  });
  it('accepts our envelopes', () => {
    expect(isOurMessage({ source: 'tg-archive', kind: 'req' })).toBe(true);
  });
});

describe('parseEnvelope', () => {
  it('returns null for non-envelopes', () => {
    expect(parseEnvelope({ source: 'foo' })).toBeNull();
  });
  it('parses a req envelope', () => {
    const v = parseEnvelope({ source: 'tg-archive', kind: 'req', id: 1, op: 'x' });
    expect(v?.kind).toBe('req');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- envelope`
Expected: fail.

- [ ] **Step 3: Implement `src/shared/envelope.ts`**

```ts
export const SOURCE = 'tg-archive' as const;

export type BridgeOp =
  | 'getCurrentPeer'
  | 'getHistory'
  | 'extractMediaRef'
  | 'downloadMedia';

export type BridgeEvent = 'downloadProgress' | 'bridgeReady';

export interface ReqEnvelope {
  source: typeof SOURCE;
  kind: 'req';
  id: number;
  op: BridgeOp;
  args?: unknown;
}

export interface ResEnvelope {
  source: typeof SOURCE;
  kind: 'res';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface EvtEnvelope {
  source: typeof SOURCE;
  kind: 'evt';
  evt: BridgeEvent;
  payload?: unknown;
}

export type AnyEnvelope = ReqEnvelope | ResEnvelope | EvtEnvelope;

export function encodeReq(id: number, op: BridgeOp, args?: unknown): ReqEnvelope {
  return { source: SOURCE, kind: 'req', id, op, args };
}

export function encodeRes(id: number, ok: boolean, value?: unknown, error?: string): ResEnvelope {
  return { source: SOURCE, kind: 'res', id, ok, value, error };
}

export function encodeEvt(evt: BridgeEvent, payload?: unknown): EvtEnvelope {
  return { source: SOURCE, kind: 'evt', evt, payload };
}

export function isOurMessage(m: unknown): m is { source: typeof SOURCE } {
  return typeof m === 'object' && m !== null && (m as { source?: unknown }).source === SOURCE;
}

export function parseEnvelope(m: unknown): AnyEnvelope | null {
  if (!isOurMessage(m)) return null;
  const env = m as AnyEnvelope;
  if (env.kind === 'req' || env.kind === 'res' || env.kind === 'evt') return env;
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- envelope`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/envelope.ts tests/shared/envelope.test.ts
git commit -m "feat(shared): postMessage envelope encoders and parser"
```

---

## Phase 3 — Bridge (MAIN world)

All files in this phase live in `src/bridge/`. They depend on `docs/recon.md` for exact internal names. Each function exposed to the content script gets a clear interface; the internals can change without breaking consumers.

### Task 3.1: `resolveTelegramHandles`

**Files:**
- Create: `src/bridge/resolve.ts`

> **Engineer note:** Use the exact global names recorded in `docs/recon.md` under "Manager globals confirmed present". If your recon notes differ from the names here, update this file and the consumers in Tasks 3.3–3.6 to match — *before* writing those tasks.

- [ ] **Step 1: Implement `src/bridge/resolve.ts`**

```ts
export interface TelegramHandles {
  appMessagesManager: any;
  appDownloadManager: any;
  appImManager: any;
  appPeersManager: any;
  rootScope?: any;
}

export class BridgeIncompatibleError extends Error {
  constructor(missing: string[]) {
    super(`BRIDGE_INCOMPATIBLE: missing ${missing.join(', ')}`);
    this.name = 'BridgeIncompatibleError';
  }
}

const REQUIRED: (keyof TelegramHandles)[] = [
  'appMessagesManager',
  'appDownloadManager',
  'appImManager',
  'appPeersManager',
];

export function resolveTelegramHandles(w: any = window): TelegramHandles {
  const found: Partial<TelegramHandles> = {
    appMessagesManager: w.appMessagesManager,
    appDownloadManager: w.appDownloadManager,
    appImManager: w.appImManager,
    appPeersManager: w.appPeersManager,
    rootScope: w.rootScope,
  };
  const missing = REQUIRED.filter((k) => !found[k]);
  if (missing.length > 0) throw new BridgeIncompatibleError(missing);
  return found as TelegramHandles;
}

export async function waitForTelegramHandles(
  opts: { timeoutMs?: number; intervalMs?: number; w?: any } = {}
): Promise<TelegramHandles> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 250;
  const w = opts.w ?? window;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return resolveTelegramHandles(w);
    } catch (e) {
      if (!(e instanceof BridgeIncompatibleError)) throw e;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return resolveTelegramHandles(w); // throw with final state
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/resolve.ts
git commit -m "feat(bridge): resolveTelegramHandles + wait helper"
```

### Task 3.2: `getCurrentPeer`

**Files:**
- Create: `src/bridge/peer.ts`

> **Engineer note:** This implementation uses the exact field paths recorded in `docs/recon.md` under "Peer access". If your recon notes show different paths, replace the bodies below before continuing.

- [ ] **Step 1: Implement `src/bridge/peer.ts`**

```ts
import type { TelegramHandles } from './resolve';
import type { PeerInfo, PeerId } from '../shared/types';

export function getCurrentPeer(h: TelegramHandles): PeerInfo | null {
  const peerId = h.appImManager.chat?.peerId as PeerId | undefined;
  if (!peerId) return null;

  const chat = h.appPeersManager.getPeer(peerId);
  if (!chat) return null;

  const title =
    chat.title ??
    (chat.first_name ? `${chat.first_name}${chat.last_name ? ' ' + chat.last_name : ''}` : null) ??
    String(peerId);

  // Telegram's _ field is the constructor name, e.g. 'channel', 'chat', 'user'
  const type: PeerInfo['type'] =
    chat._ === 'channel' ? 'channel' : chat._ === 'chat' ? 'chat' : 'user';

  return {
    peerId,
    title,
    username: chat.username ?? null,
    type,
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/peer.ts
git commit -m "feat(bridge): getCurrentPeer"
```

### Task 3.3: `getHistory`

**Files:**
- Create: `src/bridge/history.ts`

> **Engineer note:** The shape of `appMessagesManager.getHistory()`'s return value differs between Telegram Web K versions. Use the shape you recorded under "History pagination" in `docs/recon.md`. The wrapper below assumes `{messages: any[]}` or `{history: number[]}` + fetch-by-id; adapt as needed.

- [ ] **Step 1: Implement `src/bridge/history.ts`**

```ts
import type { TelegramHandles } from './resolve';
import type { PeerId } from '../shared/types';

export interface HistoryPage {
  messages: any[];      // raw Telegram message objects
  nextOffsetId: number; // 0 when tail reached
}

export async function getHistory(
  h: TelegramHandles,
  peerId: PeerId,
  offsetId: number,
  limit: number
): Promise<HistoryPage> {
  const result = await h.appMessagesManager.getHistory({
    peerId,
    offsetId,
    limit,
  });

  let messages: any[];
  if (Array.isArray(result?.messages)) {
    messages = result.messages;
  } else if (Array.isArray(result?.history)) {
    messages = await Promise.all(
      result.history.map((mid: number) => h.appMessagesManager.getMessageByPeer(peerId, mid))
    );
  } else {
    throw new Error('UNEXPECTED_HISTORY_SHAPE');
  }

  // Tail detection: fewer than `limit` results → next offsetId is 0
  const oldest = messages.length > 0 ? messages[messages.length - 1] : null;
  const nextOffsetId = messages.length < limit || !oldest ? 0 : oldest.id;

  return { messages, nextOffsetId };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/history.ts
git commit -m "feat(bridge): getHistory pagination wrapper"
```

### Task 3.4: `extractMediaRef`

**Files:**
- Create: `src/bridge/media.ts`

> **Engineer note:** Use the redacted message shapes in `docs/recon.md` (photo, video, GIF, album) as reference. The implementation below covers the common cases; expand as you discover edge cases during smoke testing in Phase 11.

- [ ] **Step 1: Implement `src/bridge/media.ts`**

```ts
import type { MediaRef, PhotoSize, VideoVariant, MessageMeta } from '../shared/types';

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
    fromName: null, // populated by caller if needed
    caption: msg.message ?? '',
  };

  const mediaRef = extractMediaRef(msg.media);
  return { meta, mediaRef };
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
      isStreaming: true,             // Telegram Web only attaches video docs that are streamable
      isDocumentAttachment: false,   // see note: real "original" attachments lack documentAttributeVideo
    };

    return {
      kind: 'video',
      mimeType: 'video/mp4',
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
      out.push({ type: s.type, width: s.w, height: s.h, byteSize: Math.max(...(s.sizes ?? [0])) });
    } else if (s._ === 'photoSize') {
      out.push({ type: s.type, width: s.w, height: s.h, byteSize: s.size ?? null });
    }
    // photoSizeStripped / photoCachedSize → skip (preview-only)
  }
  return out;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/media.ts
git commit -m "feat(bridge): extractMediaRef + message normalizer"
```

### Task 3.5: `downloadMedia` (returns a Blob)

**Files:**
- Create: `src/bridge/download.ts`

> **Engineer note:** This is the part flagged in the spec as needing prototyping. Use the path your recon notes confirmed under "Media download". The code below tries path (a) first — `appDownloadManager.download()` returning a Blob — and falls back to path (b), monkey-patching `URL.createObjectURL` around `downloadToDisc`.

- [ ] **Step 1: Implement `src/bridge/download.ts`**

```ts
import type { TelegramHandles } from './resolve';

export interface DownloadProgressCallback {
  (loaded: number, total: number): void;
}

export async function downloadMedia(
  h: TelegramHandles,
  rawMedia: any,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Blob> {
  const adm = h.appDownloadManager;

  // Path (a): inner download() returning a Blob (preferred).
  if (typeof adm.download === 'function') {
    try {
      const result = adm.download({ media: rawMedia, fileName });
      const subscribeProgress = (p: any) =>
        onProgress?.(p?.done ?? p?.loaded ?? 0, p?.total ?? p?.size ?? 0);
      if (typeof result?.addEventListener === 'function') {
        result.addEventListener('progress', subscribeProgress);
      } else if (typeof result?.notify === 'function') {
        // CancellablePromise pattern: result.notify is fired by Telegram on progress
        result.notify = subscribeProgress;
      }
      const out = await result;
      if (out instanceof Blob) return out;
      // Some versions resolve to a Uint8Array or {bytes, type}
      if (out && typeof out === 'object' && 'bytes' in out) {
        return new Blob([out.bytes as ArrayBuffer], { type: out.type ?? 'application/octet-stream' });
      }
      if (out instanceof Uint8Array) {
        return new Blob([out]);
      }
    } catch (e) {
      // fall through to path (b)
      console.warn('[bridge] adm.download failed, trying downloadToDisc fallback:', e);
    }
  }

  // Path (b): monkey-patch URL.createObjectURL to intercept the Blob.
  return new Promise<Blob>((resolve, reject) => {
    const origCreate = URL.createObjectURL.bind(URL);
    let captured = false;
    URL.createObjectURL = (b: Blob | MediaSource) => {
      if (!captured && b instanceof Blob) {
        captured = true;
        URL.createObjectURL = origCreate;
        resolve(b);
      }
      return origCreate(b);
    };

    try {
      const p = adm.downloadToDisc({ media: rawMedia, fileName });
      Promise.resolve(p).catch((e: any) => {
        URL.createObjectURL = origCreate;
        if (!captured) reject(e);
      });
      // Safety timeout — if Telegram never produces a Blob (e.g. some media type
      // routes around URL.createObjectURL), bail out so the worker isn't held forever.
      setTimeout(() => {
        if (!captured) {
          URL.createObjectURL = origCreate;
          reject(new Error('DOWNLOAD_TIMEOUT'));
        }
      }, 5 * 60 * 1000);
    } catch (e) {
      URL.createObjectURL = origCreate;
      reject(e);
    }
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/download.ts
git commit -m "feat(bridge): downloadMedia with adm.download + downloadToDisc fallback"
```

### Task 3.6: Bridge entry — wire everything together

**Files:**
- Create: `src/bridge/bridge.ts`

- [ ] **Step 1: Implement bridge entry**

```ts
import {
  encodeRes,
  encodeEvt,
  parseEnvelope,
  type ReqEnvelope,
} from '../shared/envelope';
import { waitForTelegramHandles, BridgeIncompatibleError } from './resolve';
import { getCurrentPeer } from './peer';
import { getHistory } from './history';
import { extractMessage } from './media';
import { downloadMedia } from './download';

const log = (...args: unknown[]) => console.log('[tg-archive/bridge]', ...args);

async function main() {
  log('starting');
  const handles = await waitForTelegramHandles();
  log('handles resolved');

  window.postMessage(encodeEvt('bridgeReady'), '*');

  window.addEventListener('message', async (ev: MessageEvent) => {
    const env = parseEnvelope(ev.data);
    if (!env || env.kind !== 'req') return;
    const req = env as ReqEnvelope;

    try {
      const value = await handleReq(req);
      window.postMessage(encodeRes(req.id, true, value), '*');
    } catch (e: any) {
      const msg = e instanceof BridgeIncompatibleError ? e.message : (e?.message ?? String(e));
      window.postMessage(encodeRes(req.id, false, undefined, msg), '*');
    }
  });

  async function handleReq(req: ReqEnvelope): Promise<unknown> {
    switch (req.op) {
      case 'getCurrentPeer':
        return getCurrentPeer(handles);

      case 'getHistory': {
        const a = req.args as { peerId: number; offsetId: number; limit: number };
        const page = await getHistory(handles, a.peerId, a.offsetId, a.limit);
        return {
          messages: page.messages.map((m) => extractMessage(m)),
          nextOffsetId: page.nextOffsetId,
        };
      }

      case 'extractMediaRef': {
        const a = req.args as { message: any };
        return extractMessage(a.message);
      }

      case 'downloadMedia': {
        const a = req.args as { rawMediaToken: any; fileName: string; requestId: number };
        const blob = await downloadMedia(handles, a.rawMediaToken, a.fileName, (loaded, total) => {
          window.postMessage(
            encodeEvt('downloadProgress', { requestId: a.requestId, loaded, total }),
            '*'
          );
        });
        // postMessage transfers the Blob to the content script via structured clone
        return { blob };
      }
    }
  }
}

main().catch((e) => log('fatal', e));
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/bridge.ts
git commit -m "feat(bridge): wire bridge entry to request router"
```

---

## Phase 4 — Service worker base

### Task 4.1: SW skeleton + message router

**Files:**
- Create: `src/background/router.ts`
- Create: `src/background/service-worker.ts`

- [ ] **Step 1: Implement `src/background/router.ts`**

```ts
export type SwRequest =
  | { kind: 'init'; peerId: number; title: string; username: string | null }
  | { kind: 'getState'; peerId: number }
  | { kind: 'recordSeen'; peerId: number; messageIds: number[]; cursor: { offsetId: number } }
  | { kind: 'recordItem'; peerId: number; item: import('../shared/types').ArchiveItem; bytes: ArrayBuffer; mimeType: string }
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
    if ((req as any)?.target === 'offscreen') return false;
    handler(req, sender)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
    return true; // async
  });
}
```

- [ ] **Step 2: Implement `src/background/service-worker.ts`**

```ts
import { installRouter, type SwHandler } from './router';

const log = (...args: unknown[]) => console.log('[tg-archive/sw]', ...args);

const handler: SwHandler = async (req, _sender) => {
  log('req', req.kind);
  switch (req.kind) {
    case 'heartbeat':
      return { ok: true, value: { now: Date.now() } };
    default:
      return { ok: false, error: `UNHANDLED: ${req.kind}` };
  }
};

installRouter(handler);
log('service worker booted');
```

- [ ] **Step 3: Build and verify the SW loads**

Run: `npm run build`
Expected: `dist/` contains `background/service-worker.js`, `bridge/bridge.js`, `content/content.js` (empty for now is OK if file doesn't exist), `manifest.json`, etc.

If `content/content.js` is missing because `src/content/content.ts` doesn't exist yet, create an empty stub:

```ts
// src/content/content.ts
console.log('[tg-archive/content] stub');
```

Then rerun build.

- [ ] **Step 4: Load the extension in Chrome**

Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `dist/`.
Open the service worker's "Inspect views" link in the extensions page.
Expected: console shows `[tg-archive/sw] service worker booted`.

- [ ] **Step 5: Commit**

```bash
git add src/background/router.ts src/background/service-worker.ts src/content/content.ts
git commit -m "feat(sw): skeleton service worker with message router"
```

### Task 4.2: `chrome.storage.local` wrappers

**Files:**
- Create: `src/background/storage.ts`

- [ ] **Step 1: Implement storage wrappers**

```ts
import { packSeenIds, unpackSeenIds } from '../shared/seenIds';
import type { Counts, Cursor, ArchiveStatus } from '../shared/types';

export interface ArchiveState {
  peerId: number;
  title: string;
  username: string | null;
  startedAt: string;
  lastUpdatedAt: string;
  cursor: Cursor;
  seenIds: Set<number>;
  counts: Counts;
  status: ArchiveStatus;
}

interface StoredArchiveState {
  peerId: number;
  title: string;
  username: string | null;
  startedAt: string;
  lastUpdatedAt: string;
  cursor: Cursor;
  seenIds: string; // packed
  counts: Counts;
  status: ArchiveStatus;
}

const key = (peerId: number) => `archive:${peerId}`;

export async function readArchive(peerId: number): Promise<ArchiveState | null> {
  const raw = (await chrome.storage.local.get(key(peerId)))[key(peerId)] as StoredArchiveState | undefined;
  if (!raw) return null;
  return { ...raw, seenIds: unpackSeenIds(raw.seenIds) };
}

export async function writeArchive(state: ArchiveState): Promise<void> {
  const stored: StoredArchiveState = {
    ...state,
    seenIds: packSeenIds(state.seenIds),
    lastUpdatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [key(state.peerId)]: stored });
}

export async function listArchives(): Promise<ArchiveState[]> {
  const all = await chrome.storage.local.get(null);
  const out: ArchiveState[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('archive:')) {
      const s = v as StoredArchiveState;
      out.push({ ...s, seenIds: unpackSeenIds(s.seenIds) });
    }
  }
  return out;
}

export function newArchiveState(opts: { peerId: number; title: string; username: string | null }): ArchiveState {
  const now = new Date().toISOString();
  return {
    peerId: opts.peerId,
    title: opts.title,
    username: opts.username,
    startedAt: now,
    lastUpdatedAt: now,
    cursor: { offsetId: 0 },
    seenIds: new Set(),
    counts: { downloaded: 0, skipped: 0, failed: 0 },
    status: 'in_progress',
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/background/storage.ts
git commit -m "feat(sw): chrome.storage.local wrappers for ArchiveState"
```

### Task 4.3: IndexedDB wrapper for NDJSON content

**Files:**
- Create: `src/background/idb.ts`

- [ ] **Step 1: Implement IDB wrappers**

```ts
const DB_NAME = 'tg-archive';
const DB_VERSION = 1;
const STORE = 'ndjson';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const r = fn(s);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );
}

export function readNdjson(peerId: number): Promise<string> {
  return tx<string | undefined>('readonly', (s) => s.get(String(peerId))).then((v) => v ?? '');
}

export function writeNdjson(peerId: number, content: string): Promise<unknown> {
  return tx('readwrite', (s) => s.put(content, String(peerId)));
}

export function deleteNdjson(peerId: number): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(String(peerId)));
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/background/idb.ts
git commit -m "feat(sw): IndexedDB wrappers for NDJSON storage"
```

### Task 4.4: Notifications wrapper

**Files:**
- Create: `src/background/notifications.ts`

- [ ] **Step 1: Implement**

```ts
export function notify(id: string, title: string, message: string) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title,
    message,
    priority: 1,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/background/notifications.ts
git commit -m "feat(sw): notifications helper"
```

### Task 4.5: Service-worker keepalive

**Files:**
- Create: `src/background/keepalive.ts`

- [ ] **Step 1: Implement keepalive port handling**

```ts
// The content script opens a long-lived port for the duration of an active job.
// As long as the port is open, the service worker is kept alive.

let active = 0;

export function installKeepalive() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'tg-archive-keepalive') return;
    active++;
    console.log('[tg-archive/sw] keepalive ↑', active);
    port.onDisconnect.addListener(() => {
      active--;
      console.log('[tg-archive/sw] keepalive ↓', active);
    });
  });
}

export function activeCount(): number {
  return active;
}
```

- [ ] **Step 2: Wire into service worker**

Modify: `src/background/service-worker.ts`

Add at top:
```ts
import { installKeepalive } from './keepalive';
```

Add before `installRouter(handler)`:
```ts
installKeepalive();
```

- [ ] **Step 3: Commit**

```bash
git add src/background/keepalive.ts src/background/service-worker.ts
git commit -m "feat(sw): long-lived port keepalive"
```

---

## Phase 5 — Offscreen document

### Task 5.1: Offscreen doc for Blob→objectURL

**Files:**
- Create: `src/offscreen/offscreen.html`
- Create: `src/offscreen/offscreen.ts`

- [ ] **Step 1: Implement `src/offscreen/offscreen.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>offscreen</title></head>
<body><script type="module" src="offscreen.js"></script></body></html>
```

- [ ] **Step 2: Implement `src/offscreen/offscreen.ts`**

```ts
type Msg =
  | { kind: 'bytesToUrl'; bytes: ArrayBuffer; mimeType: string }
  | { kind: 'revoke'; url: string };

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if ((msg as any).target !== 'offscreen') return;
  if (msg.kind === 'bytesToUrl') {
    const blob = new Blob([msg.bytes], { type: msg.mimeType });
    const url = URL.createObjectURL(blob);
    sendResponse({ ok: true, value: { url } });
    return;
  }
  if (msg.kind === 'revoke') {
    URL.revokeObjectURL(msg.url);
    sendResponse({ ok: true, value: null });
    return;
  }
});
```

> **Why `ArrayBuffer` instead of `Blob`:** `chrome.runtime.sendMessage` does not reliably structured-clone `Blob` across contexts. `ArrayBuffer` does survive. The Blob is reconstructed inside the offscreen document, which is itself a normal browser context where `URL.createObjectURL` works and the resulting URL is scoped to the extension origin (so `chrome.downloads.download` can resolve it).

- [ ] **Step 3: Add offscreen creation helper in background**

Create: `src/background/offscreen-client.ts`

```ts
let creating: Promise<void> | null = null;
const OFFSCREEN_URL = 'offscreen/offscreen.html';

async function ensure() {
  // @ts-expect-error chrome.offscreen.hasDocument exists in MV3 but types lag
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  if (creating) return creating;
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Hold Blob URLs alive for chrome.downloads',
  });
  try { await creating; } finally { creating = null; }
}

export async function bytesToObjectUrl(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  await ensure();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    kind: 'bytesToUrl',
    bytes,
    mimeType,
  });
  if (!res?.ok) throw new Error(res?.error ?? 'OFFSCREEN_FAILED');
  return res.value.url as string;
}

export async function revokeObjectUrl(url: string): Promise<void> {
  await chrome.runtime.sendMessage({ target: 'offscreen', kind: 'revoke', url });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/ src/background/offscreen-client.ts
git commit -m "feat(offscreen): blob→objectURL bridge for chrome.downloads"
```

---

## Phase 6 — Service worker downloads + manifest persistence

### Task 6.1: Download orchestrator

**Files:**
- Create: `src/background/downloads.ts`

- [ ] **Step 1: Implement**

```ts
import { bytesToObjectUrl, revokeObjectUrl } from './offscreen-client';
import { channelSlug } from '../shared/filename';

export interface DownloadInput {
  bytes: ArrayBuffer;
  mimeType: string;
  channelTitle: string;
  peerId: number;
  filename: string; // relative filename within channel folder
}

export async function downloadBlob(input: DownloadInput): Promise<{ downloadId: number; relPath: string }> {
  const folder = `TelegramArchive/${channelSlug(input.channelTitle)}__${input.peerId}`;
  const relPath = `${folder}/${input.filename}`;
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

function waitForCompletion(id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onChange = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(onChange);
        resolve();
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChange);
        reject(new Error(`DOWNLOAD_INTERRUPTED: ${delta.error?.current ?? 'unknown'}`));
      }
    };
    chrome.downloads.onChanged.addListener(onChange);
  });
}

export interface OverwriteInput {
  text: string;
  channelTitle: string;
  peerId: number;
  filename: string;
}

export async function downloadTextOverwrite(input: OverwriteInput): Promise<void> {
  const folder = `TelegramArchive/${channelSlug(input.channelTitle)}__${input.peerId}`;
  const relPath = `${folder}/${input.filename}`;
  const bytes = new TextEncoder().encode(input.text).buffer;
  const url = await bytesToObjectUrl(bytes, 'application/json');
  try {
    const id = await chrome.downloads.download({
      url,
      filename: relPath,
      conflictAction: 'overwrite',
      saveAs: false,
    });
    await waitForCompletion(id);
  } finally {
    await revokeObjectUrl(url);
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/background/downloads.ts
git commit -m "feat(sw): download orchestrator (uniquify for media, overwrite for manifest)"
```

### Task 6.2: Manifest.json writer

**Files:**
- Create: `src/background/manifest-writer.ts`

- [ ] **Step 1: Implement**

```ts
import type { ArchiveState, ArchiveFailure } from '../shared/types';
import { downloadTextOverwrite } from './downloads';

export interface ManifestDoc {
  schemaVersion: 1;
  peerId: number;
  channel: { title: string; username: string | null; archivedAt: string };
  progress: {
    status: ArchiveState['status'];
    cursor: ArchiveState['cursor'];
    lastUpdatedAt: string;
    counts: ArchiveState['counts'];
  };
  failures: ArchiveFailure[];
}

export function buildManifest(state: ArchiveState, failures: ArchiveFailure[]): ManifestDoc {
  return {
    schemaVersion: 1,
    peerId: state.peerId,
    channel: {
      title: state.title,
      username: state.username,
      archivedAt: state.startedAt,
    },
    progress: {
      status: state.status,
      cursor: state.cursor,
      lastUpdatedAt: state.lastUpdatedAt,
      counts: state.counts,
    },
    failures,
  };
}

export async function writeManifest(state: ArchiveState, failures: ArchiveFailure[]): Promise<void> {
  const doc = buildManifest(state, failures);
  await downloadTextOverwrite({
    text: JSON.stringify(doc, null, 2),
    channelTitle: state.title,
    peerId: state.peerId,
    filename: 'manifest.json',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/background/manifest-writer.ts
git commit -m "feat(sw): manifest.json builder + flusher"
```

### Task 6.3: NDJSON writer

**Files:**
- Create: `src/background/ndjson-writer.ts`

- [ ] **Step 1: Implement**

```ts
import { readNdjson, writeNdjson } from './idb';
import { ndjsonAppend } from '../shared/ndjson';
import { downloadTextOverwrite } from './downloads';
import type { ArchiveItem, ArchiveState } from '../shared/types';

export async function appendItem(state: ArchiveState, item: ArchiveItem): Promise<void> {
  const existing = await readNdjson(state.peerId);
  const next = ndjsonAppend(existing, item);
  await writeNdjson(state.peerId, next);
}

export async function flushItemsToDisk(state: ArchiveState): Promise<void> {
  const content = await readNdjson(state.peerId);
  await downloadTextOverwrite({
    text: content,
    channelTitle: state.title,
    peerId: state.peerId,
    filename: 'items.ndjson',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/background/ndjson-writer.ts
git commit -m "feat(sw): NDJSON writer (IDB-backed, batched flush to disk)"
```

### Task 6.4: SW message handlers — record item, record failure, persist

**Files:**
- Modify: `src/background/service-worker.ts`

- [ ] **Step 1: Replace the placeholder handler with the real one**

```ts
import { installRouter, type SwHandler } from './router';
import { installKeepalive } from './keepalive';
import { readArchive, writeArchive, newArchiveState } from './storage';
import { downloadBlob } from './downloads';
import { writeManifest } from './manifest-writer';
import { appendItem, flushItemsToDisk } from './ndjson-writer';
import { notify } from './notifications';
import type { ArchiveFailure, ArchiveItem } from '../shared/types';

const log = (...args: unknown[]) => console.log('[tg-archive/sw]', ...args);

const failuresByPeer = new Map<number, ArchiveFailure[]>();
const dirtyByPeer = new Map<number, { itemsSinceFlush: number; lastFlushMs: number }>();
const FLUSH_EVERY_ITEMS = 50;
const FLUSH_EVERY_MS = 30_000;

async function maybeFlush(peerId: number, force = false) {
  const state = await readArchive(peerId);
  if (!state) return;
  const dirty = dirtyByPeer.get(peerId) ?? { itemsSinceFlush: 0, lastFlushMs: 0 };
  const due = force ||
    dirty.itemsSinceFlush >= FLUSH_EVERY_ITEMS ||
    Date.now() - dirty.lastFlushMs >= FLUSH_EVERY_MS;
  if (!due) return;
  await flushItemsToDisk(state);
  await writeManifest(state, failuresByPeer.get(peerId) ?? []);
  dirtyByPeer.set(peerId, { itemsSinceFlush: 0, lastFlushMs: Date.now() });
}

const handler: SwHandler = async (req) => {
  log('req', req.kind);
  switch (req.kind) {
    case 'init': {
      let state = await readArchive(req.peerId);
      if (!state) {
        state = newArchiveState({ peerId: req.peerId, title: req.title, username: req.username });
        await writeArchive(state);
      }
      return { ok: true, value: state };
    }

    case 'getState': {
      const state = await readArchive(req.peerId);
      return { ok: true, value: state };
    }

    case 'recordSeen': {
      const state = await readArchive(req.peerId);
      if (!state) return { ok: false, error: 'NO_STATE' };
      for (const id of req.messageIds) state.seenIds.add(id);
      state.cursor = req.cursor;
      await writeArchive(state);
      return { ok: true, value: null };
    }

    case 'recordItem': {
      const state = await readArchive(req.peerId);
      if (!state) return { ok: false, error: 'NO_STATE' };
      const { relPath } = await downloadBlob({
        bytes: req.bytes,
        mimeType: req.mimeType,
        channelTitle: state.title,
        peerId: state.peerId,
        filename: req.item.filename,
      });
      const finalItem: ArchiveItem = {
        ...req.item,
        filename: relPath.split('/').pop() ?? req.item.filename, // Chrome uniquify may have changed it
        downloadedAt: new Date().toISOString(),
      };
      await appendItem(state, finalItem);
      state.seenIds.add(finalItem.messageId);
      state.counts.downloaded += 1;
      await writeArchive(state);
      const d = dirtyByPeer.get(req.peerId) ?? { itemsSinceFlush: 0, lastFlushMs: 0 };
      d.itemsSinceFlush += 1;
      dirtyByPeer.set(req.peerId, d);
      await maybeFlush(req.peerId);
      return { ok: true, value: { filename: finalItem.filename } };
    }

    case 'recordFailure': {
      const arr = failuresByPeer.get(req.peerId) ?? [];
      arr.push(req.failure);
      failuresByPeer.set(req.peerId, arr);
      const state = await readArchive(req.peerId);
      if (state) {
        state.counts.failed += 1;
        await writeArchive(state);
      }
      await maybeFlush(req.peerId);
      return { ok: true, value: null };
    }

    case 'flushPersist': {
      await maybeFlush(req.peerId, true);
      return { ok: true, value: null };
    }

    case 'complete': {
      const state = await readArchive(req.peerId);
      if (!state) return { ok: false, error: 'NO_STATE' };
      state.status = 'completed';
      await writeArchive(state);
      await maybeFlush(req.peerId, true);
      notify(`done-${req.peerId}`, 'Archive complete',
        `${state.title}: ${state.counts.downloaded} downloaded, ${state.counts.failed} failed.`);
      return { ok: true, value: null };
    }

    case 'heartbeat':
      return { ok: true, value: { now: Date.now() } };

    case 'getPeerProgress': {
      const state = await readArchive(req.peerId);
      return { ok: true, value: state ? { counts: state.counts, status: state.status, cursor: state.cursor } : null };
    }
  }
};

installKeepalive();
installRouter(handler);
log('service worker booted');
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: exits 0.

Reload extension at `chrome://extensions`. Open service worker inspect view.
Expected: `service worker booted` log.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat(sw): wire record/persist/complete handlers with batched flush"
```

---

## Phase 7 — Content script (ISOLATED world)

### Task 7.1: Bridge client (postMessage RPC over `window`)

**Files:**
- Create: `src/content/bridge-client.ts`

- [ ] **Step 1: Implement**

```ts
import {
  encodeReq,
  parseEnvelope,
  type AnyEnvelope,
  type BridgeOp,
  type BridgeEvent,
} from '../shared/envelope';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type EventListener = (payload: unknown) => void;

export class BridgeClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<BridgeEvent, Set<EventListener>>();
  private readyResolvers: Array<() => void> = [];
  private isReady = false;

  constructor() {
    window.addEventListener('message', (ev) => this.onMessage(ev));
  }

  private onMessage(ev: MessageEvent) {
    const env = parseEnvelope(ev.data) as AnyEnvelope | null;
    if (!env) return;
    if (env.kind === 'res') {
      const p = this.pending.get(env.id);
      if (!p) return;
      this.pending.delete(env.id);
      if (env.ok) p.resolve(env.value);
      else p.reject(new Error(env.error ?? 'BRIDGE_ERROR'));
    } else if (env.kind === 'evt') {
      if (env.evt === 'bridgeReady') {
        this.isReady = true;
        this.readyResolvers.splice(0).forEach((r) => r());
        return;
      }
      const set = this.listeners.get(env.evt);
      set?.forEach((l) => l(env.payload));
    }
  }

  call<T = unknown>(op: BridgeOp, args?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      window.postMessage(encodeReq(id, op, args), '*');
    });
  }

  on(evt: BridgeEvent, fn: EventListener) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt)!.add(fn);
  }

  off(evt: BridgeEvent, fn: EventListener) {
    this.listeners.get(evt)?.delete(fn);
  }

  ready(timeoutMs = 30_000): Promise<void> {
    if (this.isReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('BRIDGE_NOT_READY')), timeoutMs);
      this.readyResolvers.push(() => { clearTimeout(t); resolve(); });
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/bridge-client.ts
git commit -m "feat(content): bridge RPC client"
```

### Task 7.2: SW client + keepalive port

**Files:**
- Create: `src/content/sw-client.ts`

- [ ] **Step 1: Implement**

```ts
import type { SwRequest, SwResponse } from '../background/router';

export async function callSw<T = unknown>(req: SwRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as SwResponse<T>;
  if (!res?.ok) throw new Error(res?.error ?? 'SW_FAILED');
  return res.value;
}

export function openKeepalivePort(): chrome.runtime.Port {
  return chrome.runtime.connect({ name: 'tg-archive-keepalive' });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/sw-client.ts
git commit -m "feat(content): SW client + keepalive port helpers"
```

### Task 7.3: Channel walker

**Files:**
- Create: `src/content/walker.ts`

- [ ] **Step 1: Implement**

```ts
import type { BridgeClient } from './bridge-client';
import type { MediaRef, MessageMeta } from '../shared/types';
import { isMediaDownloadable } from '../shared/quality';

export interface WalkPage {
  items: { meta: MessageMeta; mediaRef: MediaRef }[];
  skippedIds: number[];
  nextOffsetId: number;
}

export async function walkPage(
  bridge: BridgeClient,
  peerId: number,
  offsetId: number,
  limit: number
): Promise<WalkPage> {
  const page = await bridge.call<{ messages: { meta: MessageMeta; mediaRef: MediaRef | null }[]; nextOffsetId: number }>(
    'getHistory',
    { peerId, offsetId, limit }
  );

  const items: WalkPage['items'] = [];
  const skippedIds: number[] = [];
  for (const m of page.messages) {
    if (!m.mediaRef) {
      skippedIds.push(m.meta.messageId);
      continue;
    }
    if (!isMediaDownloadable(m.mediaRef)) {
      skippedIds.push(m.meta.messageId);
      continue;
    }
    items.push({ meta: m.meta, mediaRef: m.mediaRef });
  }

  return { items, skippedIds, nextOffsetId: page.nextOffsetId };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/walker.ts
git commit -m "feat(content): single-page channel walker"
```

### Task 7.4: Bounded-concurrency download pool with global FLOOD_WAIT backoff

**Files:**
- Create: `src/content/pool.ts`

- [ ] **Step 1: Implement**

```ts
import { BackoffScheduler, parseFloodWait } from '../shared/floodwait';

export interface PoolJob<T> {
  id: string | number;
  run: () => Promise<T>;
  onSuccess?: (v: T) => void | Promise<void>;
  onFailure?: (e: Error) => void | Promise<void>;
}

export class DownloadPool {
  private inFlight = 0;
  private queue: PoolJob<unknown>[] = [];
  private backoff = new BackoffScheduler();
  private paused = false;
  private drainResolvers: Array<() => void> = [];

  constructor(private readonly concurrency = 3) {}

  enqueue<T>(job: PoolJob<T>) {
    this.queue.push(job as PoolJob<unknown>);
    this.tick();
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.tick(); }

  async drain(): Promise<void> {
    if (this.inFlight === 0 && this.queue.length === 0) return;
    return new Promise((r) => this.drainResolvers.push(r));
  }

  private async tick() {
    if (this.paused) return;
    const delay = this.backoff.delayUntilMs();
    if (delay > 0) {
      setTimeout(() => this.tick(), delay);
      return;
    }
    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inFlight++;
      this.runJob(job);
    }
  }

  private async runJob(job: PoolJob<unknown>) {
    try {
      const v = await job.run();
      this.backoff.recordSuccess();
      await job.onSuccess?.(v);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const fw = parseFloodWait(msg);
      if (fw !== null) {
        this.backoff.holdFor(fw);
        this.queue.unshift(job); // retry the same job
      } else {
        const shouldRetry = this.backoff.recordTransientFailure();
        if (shouldRetry) {
          this.queue.unshift(job);
        } else {
          await job.onFailure?.(e instanceof Error ? e : new Error(msg));
        }
      }
    } finally {
      this.inFlight--;
      if (this.inFlight === 0 && this.queue.length === 0) {
        this.drainResolvers.splice(0).forEach((r) => r());
      } else {
        this.tick();
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/pool.ts
git commit -m "feat(content): bounded-concurrency pool with FLOOD_WAIT backoff"
```

### Task 7.5: Lifecycle watcher (peer change / navigation / tab close)

**Files:**
- Create: `src/content/lifecycle.ts`

- [ ] **Step 1: Implement**

```ts
type ChangeCallback = () => void;

export class LifecycleWatcher {
  private peerObserver: MutationObserver | null = null;
  private currentUrl = location.href;
  private lastPeerId: number | null = null;
  private callbacks = new Set<ChangeCallback>();

  start(getCurrentPeerId: () => number | null) {
    this.lastPeerId = getCurrentPeerId();

    // URL change detection (single-page navigation)
    const checkUrl = () => {
      if (location.href !== this.currentUrl) {
        this.currentUrl = location.href;
        this.fire();
      }
    };
    setInterval(checkUrl, 500);

    // Peer change detection (channel switch within Web K)
    setInterval(() => {
      const now = getCurrentPeerId();
      if (now !== this.lastPeerId) {
        this.lastPeerId = now;
        this.fire();
      }
    }, 1000);

    // Tab close / beforeunload
    window.addEventListener('beforeunload', () => this.fire());
  }

  onChange(cb: ChangeCallback) { this.callbacks.add(cb); }

  private fire() { for (const cb of this.callbacks) cb(); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/lifecycle.ts
git commit -m "feat(content): tab/peer lifecycle watcher"
```

### Task 7.6: Overlay panel (UI)

**Files:**
- Create: `src/content/ui/panel.css`
- Create: `src/content/ui/panel.ts`

- [ ] **Step 1: Create `src/content/ui/panel.css`**

```css
.tga-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 320px;
  background: #1c2733;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, .4);
  z-index: 2147483647;
  padding: 12px 14px;
}
.tga-panel h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.tga-panel .tga-progress { font-variant-numeric: tabular-nums; margin: 6px 0; }
.tga-panel .tga-row { display: flex; justify-content: space-between; margin: 2px 0; }
.tga-panel button {
  background: #4a6e8a;
  border: none;
  color: #fff;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 6px;
  margin-top: 8px;
}
.tga-panel button:disabled { opacity: .5; cursor: default; }
.tga-panel .tga-error { color: #ff8888; margin-top: 6px; }
```

- [ ] **Step 2: Inject the CSS as a chrome.scripting.executeScript inline style at content-script start.**

Add to: `src/content/ui/panel.ts`

```ts
const PANEL_ID = 'tga-panel';

export interface PanelView {
  title: string;
  status: 'idle' | 'walking' | 'downloading' | 'paused' | 'completed' | 'error';
  found: number;
  downloaded: number;
  failed: number;
  bandwidthBps: number;
  etaSec: number | null;
  error?: string;
}

export interface PanelCallbacks {
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export class Panel {
  private root: HTMLDivElement;
  constructor(private cbs: PanelCallbacks) {
    this.injectCss();
    this.root = this.build();
    document.documentElement.appendChild(this.root);
  }

  private injectCss() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/panel.css');
    document.documentElement.appendChild(link);
  }

  private build(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'tga-panel';
    el.innerHTML = `
      <h3 data-tga="title">Telegram Channel Archiver</h3>
      <div class="tga-row"><span>Status</span><span data-tga="status">idle</span></div>
      <div class="tga-row"><span>Found</span><span data-tga="found">0</span></div>
      <div class="tga-row"><span>Downloaded</span><span data-tga="downloaded">0</span></div>
      <div class="tga-row"><span>Failed</span><span data-tga="failed">0</span></div>
      <div class="tga-row"><span>Bandwidth</span><span data-tga="bw">0 KB/s</span></div>
      <div class="tga-row"><span>ETA</span><span data-tga="eta">—</span></div>
      <div data-tga="error" class="tga-error" style="display:none"></div>
      <div>
        <button data-tga="start">Archive this channel</button>
        <button data-tga="pause" disabled>Pause</button>
        <button data-tga="cancel" disabled>Cancel</button>
      </div>
    `;
    el.querySelector<HTMLButtonElement>('[data-tga="start"]')!.onclick = () => this.cbs.onStart();
    el.querySelector<HTMLButtonElement>('[data-tga="pause"]')!.onclick = () => this.cbs.onPause();
    el.querySelector<HTMLButtonElement>('[data-tga="cancel"]')!.onclick = () => this.cbs.onCancel();
    return el;
  }

  update(view: PanelView) {
    const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
      this.root.querySelector<T>(`[data-tga="${sel}"]`)!;
    $('title').textContent = view.title;
    $('status').textContent = view.status;
    $('found').textContent = String(view.found);
    $('downloaded').textContent = String(view.downloaded);
    $('failed').textContent = String(view.failed);
    $('bw').textContent = formatBps(view.bandwidthBps);
    $('eta').textContent = view.etaSec === null ? '—' : formatEta(view.etaSec);
    const errEl = $('error');
    if (view.error) { errEl.textContent = view.error; errEl.style.display = ''; }
    else { errEl.style.display = 'none'; }

    const start = $<HTMLButtonElement>('start');
    const pause = $<HTMLButtonElement>('pause');
    const cancel = $<HTMLButtonElement>('cancel');
    const running = view.status === 'walking' || view.status === 'downloading';
    start.disabled = running || view.status === 'completed';
    start.textContent = view.status === 'paused' ? 'Resume' : 'Archive this channel';
    pause.disabled = !running;
    cancel.disabled = view.status === 'idle' || view.status === 'completed';
  }
}

function formatBps(bps: number): string {
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bps / 1024).toFixed(0)} KB/s`;
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
```

- [ ] **Step 3: Make panel.css web-accessible**

Modify: `public/manifest.json`

Replace `"web_accessible_resources": []` with:

```json
"web_accessible_resources": [
  { "resources": ["content/panel.css"], "matches": ["https://web.telegram.org/*"] }
]
```

- [ ] **Step 4: Commit**

```bash
git add src/content/ui/ public/manifest.json
git commit -m "feat(content): overlay panel UI + CSS"
```

### Task 7.7: Content script entry — orchestration

**Files:**
- Modify: `src/content/content.ts`

- [ ] **Step 1: Replace the stub with the full orchestrator**

```ts
import { BridgeClient } from './bridge-client';
import { callSw, openKeepalivePort } from './sw-client';
import { walkPage } from './walker';
import { DownloadPool } from './pool';
import { LifecycleWatcher } from './lifecycle';
import { Panel, type PanelView } from './ui/panel';
import type { PeerInfo, MediaRef, MessageMeta, ArchiveItem } from '../shared/types';
import { mediaFilename } from '../shared/filename';
import { pickPhotoSize, pickVideoVariant } from '../shared/quality';

const PAGE_LIMIT = 100;
const CONCURRENCY = 3;

const bridge = new BridgeClient();
const panel = new Panel({ onStart, onPause, onResume, onCancel });
const watcher = new LifecycleWatcher();

let view: PanelView = {
  title: 'No channel open',
  status: 'idle',
  found: 0,
  downloaded: 0,
  failed: 0,
  bandwidthBps: 0,
  etaSec: null,
};
let currentPeer: PeerInfo | null = null;
let pool: DownloadPool | null = null;
let keepalivePort: chrome.runtime.Port | null = null;
let cancelled = false;
let bytesWindow: { t: number; bytes: number }[] = [];

panel.update(view);

(async () => {
  try {
    await bridge.ready();
  } catch (e) {
    setView({ status: 'error', error: 'Telegram Web K bridge failed to load.' });
    return;
  }
  await refreshPeer();
  watcher.start(() => currentPeer?.peerId ?? null);
  watcher.onChange(() => { refreshPeer(); if (pool) handlePeerChange(); });
})();

async function refreshPeer() {
  const peer = await bridge.call<PeerInfo | null>('getCurrentPeer').catch(() => null);
  currentPeer = peer;
  if (peer) {
    setView({ title: peer.title, status: cancelled ? 'idle' : view.status });
  } else {
    setView({ title: 'No channel open', status: 'idle' });
  }
}

async function onStart() {
  if (!currentPeer) return;
  if (currentPeer.type !== 'channel') {
    setView({ status: 'error', error: 'This isn\'t a channel.' });
    return;
  }
  cancelled = false;
  keepalivePort = openKeepalivePort();
  setView({ status: 'walking', error: undefined });

  await callSw({ kind: 'init', peerId: currentPeer.peerId, title: currentPeer.title, username: currentPeer.username });
  const state = (await callSw<any>({ kind: 'getState', peerId: currentPeer.peerId }))!;

  pool = new DownloadPool(CONCURRENCY);
  let offsetId = state.cursor.offsetId;
  let foundLocal = 0;

  try {
    walk: while (!cancelled) {
      const page = await walkPage(bridge, currentPeer.peerId, offsetId, PAGE_LIMIT);
      const fresh = page.items.filter((it) => !state.seenIds.has(it.meta.messageId));
      foundLocal += fresh.length;
      setView({ found: view.found + fresh.length, status: fresh.length ? 'downloading' : view.status });

      for (const item of fresh) {
        if (cancelled) break walk;
        enqueueDownload(item);
      }

      const newSeen = page.skippedIds.concat(fresh.map((i) => i.meta.messageId));
      await callSw({
        kind: 'recordSeen',
        peerId: currentPeer.peerId,
        messageIds: newSeen,
        cursor: { offsetId: page.nextOffsetId },
      });

      if (page.nextOffsetId === 0) break;
      offsetId = page.nextOffsetId;
    }

    await pool.drain();
    if (!cancelled) {
      await callSw({ kind: 'complete', peerId: currentPeer.peerId });
      setView({ status: 'completed' });
    }
  } catch (e: any) {
    setView({ status: 'error', error: e?.message ?? String(e) });
  } finally {
    keepalivePort?.disconnect();
    keepalivePort = null;
  }
}

function enqueueDownload(it: { meta: MessageMeta; mediaRef: MediaRef }) {
  pool!.enqueue({
    id: it.meta.messageId,
    run: async () => {
      const filename = mediaFilename({
        dateUtc: it.meta.dateUtc,
        messageId: it.meta.messageId,
        kind: it.mediaRef.kind,
        mimeType: it.mediaRef.mimeType,
      });
      const result = await bridge.call<{ blob: Blob }>(
        'downloadMedia',
        { rawMediaToken: it.mediaRef.rawMediaToken, fileName: filename, requestId: it.meta.messageId }
      );
      return { blob: result.blob, filename };
    },
    onSuccess: async ({ blob, filename }) => {
      const tier =
        it.mediaRef.kind === 'photo'
          ? pickPhotoSize(it.mediaRef.photoSizes ?? [])?.type ?? '?'
          : 'video';
      const item: ArchiveItem = {
        ...it.meta,
        kind: it.mediaRef.kind,
        filename,
        mimeType: it.mediaRef.mimeType,
        byteSize: blob.size,
        qualityTier: tier,
        downloadedAt: new Date().toISOString(),
      };
      const bytes = await blob.arrayBuffer();
      await callSw({
        kind: 'recordItem',
        peerId: currentPeer!.peerId,
        item,
        bytes,
        mimeType: blob.type || it.mediaRef.mimeType,
      });
      bumpBandwidth(blob.size);
      setView({ downloaded: view.downloaded + 1 });
    },
    onFailure: async (e) => {
      await callSw({
        kind: 'recordFailure',
        peerId: currentPeer!.peerId,
        failure: {
          messageId: it.meta.messageId,
          reason: e.message,
          lastTriedAt: new Date().toISOString(),
        },
      });
      setView({ failed: view.failed + 1 });
    },
  });
}

function onPause() { pool?.pause(); setView({ status: 'paused' }); }
function onResume() { pool?.resume(); setView({ status: 'downloading' }); }
async function onCancel() {
  cancelled = true;
  pool?.pause();
  if (currentPeer) await callSw({ kind: 'flushPersist', peerId: currentPeer.peerId });
  setView({ status: 'idle' });
}

async function handlePeerChange() {
  cancelled = true;
  pool?.pause();
  if (currentPeer) {
    await callSw({ kind: 'flushPersist', peerId: currentPeer.peerId });
  }
  setView({ status: 'paused', error: 'Archive paused — reopen the channel to resume.' });
}

function setView(patch: Partial<PanelView>) {
  view = { ...view, ...patch };
  panel.update(view);
}

function bumpBandwidth(bytes: number) {
  const now = Date.now();
  bytesWindow.push({ t: now, bytes });
  const cutoff = now - 30_000;
  bytesWindow = bytesWindow.filter((b) => b.t >= cutoff);
  const total = bytesWindow.reduce((s, b) => s + b.bytes, 0);
  setView({ bandwidthBps: Math.round(total / 30) });
}
```

- [ ] **Step 2: Build and reload**

Run: `npm run build`
Reload extension at `chrome://extensions`.

- [ ] **Step 3: Commit**

```bash
git add src/content/content.ts
git commit -m "feat(content): orchestrate channel walk + download pool + panel"
```

---

## Phase 8 — Bridge registration (MAIN world) + popup

### Task 8.1: Register `bridge.js` dynamically on install

**Files:**
- Create: `src/background/install.ts`
- Modify: `src/background/service-worker.ts`

- [ ] **Step 1: Implement `install.ts`**

```ts
const SCRIPT_ID = 'tg-archive-bridge';

export async function registerBridge() {
  // Unregister first to allow dev hot-swap.
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch {
    /* ignore */
  }

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: ['bridge/bridge.js'],
      matches: ['https://web.telegram.org/k/*'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: true,
    },
  ]);
}
```

- [ ] **Step 2: Wire into SW startup**

Modify `src/background/service-worker.ts` — add at top:

```ts
import { registerBridge } from './install';
```

Add inside the file, near the end (after `installRouter(handler)`):

```ts
chrome.runtime.onInstalled.addListener(() => { registerBridge().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { registerBridge().catch(console.error); });
// On dev reload, runtime.onInstalled fires, so we get registration on every reload.
```

- [ ] **Step 3: Rebuild and reload extension**

Run: `npm run build`
Reload at `chrome://extensions`. Open a Telegram Web K tab.

Open the page's console (the page's own console, not the SW console).
Expected: `[tg-archive/bridge] starting` and `[tg-archive/bridge] handles resolved`.

If you see `BRIDGE_INCOMPATIBLE`, return to Phase 1 reconnaissance and reconcile names.

- [ ] **Step 4: Commit**

```bash
git add src/background/install.ts src/background/service-worker.ts
git commit -m "feat(sw): register MAIN-world bridge dynamically on install"
```

### Task 8.2: Popup with settings (concurrency only — quality is fixed per spec)

**Files:**
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.ts`

- [ ] **Step 1: `popup.html`**

```html
<!doctype html>
<html><head>
<meta charset="utf-8"><title>Telegram Channel Archiver</title>
<link rel="stylesheet" href="popup.css">
</head><body>
<h1>Telegram Channel Archiver</h1>
<p class="muted">Open a channel on <a href="https://web.telegram.org/k/" target="_blank">web.telegram.org/k/</a> and use the in-page panel.</p>
<details>
  <summary>Advanced</summary>
  <label>Concurrency <input type="number" min="1" max="6" id="concurrency"></label>
</details>
<script type="module" src="popup.js"></script>
</body></html>
```

- [ ] **Step 2: `popup.css`**

```css
body { font-family: -apple-system, sans-serif; padding: 14px; width: 280px; margin: 0; }
h1 { font-size: 14px; margin: 0 0 6px; }
.muted { color: #666; font-size: 12px; margin: 0 0 12px; }
label { display: block; margin: 6px 0; font-size: 13px; }
input[type=number] { width: 60px; }
details { margin-top: 10px; }
```

- [ ] **Step 3: `popup.ts`**

```ts
const $c = document.getElementById('concurrency') as HTMLInputElement;

(async () => {
  const { concurrency = 3 } = await chrome.storage.local.get('concurrency');
  $c.value = String(concurrency);
})();

$c.addEventListener('change', async () => {
  const n = Math.max(1, Math.min(6, parseInt($c.value || '3', 10)));
  $c.value = String(n);
  await chrome.storage.local.set({ concurrency: n });
});
```

- [ ] **Step 4: Build, reload, click the toolbar icon, confirm popup renders**

Run: `npm run build` and reload extension.

- [ ] **Step 5: Commit**

```bash
git add src/popup/
git commit -m "feat(popup): minimal settings UI for concurrency"
```

> **Note:** The content script currently hardcodes `CONCURRENCY = 3`. Wiring the popup setting into the content script is a follow-up if you want it — read it via `chrome.storage.local.get('concurrency')` in `content.ts` before constructing the pool. Not blocking for v0.1.

---

## Phase 9 — End-to-end smoke testing

These steps are manual. Each one is small enough to either pass or surface a defect in 10–20 minutes.

### Task 9.1: Smoke test — small unrestricted test channel

**Setup:** Use a private Telegram channel you own with 10–30 mixed photos and videos and saving enabled. Note its title and approximate item count before starting.

- [ ] **Step 1: Open `web.telegram.org/k/`, navigate to the test channel.**

- [ ] **Step 2: Verify the overlay panel appears with the channel title.**

If not: check the page console for `[tg-archive/bridge]` and `[tg-archive/content]` logs. Most common cause: `bridge.js` failed to register — re-run Task 8.1 Step 3 verification.

- [ ] **Step 3: Click "Archive this channel".**

Expected: panel status becomes `walking` → `downloading`, counts begin incrementing.

- [ ] **Step 4: Wait for completion. Inspect `~/Downloads/TelegramArchive/<slug>__<peerId>/`.**

Verify:
- All expected media files exist.
- `manifest.json` has `progress.status: "completed"`, correct counts, and a non-empty `channel` block.
- `items.ndjson` has one valid JSON object per line, count matches downloaded.
- Captions, message IDs, and dates in `items.ndjson` look right.

- [ ] **Step 5: Document any defects as GitHub issues / inline TODOs and resolve before moving on.**

### Task 9.2: Smoke test — no-forwards channel

**Setup:** Either ask the channel admin of an existing no-forwards channel you have legitimate archival need for, or create a test channel and toggle "Restrict saving content" in channel settings, then upload a few items.

- [ ] **Step 1: Open the channel. Confirm that Telegram's UI shows the "saving disabled" indicator (no right-click menu, no native download button).**

- [ ] **Step 2: Click "Archive this channel" in the overlay panel.**

Expected: archive proceeds normally. The bridge calls `appDownloadManager` directly which doesn't consult the UI restriction.

- [ ] **Step 3: Verify the downloaded files are byte-identical to the original (if you uploaded them yourself).**

```bash
shasum -a 256 ~/Downloads/TelegramArchive/<slug>__<peerId>/*.jpg
# compare to local copies
```

### Task 9.3: Smoke test — resume after browser restart

- [ ] **Step 1: On the small test channel from Task 9.1, click "Archive this channel".**

- [ ] **Step 2: Wait ~20% of the way through, then close the browser entirely (not just the tab).**

- [ ] **Step 3: Reopen the browser and the channel. Click "Archive this channel" again.**

Expected: panel shows `Found: <number near where you stopped>` and resumes downloading from there, not from the newest. Counts continue from where they were, not from 0.

- [ ] **Step 4: Verify `manifest.json` in the channel folder has updated counts and `items.ndjson` was correctly extended without duplicates or empty lines.**

### Task 9.4: Smoke test — catch-up after new posts

- [ ] **Step 1: With a completed archive, post 3–5 new items to the channel from another device or account.**

- [ ] **Step 2: Reopen the channel and click "Archive this channel".**

Expected: panel walks from newest, hits the first already-seen msgId quickly, downloads only the new items, and completes.

- [ ] **Step 3: Verify only the new items were added to `items.ndjson`.**

### Task 9.5: Smoke test — 5k+ item channel (optional, may take ~1 hour)

**Setup:** A channel you have legitimate archival need for with 5k+ media items.

- [ ] **Step 1: Click "Archive this channel". Note the start timestamp.**

- [ ] **Step 2: Leave the tab open for the duration. Check in periodically that the panel still shows progress.**

- [ ] **Step 3: Verify the SW doesn't get killed**

Open the SW inspect view occasionally; you should see periodic activity. The keepalive port should keep it warm.

- [ ] **Step 4: At completion, verify:**
- `items.ndjson` line count matches downloaded counts.
- `manifest.json` shows `status: "completed"` and `cursor.offsetId: 0`.
- Random spot-check: pick 5 random rows from `items.ndjson` and confirm the file referenced by `filename` exists in the folder.

- [ ] **Step 5: Document any rate-limit incidents (FLOOD_WAIT) for future tuning.**

### Task 9.6: Final polish — README and version bump

**Files:**
- Create: `README.md`
- Modify: `public/manifest.json`, `package.json` if needed

- [ ] **Step 1: Write `README.md`**

```markdown
# Telegram Channel Archiver

Personal-use Chrome extension that archives photos and videos from a Telegram Web K channel — including channels marked as no-forwards.

See the design doc at `docs/superpowers/specs/2026-05-18-telegram-channel-archiver-design.md` and the plan at `docs/superpowers/plans/2026-05-18-telegram-channel-archiver.md`.

## Install (dev / unpacked)
1. `npm install`
2. `npm run build`
3. Open `chrome://extensions`, enable Developer Mode.
4. Click "Load unpacked" and pick the `dist/` folder.

## Use
1. Open https://web.telegram.org/k/ and log in.
2. Open the channel you want to archive.
3. In the in-page panel (bottom-right), click "Archive this channel".
4. Files land in `~/Downloads/TelegramArchive/<channel-slug>__<peerId>/`.

## Develop
- `npm run build:watch` — rebuild on changes
- `npm test` — run unit tests
- `npm run typecheck` — type check

After a code change, reload the extension at `chrome://extensions` to pick up changes.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README for install and use"
```

---

## Self-Review Checklist

After writing the plan, the author ran the spec-coverage and placeholder scans below. Any issues found are fixed inline in this document.

- ✅ **Spec coverage**: every section of the spec maps to at least one task:
  - Architecture (3 components + offscreen) → Phases 3, 4, 5, 7.
  - Page-world bridge envelope → Task 2.7 + Phase 3.
  - Bridge ops (4 of them) → Tasks 3.2, 3.3, 3.4, 3.5; wired in 3.6.
  - Resilience to internal renames → Task 3.1 (`resolveTelegramHandles`).
  - Archive flow (6 steps) → Task 7.7 content orchestrator.
  - Byte path (Blob → offscreen → downloads) → Tasks 3.5, 5.1, 6.1.
  - File output layout → Tasks 6.1, 6.2, 6.3; verified in 9.1.
  - manifest.json / items.ndjson semantics → Tasks 6.2, 6.3, 6.4.
  - NDJSON write strategy (IDB-backed + batched) → Tasks 4.3, 6.3, 6.4.
  - Dedup ledger → Task 4.2.
  - Scale and robustness (concurrency, FLOOD_WAIT, keepalive, tab-pinned, resume, batch flush) → Tasks 2.5, 4.5, 7.4, 7.5, 7.7, 6.4.
  - Manifest + permissions → Task 0.3 (+ 7.6 web_accessible_resources update).
  - Acceptance criteria → Phase 9 smoke tests.

- ✅ **Placeholder scan**: no `TBD`, `TODO`, "fill in details", "add appropriate error handling", or "similar to Task N" placeholders. Reconnaissance unknowns are isolated to `docs/recon.md` (Task 1.1) and consumed by clearly-flagged "Engineer note" callouts in Tasks 3.1–3.5.

- ✅ **Type consistency**: `MediaRef`, `MessageMeta`, `ArchiveItem`, `Cursor`, `Counts`, `PeerInfo`, `ArchiveStatus`, `ArchiveFailure` are defined in Task 2.1 and used unchanged in every downstream task. `BridgeOp`/`BridgeEvent` defined in Task 2.7 are reused unchanged in Tasks 3.6 and 7.1. `SwRequest` defined in Task 4.1 is used unchanged in 4.2–7.7.
