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
   **and** answering an HTTP probe) each open an iframe tab automatically —
   newly sniffed tabs take focus — and stay alive across switches. The tab
   strip sits above the context toolbar; on service tabs it shows an editable
   URL with back/forward/reload backed by a per-tab history. The terminal tab's status bar shows cursor position,
   selection range, and clickable service entries that jump to the matching
   iframe tab by hostname.
4. Auto-derived defaults (scraped title, derived appId) are shown as
   **input placeholders** — an empty field means "use the default"; edits win
   over later scrapes. The icon row is a square file picker plus scraped
   candidates: every icon the page declares (SVG, apple-touch-icon, sized
   PNG sets, /favicon.ico) is collected, measured by true pixel clarity,
   deduplicated perceptually, and ranked; clicking a candidate (or uploading
   a local image) selects it, and the clearest candidate is the default.
5. 高级选项 — the settings button beside the command bar opens an accordion:
   - 命令选项: 参数输入模式 (string vs 数组/argv — array mode commits ONE argv
     element per tag, verbatim, never splitting strings), 工作目录 (cwd;
     default is the USER_HOME directory, displayed in full — relative paths
     resolve from there), and 环境变量 (env overlay; also persisted into the
     generated app).
   - 应用选项: the tray-icon picker (defaults to the app icon choice; solid
     black/white silhouettes derived from every candidate) and the two
     generated-app window options 显示启动终端 / 显示地址栏 (both default off).
   Service ports are NEVER hard-bound: the form has no manual port input, and
   the generated app resolves its address exclusively by sniffing the
   command's owned listening ports (HTTP-verified) at runtime.
6. 确定创建 freezes the resolved identity, shows a confirmation dialog, then
   确认生成 runs the pipeline with live logs: scaffold → icon generation →
   dependency install → first launch → (macOS) stable bundle verification.
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

Projects default to `~/.opentray/create/<name>/` (stable per app — re-running
the wizard for the same command regenerates the same location and never
pollutes the invocation directory). Pass a positional argument to place the
project elsewhere. When the target directory already exists, the wizard
warns in 高级选项 and offers 强制覆盖, which CLEARS the directory and
regenerates it (equivalent to `--force`; the generated tree is fully
wizard-owned and regenerable).

```
<project>/
  package.json          deps: opentray, @opentray/ext-webview (+ @lydell/node-pty
                        when the startup terminal is enabled)
  opentray.app.json     frozen identity, command vector, service port, window size,
                        tray icon, shell options
  main.mjs              entry: supervises the command, owns tray + windows
  app-shell-server.mjs  local shell host (only when a shell option is enabled):
                        serves app-shell/ + SSE state + terminal input
  app-shell/            prebuilt shell UI pages (terminal.html, browse.html)
  app-icon/             generated ICNS/ICO/Linux PNGs + app-icon.json manifest
                        (+ tray-icon.png when a tray icon is configured)
  README.md
```

The entry spawns the recorded command (output → `app.log`), waits for the
service port via TCP, then calls `createTray` with the frozen `appId`,
`appName`, generated `appIcon`, an optional tray icon, and an explicit absolute
`appLaunch` vector, and opens an `appMode: true` WebView window on the service
URL. Quit lives in the tray menu.

### Shell options (dedicated windows)

- 显示启动终端 — the command runs through a PTY and a DEDICATED terminal
  window opens: command bar on top, the same ghostty renderer the wizard uses,
  status bar with cursor, size, and live listened ports (detached ports are
  marked). Input flows back through the shell server.
- 显示地址栏 — every service window renders as an address-bar wrapper: the bar
  sits above the service iframe and navigation is managed through the Web
  Navigation API (same-origin `?url=` pseudo-routes are intercepted so only
  the iframe moves; a history fallback covers engines without the API). With
  the option off, service windows open the service URL directly.
- Every listened HTTP port owned by the command opens its own window
  automatically; when a port stops listening, its window title becomes
  `AppName (detached)` and reverts when the port returns.
- Generated entries always launch with Node even when the wizard ran under Bun
  (the native PTY transport requires a Node host).

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
- **Runtime-native PTY backends**: under Bun the terminal attaches through
  the built-in `Bun.Terminal` + `Bun.spawn({ terminal })` (no native npm
  dependency, fully interactive — verified output, stdin echo, resize, and
  exit codes on Bun 1.3.14). Under Node it uses prebuilt `@lydell/node-pty`.
  Both transport the PTY's chunks verbatim. Only when neither backend exists
  (Node without the optional dependency, or a Bun older than 1.2.19) does the
  preview degrade to read-only pipes with a visible notice.
- The Run button becomes an Interrupt button while the preview process is
  alive and returns to Run when the process exits — including when it is
  killed outside the wizard.
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
