<!--
Orthogonal intents (maintained 2026-07-21; original user requests: investigate a macOS
pnpm-pub window that stopped responding to hide operations until daemon restart; determine why
skill-creator-v2's Hide Window and primaryEvent fail against the latest OpenTray packages; ensure
ordinary consumers need only a normal package-manager install for a coherent native runtime;
move skill-creator-v2's app-icon generation into a linked @opentray/vite-plugin with source and
implementation-aware caching; make appIcon a strict platform-standard asset array distinct from
tray Icon so consumers may supply independently generated native assets; add semantic App icon
variants whose omitted name is default and whose selection remains Core-owned; let a stable
app-mode entry relaunch the latest `process.argv` invocation or an explicit launch script
; eliminate duplicate same-AppId Dock carriers and make detached broker/carrier failures
observable in stable logs; make a live Dock click reveal and focus the latest retained app-mode
WebView without spawning a second consumer; recover tray startup after an interrupted caller leaves
a stale broker lock; publish skill-creator-v2 appMode adaptation decisions under the public
skills/opentray tree instead of repository-internal skills (2026-07-21)):
1. Preserve the tray-first App/Tray/Session platform laws.
2. Preserve native runtime and extension package boundaries across macOS and Windows.
3. Record runtime artifact compatibility, lifecycle, and diagnosis laws.
4. Preserve monorepo, OpenSpec, release, and verification laws.
5. Preserve platform-specific acceptance evidence without promoting it to cross-platform truth.
6. Preserve the cross-platform window-shell role contract and its platform projections.
7. Preserve the split between platform-neutral Core identity contracts and Darwin runtime carrier packaging.
8. Preserve App icon catalog/variant state without giving WebView, badge, or tray projections App identity authority.
9. Preserve stable App launch intent without promoting Node process commands into Core protocol state.
10. Preserve public consumer documentation ownership separately from repository-internal agent law.
Compromise: AGENTS.md is the required project-wide agent SSOT, so these law families cannot be
physically split without losing the single discovery entrypoint required by repository tooling.
-->

# OpenTray Agent Guide

## Vision

OpenTray is a Desktop Status Platform for Node/Deno/Bun CLI and AI-skill ecosystems.

The product goal is not "show a tray icon". The goal is to give lightweight tools a system-level entry point without forcing users into Electron or a full desktop app framework.

## Platform Laws

OpenTray uses the current tray-first model. Application code calls `createTray()` directly and owns its own foreground/background lifetime.

