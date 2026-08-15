# create-opentray

Turn any start command that serves HTTP locally into an OpenTray-hosted
desktop app — through a browser wizard, without writing OpenTray code.

```bash
npx create-opentray
```

## What it does

1. Starts a token-guarded WebUI on `127.0.0.1` and opens your browser.
2. You paste a start command (e.g. `npx somecommand start --xx`). It runs
   immediately in a **real interactive terminal** (ghostty-web renderer over a
   PTY): you can answer prompts and interact with the command while the wizard
   watches it. If the optional native PTY dependency is unavailable, the
   preview degrades to a read-only terminal with a visible notice.
3. Ports the command's own process tree starts listening on are diffed against
   a pre-spawn baseline; each new HTTP service is listed (foreign listeners
   such as browser DevTools sockets are never adopted). The first service is
   selected by default.
4. The selected service is polled: its `<title>` becomes the default app name
   and its favicon the default icon source. The default appId is derived from
   the command tokens before the first option, reversed and dot-joined
   (`npx somecommand start --xx` → `start.somecommand.npx`). Every value stays
   editable; edits win over later scrapes.
5. Switching services rescrapes and previews the service in an iframe.
6. 确定创建 freezes the form (later scrapes can no longer change it), shows a
   confirmation dialog, then 确认生成 runs the pipeline with live logs:
   scaffold → icon generation → dependency install → first launch → (macOS)
   stable bundle verification.
7. Success offers 打开应用 plus a platform pinning hint (Windows taskbar /
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

- **Interactive preview terminal**: rendered by
  [ghostty-web](https://github.com/coder/ghostty-web) (Ghostty's VT parser
  compiled to WASM, xterm.js-compatible API) and attached through `node-pty`,
  so prompts and TUI output work while the wizard watches the command.
  `node-pty` is an optional dependency — when it cannot build, the preview
  falls back to a read-only terminal with a visible notice; the wizard itself
  keeps working.
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
