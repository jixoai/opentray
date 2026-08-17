# Creating an App from a Start Command

Use `create-opentray` when you have a command that serves HTTP locally and
want it wrapped as an OpenTray-hosted desktop app without writing SDK code.

## When to use this path

- You already have a runnable command (`npx somecommand start --xx`,
  `npm run dev`, `node server.js`, …) that listens on a local port.
- You want a tray + ordinary application window wrapping that service.
- You do not want to hand-author `createTray` wiring, icon assets, or launch
  vectors.

If you are writing the app yourself, read `references/getting-started.md` and
`references/app-mode.md` instead.

## Wizard flow

```bash
npx create-opentray            # in the directory that should own the project
npx create-opentray my-app     # or an explicit target directory
```

1. The wizard serves a React + shadcn/ui page on `127.0.0.1` at a tokened URL
   and opens the browser. `--no-open` prints the URL instead.
2. Paste the start command. It runs once in a real interactive terminal
   (ghostty-web over a prebuilt `@lydell/node-pty` PTY) inside a Chrome-style
   tabs panel. The backend transports the PTY's chunks verbatim — the renderer
   owns every escape sequence; prompts and TUI output work. If the optional PTY
   dependency is unavailable, the preview degrades to read-only with a notice.
3. Confirmed services (owned TCP listener + HTTP probe) each open an iframe tab
   with an editable URL, back/forward/reload, and a per-tab history. The
   terminal tab's status bar shows cursor/selection plus clickable service
   entries that jump to the matching iframe tab by hostname. Unrelated loopback
   listeners (browser DevTools sockets) are never adopted.
4. The form shows auto-derived defaults (scraped title, derived appId) as
   **placeholders**: an empty field means "use the default" and confirmation
   resolves them; edits win over later scrapes. A dedicated icon input carries
   the icon fallback chain (scraped favicon → custom path → first-letter
   glyph).
5. 高级选项 — the settings button beside the command bar opens an accordion.
   命令选项 configures execution: 参数输入模式 (数组/argv mode commits ONE
   argv element per tag, verbatim — no string splitting), 工作目录 (cwd;
   the default is the USER_HOME directory, shown in full, and relative
   paths resolve from there), and 环境变量 (env overlay, also persisted
   into the generated app).
   应用选项 holds the tray-icon picker (defaults to the app icon choice;
   solid black/white silhouettes derived from every candidate) and the two
   generated-app window options, both off by default: 显示启动终端 and
   显示地址栏. Service ports are never hard-bound: the generated app sniffs
   the command's owned listening ports at runtime.
6. 确定创建 freezes the form and shows the confirmation dialog. 确认生成
   streams pipeline logs (scaffold → icon → install → first launch → macOS
   bundle) and ends in a Success dialog with 打开应用 and the platform
   pinning hint.

Useful flags: `--pm npm|pnpm|bun`, `--skip-install`, `--force`,
`--port <n>`, `--no-open`.

## What gets generated

A self-contained project (public packages only). The wizard composes the
app icon: the chosen foreground is analyzed for luminance/coverage and placed
over a black, white, or transparent background (auto-selected; manually
overridable with a foreground scale control). macOS ICNS encodes from the
824-in-1024 best-practice variant; Windows/Linux use the full 1024. It lands in
`~/.opentray/create/<name>/` by default — stable per app, never polluting the
directory you launched the wizard from; a positional argument places it
explicitly. If the target directory already exists, 高级选项 shows a warning
and a 强制覆盖 switch that clears and regenerates it (`--force`).

- `opentray.app.json` — frozen identity + the resolved launch vector
  (absolute executable; shell-free; no environment map persisted).
- `main.mjs` — spawns the command supervised, waits for the service port,
  calls `createTray` with the frozen identity and explicit `appLaunch`, opens
  an `appMode: true` WebView window. Tray menu owns Quit.
- `app-icon/` — platform-standard ICNS/ICO/PNG catalog generated from the
  scraped favicon (or a first-letter glyph when nothing usable was found),
  through the same generator as `openTrayAppIconPlugin`. Raw favicon bytes are
  never used as App identity.
- `package.json` — depends on `opentray` and `@opentray/ext-webview`, plus
  `@lydell/node-pty` only when 显示启动终端 is enabled.
- `app-shell-server.mjs` + `app-shell/` (only when a shell option is enabled) —
  a local host on `127.0.0.1` serving the prebuilt shell pages, the PTY
  stream, and live port state.

### Generated-app window modes

- **显示启动终端** — the command runs through a PTY and a dedicated terminal
  window opens beside the service: command bar, the same ghostty renderer the
  wizard uses, and a status bar showing cursor, size, and every listened port.
  Typing flows back to the command through the shell server.
- **显示地址栏** — each service window renders behind an address bar managed
  through the Web Navigation API: address entries are same-origin `?url=`
  pseudo-routes that are intercepted, so only the service iframe navigates and
  back/forward traverse real Navigation entries (history fallback where the
  API is absent). Without the option, service windows open the URL directly.
- Every listened HTTP port owned by the command opens its own dedicated window
  automatically. When a port stops listening, that window's title becomes
  `AppName (detached)` until the port returns.
- Generated entries launch with Node even when the wizard ran under Bun: the
  native PTY transport requires a Node host.

## After creation

- Run it any time: `npm run start` (or the detected package manager) inside
  the project.
- Pin the window/app: taskbar (Windows) or Dock (macOS) per the Success hint.
- macOS: the stable `.app` bundle lives under `~/.opentray/apps/` and is
  recreated by the runtime; pin that bundle to the Dock for a permanent entry.
- Re-running `create-opentray` for the same appId is idempotent at the App
  identity level: the runtime returns the existing identity without clearing
  its name, icon, or trays.
- Troubleshooting the generated app: check `<project>/app.log` first; it
  captures the supervised command's stdout/stderr.

## Limits (platform truth)

- Windows/Linux pinning hints only; persistent shortcut/`.desktop` files are
  not generated by the wizard yet.
- Commands that never open a local HTTP port cannot be packaged by this flow;
  the wizard keeps waiting and offers manual port entry as a fallback.
- The wizard preview is interactive, but the generated app supervises the
  command headless (`app.log`); commands that require an interactive TTY at
  runtime are not supported inside the generated app.
