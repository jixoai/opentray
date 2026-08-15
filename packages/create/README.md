# create-opentray

Turn any start command that serves HTTP locally into an OpenTray-hosted
desktop app — through a browser wizard, without writing OpenTray code.

```bash
npx create-opentray
```

## What it does

1. Starts a token-guarded WebUI (React + shadcn/ui) on `127.0.0.1` and opens
   your browser.
2. You paste a start command (e.g. `npx somecommand start --xx`). It runs
   immediately in a **real interactive terminal** inside a Chrome-style tabs
   panel: prompts, TUI output, and keystrokes all work.
3. Confirmed HTTP services (TCP listener owned by the command's process tree
   **and** answering an HTTP probe) each open an iframe tab automatically; the
   tab's navigation bar shows an editable URL with back/forward/reload backed
   by a per-tab history. The terminal tab's status bar shows cursor position,
   selection range, and clickable service entries that jump to the matching
   iframe tab by hostname.
4. Auto-derived defaults (scraped title, favicon, derived appId) are shown as
   **input placeholders** — an empty field means "use the default"; edits win
   over later scrapes. A dedicated icon input carries the icon fallback chain.
5. 确定创建 freezes the resolved identity, shows a confirmation dialog, then
   确认生成 runs the pipeline with live logs: scaffold → icon generation →
   dependency install → first launch → (macOS) stable bundle verification.
6. Success offers 打开应用 plus a platform pinning hint (Windows taskbar /
   macOS Dock).

## CLI

```
create-opentray [targetDir] [--no-open] [--port <n>] [--pm npm|pnpm|bun]
                [--skip-install] [--force]
```

- `--no-open` — print the wizard URL instead of opening a browser.
- `--pm` — force the package manager used for the generated project.
- `--skip-install` — scaffold without installing dependencies.
- `--force` — allow materializing into a non-empty directory.

## Generated project

```
<project>/
  package.json          deps: opentray, @opentray/ext-webview
  opentray.app.json     frozen identity, command vector, service port, window size
  main.mjs              entry: supervises the command, owns tray + appMode window
  app-icon/             generated ICNS/ICO/Linux PNGs + app-icon.json manifest
  README.md
```

The entry spawns the recorded command (output → `app.log`), waits for the
service port via TCP, then calls `createTray` with the frozen `appId`,
`appName`, generated `appIcon`, and an explicit absolute `appLaunch` vector,
and opens an `appMode: true` WebView window on the service URL. Quit lives in
the tray menu.

## Platform notes

- **Objective terminal transport**: the preview runs through
  [@lydell/node-pty](https://github.com/lydell/node-pty) (prebuilt per-platform
  binaries; no compiler needed) and is rendered by
  [ghostty-web](https://github.com/coder/ghostty-web). The backend forwards the
  PTY binding's chunks verbatim — no re-decoding, no analysis; the renderer
  owns every escape sequence. Invalid bytes are replaced with U+FFFD *inside
  the PTY binding* (its documented text-channel contract, shared with every
  node-pty consumer); the wizard adds no interpretation on top.
- The optional PTY dependency degrades to a read-only pipe mode with a visible
  notice when it cannot load; the wizard itself keeps working.
- The generated app runs the command supervised but headless (output goes to
  `app.log`); commands that require an interactive TTY at runtime are not
  supported inside the generated app.
- macOS: the stable `.app` bundle is materialized by the OpenTray runtime on
  first launch; 打开应用 uses `open <bundle>.app` (cold launch via the launch
  descriptor, warm reopen focuses the retained window). Pin it to the Dock.
- Windows: the appMode window participates in the taskbar/Alt-Tab; pin it from
  the taskbar. Persistent shortcut generation is not provided yet.
- Linux: taskbar pinning depends on the desktop environment; `.desktop`
  generation is not provided yet.

## Programmatic use

```ts
import { createWizardSession, deriveDefaultAppId } from "create-opentray";
```

See `src/index.ts` exports for the full surface (wizard session, server,
discovery, scraping, launch-vector resolution, scaffold, materialize).
