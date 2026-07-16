# OpenTray Agent Guide

## Vision

OpenTray is a Desktop Status Platform for Node/Deno/Bun CLI and AI-skill ecosystems.

The product goal is not "show a tray icon". The goal is to give lightweight tools a system-level entry point without forcing users into Electron or a full desktop app framework.

## Platform Laws

OpenTray uses the current tray-first model. Application code calls `createTray()` directly and owns its own foreground/background lifetime.

- `App` is the caller-owned runtime identity and isolation boundary (passed through `createTray(options, { appId, appName })`, not a separate `createApp` call).
- `Tray` is one desktop status atom owned by that app/runtime.
- `Session` is the live source of authority for tray events and mutations; closing a session removes its tray contributions.
- Extensions add native capabilities, but they must attach through tray/session contracts (e.g. `tray.extend(...)` or `attachWebview(tray)`), not by reaching into broker internals.
- Do not make one CLI directly own another CLI's menu, events, popup, or lifecycle.
- Windows named-pipe endpoints do not include `homeDir`. Source examples must pass an explicit per-invocation caller label so they cannot attach to a same-version neutral-label broker through the neutral `opentray` endpoint.
- Source WebView examples own a Vite server instance through Vite's Node API. `server.listen()`, `resolvedUrls.local`, and `server.close()` are the lifecycle authority; never parse formatted CLI output. Bind example servers to `127.0.0.1` so Windows `localhost` DNS order cannot split the selected listener from the WebView request. On shutdown, close the runtime session before `server.close()` because Vite can wait for the live WebView HTTP connection.
- On Windows, an initialized caller's `ClientFrame::Exit` has already completed core session cleanup. Its dedicated GUI broker must exit directly from that frame instead of waiting for a named-pipe `Disconnected` event, because a client half-close can defer that event indefinitely.
- OpenSpec workflow tests must spawn Bun directly through `process.execPath` and capture output with file descriptors; do not shell through `/bin/sh`, which does not exist on native Windows. All CLI-reported change-relative paths must normalize to `/`, so Windows filesystem separators do not corrupt TOC coverage, JSON output, or test assertions.
- Package staging must still copy runtime hosts marked executable on Windows, but Windows does not expose POSIX executable bits through `stat().mode`; assert `0o111` only on POSIX and assert file presence on Windows.
- Convert `file:` URLs to host paths with `fileURLToPath()` before handing them to a bundler, and use `pathToFileURL(path).href` for dynamic imports. Do not round-trip through `.pathname`, which duplicates Windows drive prefixes.
- Do not add platform special cases into shared layers; expose capability contracts instead.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Older docs that still mention them describe an earlier surface model.

## Windows Tray WebView Laws

The following laws were established from the 2026-07-14 pnpm-pub repair and its native evidence:

```text
CBS bootstrapper discovery
          |
          v
MddBootstrapInitialize package graph
          |
          v
matching FrameworkUdk + Windowing.Core
```