- `App` is the caller-owned runtime identity and isolation boundary (passed through `createTray(options, { appId, appName })`, not a separate `createApp` call).
- `Tray` is one desktop status atom owned by that app/runtime.
- `Session` is the live source of authority for tray events and mutations; closing a session removes its tray contributions.
- Top-level `createTray()` owns the broker connection it creates. Its `destroy()` must remove the tray and close that caller session exactly once; tray creation failure must close the connection before returning the error.
- Extensions add native capabilities, but they must attach through tray/session contracts (e.g. `tray.extend(...)` or `attachWebview(tray)`), not by reaching into broker internals.
- Do not make one CLI directly own another CLI's menu, events, popup, or lifecycle.
- Windows named-pipe endpoints do not include `homeDir`. Source examples must pass an explicit per-invocation caller label so they cannot attach to a same-version neutral-label broker through the neutral `opentray` endpoint.
- Source examples must derive one short per-invocation token for both temporary home and caller label. It must retain PID-level isolation and Windows pipe uniqueness while keeping the complete macOS/Linux Unix socket path below the native `sun_path` byte limit; do not repeat descriptive example names through both path segments.
- Source WebView examples own a Vite server instance through Vite's Node API. `server.listen()`, `resolvedUrls.local`, and `server.close()` are the lifecycle authority; never parse formatted CLI output. Bind example servers to `127.0.0.1` so Windows `localhost` DNS order cannot split the selected listener from the WebView request. On shutdown, close the runtime session before `server.close()` because Vite can wait for the live WebView HTTP connection.
- In a source WebView example, `OPENTRAY_EXT_PATH` selects only the extension DLL. Unless `OPENTRAY_BROKER_BIN` is explicitly supplied too, the launcher must still build and select the matching source-tree broker; never validate a current extension DLL against a stale packaged broker because tray events and native ABI behavior are a single host contract.
- Windows cannot replace a running source broker executable in place. Source SDK and example builds must use a caller-scoped Cargo target directory; never stop every broker that happens to share one workspace executable, because caller isolation remains authoritative during source rebuilds.
- On Windows, an initialized caller's `ClientFrame::Exit` has already completed core session cleanup. Its dedicated GUI broker must exit directly from that frame instead of waiting for a named-pipe `Disconnected` event, because a client half-close can defer that event indefinitely.
- OpenSpec workflow tests must spawn Bun directly through `process.execPath` and capture output through file-backed Bun sinks/sources; do not shell through `/bin/sh`, which does not exist on native Windows. Numeric fds and nested pipes can silently lose child output under Bun 1.3. All CLI-reported change-relative paths must normalize to `/`, so Windows filesystem separators do not corrupt TOC coverage, JSON output, or test assertions.
- Package staging must still copy runtime hosts marked executable on Windows, but Windows does not expose POSIX executable bits through `stat().mode`; assert `0o111` only on POSIX and assert file presence on Windows.
- Convert `file:` URLs to host paths with `fileURLToPath()` before handing them to a bundler, and use `pathToFileURL(path).href` for dynamic imports. Do not round-trip through `.pathname`, which duplicates Windows drive prefixes.
- Do not add platform special cases into shared layers; expose capability contracts instead.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Older docs that still mention them describe an earlier surface model.

## External Extension Ownership

