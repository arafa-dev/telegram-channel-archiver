# Telegram Channel Archiver

Personal-use Chrome extension that archives photos and videos from a Telegram Web K channel, including channels marked as no-forwards.

This project is implemented from:

- [Design doc](docs/superpowers/specs/2026-05-18-telegram-channel-archiver-design.md)
- [Implementation plan](docs/superpowers/plans/2026-05-18-telegram-channel-archiver.md)

## Install for Development

```sh
npm install
npm run build
```

Then load the unpacked extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click Load unpacked.
4. Select the generated `dist` directory.

## Use

1. Open `https://web.telegram.org/k/`.
2. Log in to Telegram Web K.
3. Open the channel you want to archive.
4. Use the in-page Telegram Channel Archiver panel and click Archive this channel.

Downloaded media and sidecar files land in:

```text
~/Downloads/TelegramArchive/<channel-slug>__<peerId>/
```

The folder contains downloaded photos/videos plus `manifest.json` and `items.ndjson`.

## Develop

Run a watch build while editing:

```sh
npm run build:watch
```

Run verification locally:

```sh
npm test
npm run typecheck
npm run build
```

After source changes, rebuild and reload the unpacked extension from `chrome://extensions`.

## Current Verification Limits

Automated tests, typecheck, and build can run in this environment. Live Telegram Web K smoke tests require an authenticated Telegram session and were not performed here.