- A CBS directory may supply `Microsoft.WindowsAppRuntime.Bootstrap.dll`; it is not the selected runtime identity. Resolve runtime DLLs by bare name through the package graph unless `OPENTRAY_WINDOWS_APP_RUNTIME_DIR` explicitly supplies a complete runtime.
- AppWindow objects are HWND-thread-affine for this host path. Initialize WinRT and mutate `AppWindowTitleBar` synchronously on the HWND-owning thread before first show; do not move the call to an MTA worker or send AppWindow interfaces across apartments.
- `style.platform.windows.showInSwitchers` owns taskbar/Alt+Tab projection. Default `false` means `WS_EX_TOOLWINDOW` and no `WS_EX_APPWINDOW`; title and icon metadata do not decide switcher membership.
- Public Windows window bounds are DWM visible-frame logical pixels. `moveTo` and `resizeTo` must compensate the raw invisible-border delta before `SetWindowPos`.
- Frameless and overlay windows use full-client `WM_NCCALCSIZE` for every Win32 message form. For Windows overlays, `AppWindowTitleBar.LeftInset`, `RightInset`, and `Height` are the safe-area authority and must be read synchronously on the HWND-owning STA; DWM caption-button bounds are only a lower-level rectangle, not an equivalent width contract.
- `windowControlsOverlay: true` uses system colors. Its Windows object form accepts opaque `backgroundColor` and `symbolColor`; box them as WinRT `IReference<Color>` and apply them through `AppWindowTitleBar` before first show. macOS keeps transparent native controls and does not emulate these colors.
- `style.resizable` is a common user-resize intent. Its effective default is `true` for framed windows and `false` for frameless windows; once explicitly supplied, later `frameless` updates preserve it. Programmatic `resizeTo` is independent from this intent.
- A common WebView capability added to TypeScript must be serialized by every native platform `WindowCapabilities` DTO and constructor. Do not treat Windows compilation as proof for macOS DTO parity; release-grade Darwin WebView builds are the cross-platform compiler gate.
- A Windows frameless window removes `WS_THICKFRAME` and disables DWM non-client rendering; it does not imply a transparent or material background. When its effective `resizable` state is true, the WebView bootstrap reserves trusted primary gestures inside a six-CSS-pixel edge band and the HWND owns capture, constrained physical geometry, cursor, cancellation, and end events. A regular Chromium vertical scrollbar coexists with the right and bottom-right gestures; do not prescribe a page gutter or custom scrollbar as a prerequisite. Those remain application layout options only when custom edge hit testing must avoid the reserved band.
- Apply Windows chrome in this order: `SetWindowLongPtr` style/ex-style, DWM non-client policy and client-surface attributes, then one non-shell `SetWindowPos(SWP_FRAMECHANGED)`. The projection itself must not depend on a synthetic resize or host rebuild. After a visible normal frameless style/resize transition completes, queue one HWND message and only then run the shell-state artifact clear; never run it while soft-resize owns capture or while the window is minimized/maximized. A retained `close() -> toVisible()` reveal uses one cancelable 100ms HWND timer instead, because a single queue turn does not guarantee DWM/WebView2 has presented the restored surface.
- `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` delimit native dragging and resizing. A white-block workaround that changes shell state may run only after `WM_SIZE` was observed in that native interaction; a pure move must not minimize, restore, or emit a synthetic state change. Frameless application-level soft resize owns pointer capture and MUST use only in-place bounds/repaint work until capture is released; post-completion artifact clearing is a separate terminal step.
- Composition investigation law: `SW_SHOWMINNOACTIVE -> SW_RESTORE` is a shell-state recovery, not a repaint primitive. The former 120ms ordinary-`WM_SIZE` throttle was explicit UX debt and is removed. During a native resize, `WM_SIZE` synchronizes host/WebView geometry and records terminal-recovery eligibility only; `WM_EXITSIZEMOVE` may queue one recovery after an observed resize. Do not preserve, retune, or reintroduce continuous clears without measuring clear reason/count/cost against this terminal-only baseline; a trailing delay is an experiment, not a default fix. The active Wry path uses windowed WebView2 controller hosting, so this is a host/composition diagnosis, not evidence against Rust or the `windows` projections.
- Windows composition diagnostic law: `example:win32-bug` is Windows-only evidence tooling, not a public API or a repaired clear path. It reuses the Window card and compares manual `clearWhiteBlock` against a reversible one-pixel resize pulse in the real host. The example forces `OPENTRAY_WINDOWS_AUTO_CLEAR_WHITE_BLOCK=0` so the pulse cannot include automatic shell recovery; manual clear remains the shell-state control. `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1` may log requested background/backing policy, HWND state, operation reason, and elapsed shell-clear time, but it MUST NOT claim that DWM/WebView2 pixels were cleared. Keep any non-shell candidate opt-in until the same trigger clears without shell flash, focus, input, retained-session, or visibility regression.
- WebView operational `visible` means `!closed && !minimized`, not raw `IsWindowVisible`. `toVisible()` reveals a hidden session or restores a minimized one, and `visibleChange` fires only when that projection changes. On Windows, command paths and terminal `WM_SIZE` messages update one projection so real minimize/restore cannot leave a tray primary label stale; suppress that synchronization during the internal shell-state artifact repair so its temporary minimize/restore is never observable. Keep the same command/event contract in the host facade, page bridge, Windows, and macOS implementations.
- A retained WebView tray surface uses one `primaryEvent` menu item labeled with the next action: `Show Example` when `isVisible()` is false and `Hide Example` when true. Bootstrap the first session with `show()`, reveal retained sessions with `toVisible()`, hide with `close()`, and update the menu from `visibleChange`; subscribe to any native window event only after the first successful `show()`. During final teardown, unlisten, `destroy()` the native session, then close the runtime. Do not treat a local boolean as visibility authority.
- Tray registration and `Shell_NotifyIconGetRect` must address the same identity. The vendored dependency keeps `(HWND, uID)` and contains only the minimal RGBA AND-mask correction.