Lynx is an independently releasable official extension owned by
[`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx). This repository
keeps only generic extension ABI/loader, `@opentray/spec`, and `TrayHandle.extend` contracts;
it must not build, stage, or publish Lynx packages, native libraries, runtime carriers, or smoke assets.

## Runtime Compatibility And Diagnosis Laws

The following laws were established from the 2026-07-18 macOS `pnpm-pub` and `skill-creator-v2` retained-window investigations:

- A broker endpoint is derived from the caller package version and caller label, but endpoint identity alone does not fingerprint the executable or native extensions. `already-running` is valid only after caller-scoped ready metadata matches the currently resolved broker path and artifact identity; PID liveness alone is never reuse authority.
- A temporary package runner can install a new OpenTray dependency graph while a same-endpoint broker from an earlier local or cached graph is still alive. The SDK must hash the broker selected by the current install, replace identity-free or mismatched live brokers under the caller lock, and validate each extension manifest before init. Manual restart remains diagnostic evidence, not a consumer setup step.
- Core `opentray` declarations cover generic tray/runtime contracts. Typed WebView window methods, events, and style fields belong to `@opentray/ext-webview`; absence from the core declaration file is package-boundary evidence, not a missing extension capability.
- A manifest and lockfile describe the requested dependency graph, not the installed graph. Consumer diagnosis must record `pnpm why`, resolved package versions, and `require.resolve()` or equivalent real paths before attributing strict type failures to a published SDK.
- A normal package-manager install is the consumer contract. Deleting `node_modules`, clearing caches, restarting a broker manually, or setting `OPENTRAY_EXT_PATH` are diagnostic operations only; OpenTray must not require them to obtain a coherent broker/facade/native-extension graph.
- Stable Darwin Bundle ownership follows the package nearest the running consumer script. Ambient `npm_package_json` describes the nested package-manager runner and is only a fallback; it must not rename a caller's stable Bundle to `webui` or another workspace package.
- After a successful local handshake and launch-descriptor commit, the runtime converges dead OpenTray-owned bundles with the same `CFBundleIdentifier`: it unregisters them from LaunchServices and removes them, while preserving the current Bundle and any live owner marker. Failed initialization never performs this cleanup.
- Detached broker stdout/stderr append to `<runtimeDir>/broker.log` by default. `OPENTRAY_DAEMON_STDIO=inherit` is interactive debugging; `ignore` is an explicit silence choice. A non-empty unknown value must not silently discard diagnostics.
- Broker readiness is a bounded native cold-start budget, not a fixed number of optimistic polling
  attempts. The default budget must cover Darwin carrier/AppKit initialization, and the caller lock
  budget must cover that readiness window. Every poll still validates PID liveness and exact artifact
  identity; timeout diagnostics must name the broker log before terminating the child.
- Earlier dynamic extension discovery checked the broker working directory's top-level `node_modules` platform package before facade-nested and pnpm virtual-store candidates. The current facade path instead resolves one real library from the declaring facade's dependency closure and the broker treats that absolute request as authoritative; it never falls back to diagnostic candidates or reconstructs package roots for that request.
- For native command-surface diagnosis, record the library actually loaded by the broker (`lsof -p <pid>` on macOS), then read the `package.json` beside that exact library and compare its hash with the intended virtual-store artifact. `require.resolve()` from the consumer root may identify the same stale top-level package; neither it nor `pnpm why` is sufficient alone.
- Package-manager resolution belongs to the Node SDK, which can resolve an official extension's platform package relative to the facade package that declared it. The facade may declare a platform-neutral artifact descriptor, but it must not import native packages into its public interface. The broker must receive an exact resolved library path instead of reconstructing npm/pnpm/Yarn/Bun topology in Rust.
- Dynamic loading is compatible-artifact selection, not first-file discovery. A native extension must expose generic embedded identity (extension name, ABI, artifact-set identity, contract fingerprint, target, and build identity); `load-ext` must carry the facade's expected identity. The generic loader must reject or skip mismatched candidates before init and report every rejection reason without parsing extension-specific commands.
- The extension ABI manifest and structured error symbols are required host contracts. The broker must read and free the manifest before `init`, and init/command/session-cleanup rejection must preserve the extension category and message instead of collapsing to a numeric result code.
- Diagnostic artifact classification must consume structured loader categories. ABI compatibility must never be inferred from human-readable error substrings because wording is not a runtime contract.
- Native build jobs must inspect each extension library on its native runner and record its embedded manifest plus SHA-256 in build evidence. Cross-platform staging may trust that recorded manifest only after the downloaded bytes match the recorded SHA and the current facade contract and platform package target match the evidence.
- Existing-broker reuse must validate the resolved broker artifact identity, not only caller package version, endpoint, or PID liveness. A mismatch must trigger bounded automatic replacement so a dependency update cannot keep an older broker alive behind the same consumer endpoint.
- The SDK resolves one broker executable per start attempt, hashes its bytes with the current target, and passes the canonical path plus expected identity to the broker. The broker recomputes `current_exe()` before readiness so a path replacement race cannot publish a false identity.
- Caller-scoped `ready.json` and the protocol `ready` frame carry the same broker artifact identity. A client handshake rejects expected/actual mismatch before any tray command; an identity-free or mismatched live PID is replaced under the existing bounded lifecycle lock.
- Diagnose retained-window failures as a command chain: `menuClick -> facade command -> broker extension dispatch -> native window state`. If `close()/hide()` returns successfully but native visibility stays true, inspect AppKit/Win32 projection. If a newly added command such as `isVisible` is rejected while older event commands still work, inspect broker/dylib command-surface skew before changing window code.
- The dynamic extension ABI must preserve actionable rejection detail. A bare `returned code 1` only identifies `EXT_ERR_REJECTED`; run an isolated broker with `OPENTRAY_DAEMON_STDIO=inherit` or add bounded diagnostic transport before attributing the failure to a specific native branch.
- Native acceptance must use one coherent artifact graph. Record the broker executable path, loaded extension library path, hashes or versions, endpoint identity, and PID before a restart destroys the evidence. A successful restart is runtime-replacement evidence, not proof of the original root cause.
- `@opentray/vite-plugin` optionally owns consumer app-icon normalization and ICNS/ICO/Linux theme
  generation. Its cache
  identity includes the source image, the linked generator source, the built generator
  implementation, the rendering recipe, encoder versions, and every output path. Linked consumers
  must rebuild the plugin before `vite dev` or `vite build`; source-dev tray lookup prefers
  `webui/static` so a stale build directory cannot shadow the current generated asset.
- Generated preview/Linux PNGs use 72 DPI. ICNS encoding uses explicit macOS @1x/@2x tags with
  decoded/re-encoded PNG payloads, so AppKit sees 1024 px / 512 pt, 512 px / 512 pt, and
  512 px / 256 pt representations instead of inheriting a source image's physical density. The
  encoder and representation recipe are cache identity.
- Release-grade extension manifest inspection must execute a same-target native inspector built beside the extension. Do not depend on `bun:ffi` for this gate because Windows arm64 Bun builds may disable TinyCC and `dlopen()` entirely.
- Extension cleanup remains session-authoritative. Extension state must be scoped to its owning `(appId, trayId, sessionId)` and a session-close callback must not clear another live session's retained window.

## Window Shell Mode Law

The public WebView window contract uses `style.appMode`, not a platform behavior name such as
`showInSwitchers`. The old Windows-only field has been removed; native adapters project the common
mode directly:

- `appMode: true` means the caller wants an ordinary desktop application window.
- `appMode: false` means the caller wants a tray-owned utility window outside ordinary application
  switching surfaces; this remains the default.
- The mode is a durable source fact. Visibility, minimization, and close/reveal lifecycle decide
  when that fact is projected into the native shell; `keepOnTop` remains an independent explicit
  z-order capability and must not be used as a substitute for application participation.
- Windows maps the mode to `WS_EX_APPWINDOW`/`WS_EX_TOOLWINDOW`, taskbar, and Alt+Tab projection.
- macOS maps the set of active app-mode windows through the Darwin runtime carrier to
  Regular/Accessory activation and Dock participation. This is an app-level projection and must
  aggregate by `(appId, trayId, sessionId)` without allowing one session close to clear another.
- Native adapters must not reintroduce a public switcher-specific alias; Shell membership is always
  derived from the common application mode.
- `appMode` does not imply framelessness, auto-hide, material, or titlebar composition. Those
  remain orthogonal style facts.

## App Icon Law

- App name has two projections. Bootstrap `appName` is written into the caller-specific Darwin
  carrier's `CFBundleName` and `CFBundleDisplayName` before launch; this is the authoritative
  Dock/Cmd+Tab name for that process lifetime.
- `tray.app.setName(name)` mutates logical Core identity and any truthful live backend projection.
  On macOS, `NSProcessInfo.processName` is not authority for LaunchServices bundle identity and
  must not be documented as dynamically renaming the running app in Dock or Cmd+Tab. A changed
  macOS Shell name requires a new process launched from a carrier materialized with that name;
  OpenTray must not hide that lifecycle reset behind a successful in-session mutation.

- `appIcon` is App identity, not WebView window metadata. Its protocol source of truth is the
  platform-neutral `AppOptions.appIcon` / Rust `app_icon` field.
- `AppIcon` is an array of platform-standard assets: one `darwin/icns`, one `windows/ico`, and
  Linux `png` theme entries with explicit sizes and/or one `svg`. Sources are native encoded bytes
  or files whose bytes match the declared format; raw RGBA, text, template images, URLs, and page
  favicons are invalid.
- Each asset may declare `variant?: string | readonly string[]`. Omission is the canonical `default`
  variant; one asset may serve aliases such as `["default", "light"]`. Names are arbitrary
  application states such as `light/dark` or `empty/files`, not a Core-owned theme enum.
- Darwin and Windows entries are unique per variant. Linux fixed-size PNG entries are unique by
  variant and size. An explicit array must contain the current platform's `default` projection and
  is rejected before broker connection when malformed, duplicated, unreadable, incomplete, or
  format-mismatched.
- File sources are validated relative to the caller and canonicalized to absolute paths before
  broker dispatch. A reused broker working directory must never reinterpret an App identity asset.
- Omitted `appIcon` never inherits tray artwork. Packaged/carrier identity wins when present, then
  the operating-system executable/default artwork applies. This keeps tray templates and App
  identity independently reproducible.
- Creating an already-known explicit `appId` is idempotent. It returns the existing App identity
  without clearing its name, icon, or trays; callers use the App mutation API for deliberate
  identity changes.
- Core retains the declared App icon catalog plus the active variant. `tray.app.setAppIcon(name)`
  selects a declared name without involving `ext-webview`; direct AppIcon input replaces the
  catalog and resets selection to `default`. Missing variants reject before state or native
  projection changes.
- Public App icon methods are explicitly named `getAppIcon`, `getAppIconVariant`, and `setAppIcon`.
  The type surface exposes literal variant-name extraction for application-owned IPC contracts;
  OpenTray does not provide automatic theme observation.
- App identity and window icon remain separate facts. An app-mode window may project `appIcon` to
  the taskbar/Dock while `icon` continues to control the window chrome and page metadata sync.
- On macOS, a Darwin ICNS asset is applied through `NSApplication.applicationIconImage` and the
  mutation must be followed by an explicit
  `NSDockTile.display()` refresh. A caller-specific `.app` carrier establishes bundle identity, but
  it does not by itself invalidate a Dock tile that was initialized from the executable artwork.
  The Accessory-to-Regular activation-policy transition may re-read that bundle artwork; the
  adapter must preserve and reapply the projected Core App icon after the transition.

## Darwin Runtime Carrier Law

- `opentray-core` is the platform-neutral kernel/protocol layer. It may own App identity state,
  mutation frames, and `AppProjection`, but it must not import AppKit, contain `.app` files, or
  launch a native carrier.
- The OpenTray Darwin runtime distribution is a core release atom. Each matching
  `@opentray/darwin-*` package must contain the broker executable and the shared `.app` carrier
  required for AppKit activation policy, Dock participation, and App identity projection.
- The shared carrier is built and discovered by the runtime/release layer. `ext-badge` may consume
  the carrier contract, but it owns only badge/overlay semantics and its native library; it must
  not remain the source of the runtime `.app` bundle.
- A normal package-manager install must yield a coherent broker-plus-carrier artifact graph. A
  consumer must not copy a helper bundle manually or install `ext-badge` merely to obtain normal
  app-mode behavior.
- Darwin runtime packages publish one broker executable plus a minimal `app/Info.plist` template;
  they must not publish a second broker copy embedded in a compressed carrier artifact. The Node runtime owns the
  caller-specific bundle at `~/.opentray/apps/<encoded-package>/<app-name>.app` or an explicit
  `appBundle.path`, and launches the broker from `Contents/MacOS/opentray`.
- Managed bundle generation defaults to `appBundle.reinitialize: true`, keeps the directory stable,
  replaces OpenTray-owned files through sibling paths, and commits
  `Contents/Resources/opentray-app-bundle.json` last. `reinitialize: false` performs read-only
  validation of prebuilt assets; it must reject target, identity, template, icon, or broker drift
  with a typed error. Runtime-owned launch state remains governed by the separate law below.
- The stable bundle is a single-writer resource. A live incompatible owner must not be overwritten:
  the runtime may stop its own caller-scoped broker and retry, while a different live owner receives
  a typed `bundle_in_use` failure. Build adapters delegate generation to `@opentray/packaging`.
- A successful local handshake makes the current validated Bundle the sole managed carrier for its
  App identity. Dead wrong-package and legacy carriers are unregistered and removed after the
  descriptor commit; live owner markers are preserved and reported in `broker.log`.

## App Launch Command Law

- `appLaunch` is runtime/carrier launch intent, not Core `AppProjection`, tray state, WebView
  metadata, or a shell command string. Its public vector is `command`, optional `args`, and
  optional `cwd`; it never persists the caller's full environment map.
- Omitted or `null` `appLaunch` snapshots `process.execPath`, `process.argv.slice(1)`, and
  `process.cwd()`. An explicit path-like command and relative cwd resolve from the current working
  directory; a bare executable name remains eligible for normal `PATH` lookup.
- The mutable last invocation lives at `Contents/Resources/opentray-launch.json`, physically
  separate from immutable `opentray-app-bundle.json` compatibility identity. It is atomically
  committed under the stable bundle lock only after the local broker handshake succeeds,
  including when a compatible broker is reused.
- `appBundle.reinitialize: false` keeps broker, plist, icon, and compatibility manifest bytes
  read-only after validation. The launch descriptor remains explicitly runtime-owned and mutable;
  incompatible prebuilt bundles fail before launch state is updated.
- The Darwin carrier accepts a cold launch only with no arguments or one LaunchServices
  `-psn_*` argument, strictly parses the descriptor, appends carrier events to
  `Contents/Resources/opentray-launch.log`, spawns the vector once without a shell, routes child
  stdout/stderr to that log, and exits without waiting. The private `broker` subcommand remains
  unchanged.
- `opentray-launch.log` records descriptor/bundle paths, command and cwd identity, spawned PID,
  and exact read/parse/spawn errors without persisting the process environment. It is the first
  diagnostic surface for a pinned Dock entry that fails to relaunch.
- Cold launch after process exit is distinct from a live-process Dock reopen. Windows and Linux
  taskbar entries are not persistent launchers merely because a window uses `appMode`; those
  platforms require their own shortcut/launcher atoms before equivalent persistence is claimed.
- A live Darwin Dock reopen emits one app-scoped `reopenRequested` event through the generic
  broker protocol. It never executes `appLaunch`; the cold descriptor is process-start-only.
- `@opentray/ext-webview` owns the default projection: among bootstrapped retained windows whose
  current style has `appMode: true`, select the most recently active one and run `toVisible()` then
  `focus()`. Core transports intent but never selects or commands a WebView.
- `WebviewWindowHandle.focus()` and `navigator.opentrayWindow.focus()` are explicit lower-level
  capabilities on macOS and Windows. They remain orthogonal to visibility, even where a native
  substrate must also raise or restore the window to obtain foreground focus.
- Development launch descriptors must reconstruct the supervisor that owns the complete app tree.
  A Vite consumer should persist the absolute JavaScript runtime with Vite's real
  `node_modules/vite/bin/vite.js` entry and the frontend workspace as `cwd`. Do not persist pnpm,
  a package script, or a `.bin/vite` shell shim: each adds another bare runtime lookup that Finder's
  minimal `PATH` cannot satisfy. Never persist only the daemon child or a shell string.
- A source-linked consumer must stage the matching facade, broker/carrier, and native extension
  artifacts before runtime acceptance. This is a link-development prerequisite only; a registry
  install must remain coherent after normal package-manager installation.
- Caller serialization state is recoverable ownership, not an operator repair burden.
  `broker.lock` records the caller PID and a unique token; contention preserves a live PID but
  automatically reclaims a dead owner, including the earlier PID-only format. Release removes the
  lock only when its token still matches, so delayed cleanup cannot delete a replacement owner.

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
- `style.appMode` owns taskbar/Alt+Tab projection. Default `false` means `WS_EX_TOOLWINDOW` and no `WS_EX_APPWINDOW`; title and icon metadata do not decide switcher membership. Comparator/probe topology may change native frame geometry, but it must obey the same application-mode projection.
- Common `style.autoHide` defaults to `true`. Native focus loss hides the retained session only when `autoHide && !keepOnTop`; `keepOnTop: true` and `autoHide: false` are independent suppression paths. The hide must preserve the session and emit operational `visibleChange(false)`. Control/comparator examples explicitly use `autoHide: false` so DevTools and observation windows do not dismiss the specimen.
- Public Windows window bounds are DWM visible-frame logical pixels. `moveTo` and `resizeTo` must compensate the raw invisible-border delta before `SetWindowPos`.
- Frameless and overlay windows use full-client `WM_NCCALCSIZE` for every Win32 message form. For Windows overlays, `AppWindowTitleBar.LeftInset`, `RightInset`, and `Height` are the safe-area authority and must be read synchronously on the HWND-owning STA; DWM caption-button bounds are only a lower-level rectangle, not an equivalent width contract.
- `windowControlsOverlay: true` uses system colors. Its Windows object form accepts opaque `backgroundColor` and `symbolColor`; box them as WinRT `IReference<Color>` and apply them through `AppWindowTitleBar` before first show. macOS keeps transparent native controls and does not emulate these colors.
- `style.resizable` is a common user-resize intent. Its effective default is `true` for framed windows and `false` for frameless windows; once explicitly supplied, later `frameless` updates preserve it. Programmatic `resizeTo` is independent from this intent.
- A common WebView capability added to TypeScript must be serialized by every native platform `WindowCapabilities` DTO and constructor. Do not treat Windows compilation as proof for macOS DTO parity; release-grade Darwin WebView builds are the cross-platform compiler gate.
- A Windows frameless window removes `WS_THICKFRAME` and disables DWM non-client rendering; it does not imply a transparent or material background. When its effective `resizable` state is true, the WebView bootstrap reserves trusted primary gestures inside a six-CSS-pixel edge band and the HWND owns capture, constrained physical geometry, cursor, cancellation, and end events. A regular Chromium vertical scrollbar coexists with the right and bottom-right gestures; do not prescribe a page gutter or custom scrollbar as a prerequisite. Those remain application layout options only when custom edge hit testing must avoid the reserved band.
- Windows cold-start construction is a separate procedure from retained style updates: create the hidden top-level HWND with `CS_HREDRAW | CS_VREDRAW` and no `CS_OWNDC`, publish host paint/material ownership, project Win32/DWM style, apply final initial geometry, commit the complete native client, then create and attach the alpha-capable WebView2 child. AppWindow titlebar overlay is the exception: initialize it only after WebView2 establishes COM on the HWND-owning thread and before the first final child bounds/show; applying AppWindow during the pre-WebView phase makes ordinary overlay bridge actions terminate the broker. Never run the visible-frame size correction before WndProc owns the material base. Retained style updates keep the existing order: publish policy, suppress attached-surface commits, project native style and AppWindow overlay, complete parent, then commit WebView2 background/bounds. `WM_WINDOWPOSCHANGED` remains position-only; `WM_SIZE` runs `host paint -> controller bounds -> WRY child bounds -> parent-position notification`.
- `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` delimit native dragging and resizing. A pure move only notifies parent position. Frameless application-level soft resize owns pointer capture and uses in-place HWND/WebView geometry until capture is released; it does not use shell transitions or synthetic terminal geometry pulses.
- Windows material-host law: Mica, Acrylic, Tabbed, and semantic blur keep the DWM redirection surface and paint the complete top-level HWND client with `BLACK_BRUSH` in both `WM_ERASEBKGND` and `WM_PAINT`. Black is the composition base, not a visible black overlay: DWM material remains visible above it. Initial material projection uses system backdrop plus the extended client frame and does not add `DwmEnableBlurBehindWindow`; that blur-behind path belongs only to plain transparent hosts. Opaque and plain transparent windows keep the existing `WS_EX_NOREDIRECTIONBITMAP` plus Softbuffer fill path. `WM_ERASEBKGND` may return handled only when one of these host paths owns the client pixels.
- Windows host-surface recommit law: `clearWhiteBlock` is a compatibility command that synchronously recommits only the configured native host surface. Material hosts request parent-only `RedrawWindow`; opaque/plain-transparent hosts re-present Softbuffer. It never changes shell state, activation, focus, visibility, HWND geometry, WebView2 controller bounds, WRY child bounds, or parent-position notification.
- Windows lifecycle law: there is no separate artifact-recovery scheduler. Retained reveal recommits the parent immediately after `ShowWindow` when needed; style/background projection and `WM_SIZE` already include the parent commit in their normal transaction. Do not add timers, private HWND messages, shell resets, width pulses, or diagnostic switches around this invariant.
- Native residue evidence law: material residue belongs to stale top-level HWND/DWM redirection content, not to DOM/WebView page pixels. A WebView restricted to one ninth of the client still leaves material residue in the other eight ninths. Keep that substrate residue distinct from classic outer-frame residue: the latter appeared only under OpenTray's custom no-paint frameless projection and disappeared when the comparator used the standalone probe's native shell.
- Windows regression-example law: `example:win32-bug` is the WebView-controlled comparator for `native-material-host-paint-probe-20260716.exe`. It enables `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`, starts at 900x620 framed Acrylic, and renders only the centered native-probe control matrix over a fully transparent page. The environment-gated native state may switch no-paint/black/gray and Acrylic/Mica/None on one retained HWND. Its frameless toggle deliberately preserves the standalone comparator's native resize frame/system menu, style-derived DWM non-client policy, native resizing, and copied-bit discard. Its `WM_NCCALCSIZE` first delegates to `DefWindowProcW`, preserves the left/right/bottom resize insets, and then resets only the client top to `DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`; this prevents an OpenTray-only Win7-style outer-frame residue. Ordinary OpenTray windows never expose those probe overrides, keep production Black material paint, and retain the production full-client/soft-resize frameless contract.
- Windows source-example comparator law: `OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR=1` selects the accepted native host topology without creating probe state, replacing the title, or enabling `win32Probe*` commands. The probe environment implies comparator topology but owns only experiment state and commands. Both `example:webview-control` and `example:win32-bug` enable comparator topology; `webview-control --no-overlay` is the direct HWND/DWM/style/geometry/frameless A/B path, while default overlay adds only the post-WebView AppWindow stage. Ordinary applications keep production topology.
- WebView operational `visible` means `!closed && !minimized`, not raw `IsWindowVisible`. `toVisible()` reveals a hidden session or restores a minimized one, and `visibleChange` fires only when that projection changes. Production host painting has no shell-state transition to hide. Keep the same command/event contract in the host facade, page bridge, Windows, and macOS implementations.
- Host-side WebView window-event polling is one shared single-flight drain loop. A transport failure stops the interval and is reported once; listener count must not create overlapping 16 ms requests or duplicate `broker connection closed` diagnostics.
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

### Documentation Ownership

```text
README.md                  capability discovery and shortest public path
skills/opentray/           public consumer decisions, scenarios, and tutorials
.agents/skills/*           repository-internal development and maintenance law
packages/*/README.md       package-specific public API contract
```

- Keep detailed consumer integration guidance in `skills/opentray`; every
  progressive reference must be reachable directly from its `SKILL.md`.
- Keep the root README concise. It may introduce a capability and link the
  public Skill, but it must not duplicate full lifecycle decision trees.
- Do not place package-consumer tutorials in `.agents/skills/*`; those Skills
  govern contributors changing this repository and may expose internal source,
  release, or architecture assumptions that installed-package users do not own.
- Do not place source checkout paths, workspace scripts, linked-consumer
  staging, native build commands, contributor smoke tests, or release operations
  in `skills/opentray`; a normal package-manager install is its starting state.

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

After merge to `main`, `.github/workflows/release.yml` materializes the versioned release source before native compilation. Stable releases commit that source directly to `main`; alpha releases transport one generated patch. Native matrix jobs and the publish job must consume that same source view so embedded native identities equal the package versions being published. Publishing then uses OIDC; do not add long-lived `NPM_TOKEN` secrets for normal release publishing.

## Commit Discipline

- Keep OpenSpec artifacts, implementation, and archive work conceptually separable.
- In the empty-repository bootstrap case, a single initial commit may contain workflow, spec, and workspace skeleton because no usable baseline exists yet.
- Future changes should follow the normal OpenSpec phase split.

## Windows WebView2 Profile Law

- WebView2 user data must not inherit the broker executable path. Temporary package runners such as 'pnpx' can place 'opentray.exe' deeply enough to make the default WebView2 profile fail during environment creation.
- The Windows host owns an explicit 'WebContext' profile under '<home>/.opentray/webview/<package-version>/<caller-label>'; 'OPENTRAY_WEBVIEW_DATA_DIR' is the deployment and diagnostic override.
- 'WebContext' is a retained native resource and must be stored beside 'WebView' so it outlives the child. A WebView2 creation error must include the resolved profile path.
