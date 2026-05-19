# Telegram Channel Archiver

Chrome extension for archiving photos and videos from Telegram Web K channels that are accessible in your authenticated browser session.

This project is intended for personal archiving and research workflows. Use it only for content you own, have permission to archive, or are otherwise legally allowed to download. Telegram Channel Archiver is not affiliated with Telegram.

## Features

- Runs as an unpacked Chrome Manifest V3 extension.
- Adds an in-page archiver panel to Telegram Web K.
- Downloads channel photos and videos into a local archive folder.
- Writes `manifest.json` and `items.ndjson` sidecar files for repeatable processing.

## Download

Download the source in either of these ways:

```sh
git clone https://github.com/arafa-dev/telegram-channel-archiver.git
cd telegram-channel-archiver
```

Or use GitHub's **Code** menu and choose **Download ZIP**.

## Install for Development

Requirements:

- Node.js 20 or newer
- npm
- Google Chrome or a Chromium-based browser with extension developer mode

Install dependencies and build the extension:

```sh
npm install
npm run build
```

Then load the unpacked extension in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer Mode**.
3. Click **Load unpacked**.
4. Select the generated `dist` directory.

## Use

1. Open `https://web.telegram.org/k/`.
2. Log in to Telegram Web K.
3. Open the channel you want to archive.
4. Use the in-page Telegram Channel Archiver panel and click **Archive this channel**.

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

## Contribute

Contributions are welcome. To make a change:

1. Fork the repository on GitHub.
2. Create a branch from `master`.
3. Install dependencies with `npm install`.
4. Make a focused change with tests when behavior changes.
5. Run `npm test`, `npm run typecheck`, and `npm run build`.
6. Open a pull request and describe the user-visible behavior, verification performed, and any limits.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

## Current Verification Limits

Automated tests, typecheck, and build can run in this environment. Live Telegram Web K smoke tests require an authenticated Telegram session and should be performed manually by maintainers when a change touches browser integration.

## Project Notes

This project was initially implemented from:

- [Design doc](docs/superpowers/specs/2026-05-18-telegram-channel-archiver-design.md)
- [Implementation plan](docs/superpowers/plans/2026-05-18-telegram-channel-archiver.md)

## Security

Please report security issues privately. See [SECURITY.md](SECURITY.md).

## License

Telegram Channel Archiver is released under the [MIT License](LICENSE).