Windows-visible acceptance must include the overlay and frameless geometry smoke, native tray provenance, real extended-window styles, and a consumer-app run against local broker/extension artifacts. Do not infer macOS acceptance from this evidence.

## Monorepo Law

- `packages/cli` publishes the final public npm package: `opentray`.
- Every other direct child of `packages/*` publishes as `@opentray/<directory-name>`.
- Platform binary packages are distribution atoms only; do not place fake binaries in them.
- Extension packages are capability atoms; they must depend on public OpenTray contracts, not private package internals.
- Shared TypeScript protocol types belong in `@opentray/spec`.

## OpenSpec Workflow

Use the project-local `vision-driven` workflow before implementation:

```bash
bun run openspec:vision -- new <change>
bun run openspec:vision -- status <change>
bun run openspec:vision -- instructions research-plan <change>
bun run openspec:vision -- validate <change>
bun run openspec:vision -- check <change>
```

Keep `openspec/changes/<change>/plans/plan.md` as the current Intent Document SSOT.

Before materially changing an existing plan, run:

```bash
bun run openspec:vision -- backup-plan <change>
```

## Engineering Preferences

- Prefer durable platform-law changes over glue code.
- Keep package boundaries explicit and boring.
- Use TypeScript strict mode and avoid `any` / `as any` unless a third-party boundary makes it unavoidable.
- Keep public package APIs documented in README files before implementation details harden.
- Use BDD/task evidence for behavior changes.

## Verification

Baseline commands:

```bash
bun test scripts/openspec/vision-driven.test.ts
openspec schema validate vision-driven
pnpm -r list --depth -1
```

Before claiming completion, run the narrowest command set that proves the current change.

## Release Operations

OpenTray uses changesets plus npm Trusted Publishing.

Trusted publisher configuration:

```bash
pnpm run trusted-publish:dry-run
pnpm run trusted-publish:check
pnpm run trusted-publish:configure
```

Canonical trusted publisher claims:

- GitHub repository: `jixoai/opentray`
- Workflow file: `release.yml`
- Environment: `npm-release`
- Allowed npm actions: `npm publish`, `npm stage publish`

The npm CLI command uses `--file release.yml`, not `--workflow release.yml`.
The helper uses `.env` `NPM_TOKEN` by default and writes it only into a temporary npm userconfig. npm trust rejects bypass-2FA granular tokens; use `pnpm run setup:env -- --force` to recreate a trusted-publish-compatible token, or pass `--auth ambient` after completing browser/OTP npm login.

Release flow:

```bash
pnpm run changeset
git push
```

After merge to `main`, `.github/workflows/release.yml` creates a version PR or publishes via OIDC. Do not add long-lived `NPM_TOKEN` secrets for normal release publishing.

## Commit Discipline

- Keep OpenSpec artifacts, implementation, and archive work conceptually separable.
- In the empty-repository bootstrap case, a single initial commit may contain workflow, spec, and workspace skeleton because no usable baseline exists yet.
- Future changes should follow the normal OpenSpec phase split.
