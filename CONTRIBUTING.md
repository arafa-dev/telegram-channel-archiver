# Contributing to Telegram Channel Archiver

Thanks for helping improve Telegram Channel Archiver. This guide explains how to set up the project, make changes, and submit pull requests.

## Ground Rules

- Use this project only for lawful archiving of content you own, have permission to archive, or are otherwise allowed to download.
- Keep pull requests focused. Small changes are easier to review and safer to merge.
- Include tests for behavior changes.
- Do not commit local archives, downloaded Telegram media, credentials, cookies, tokens, browser profiles, or generated `dist` output.

## Development Setup

Requirements:

- Node.js 20 or newer
- npm
- Google Chrome or a Chromium-based browser

Install dependencies:

```sh
npm install
```

Build the extension:

```sh
npm run build
```

Load the unpacked extension from `dist` in `chrome://extensions`.

## Common Commands

```sh
npm run build
npm run build:watch
npm test
npm run typecheck
```

Run all checks before opening a pull request:

```sh
npm test
npm run typecheck
npm run build
```

## Pull Request Workflow

1. Fork the repository.
2. Create a branch from `master`.
3. Make a focused change.
4. Add or update tests when behavior changes.
5. Run the verification commands.
6. Open a pull request with:
   - What changed.
   - Why the change is useful.
   - Which commands you ran.
   - Any manual Telegram Web K testing performed.
   - Any known limits or follow-up work.

## Code Style

- TypeScript is compiled with `tsc --noEmit`.
- Tests use Vitest.
- Prefer small modules with explicit types.
- Keep browser-extension permissions narrow.
- Keep UI text direct and functional.

## Manual Testing

Automated checks cover most local logic. Browser integration changes should also be tested manually:

1. Run `npm run build`.
2. Reload the unpacked extension in `chrome://extensions`.
3. Open `https://web.telegram.org/k/`.
4. Try the changed workflow on a channel available to your account.
5. Confirm downloaded files and sidecar files are written under `~/Downloads/TelegramArchive/`.

Never include downloaded media or private Telegram data in issues or pull requests.

## Reporting Bugs

Use the bug report template and include:

- Browser and operating system.
- Extension version or commit SHA.
- What you expected to happen.
- What actually happened.
- Console logs or screenshots with private data removed.

## Requesting Features

Open a feature request with the workflow you want to support, why it matters, and any privacy or permission implications.
