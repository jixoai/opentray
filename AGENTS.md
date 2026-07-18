<!--
Orthogonal intents (maintained 2026-07-18; original user requests: investigate a macOS
pnpm-pub window that stopped responding to hide operations until daemon restart; determine why
skill-creator-v2's Hide Window and primaryEvent fail against the latest OpenTray packages; ensure
ordinary consumers need only a normal package-manager install for a coherent native runtime):
1. Preserve the tray-first App/Tray/Session platform laws.
2. Preserve native runtime and extension package boundaries across macOS and Windows.
3. Record runtime artifact compatibility, lifecycle, and diagnosis laws.
4. Preserve monorepo, OpenSpec, release, and verification laws.
5. Preserve platform-specific acceptance evidence without promoting it to cross-platform truth.
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
- Extensions add native capabilities, but they must attach through tray/session contracts (e.g. `tray.extend(...)` or `attachWebview(tray)`), not by reaching into broker internals.
- Do not make one CLI directly own another CLI's menu, events, popup, or lifecycle.
- Windows named-pipe endpoints do not include `homeDir`. Source examples must pass an explicit per-invocation caller label so they cannot attach to a same-version neutral-label broker through the neutral `opentray` endpoint.
- Source WebView examples own a Vite server instance through Vite's Node API. `server.listen()`, `resolvedUrls.local`, and `server.close()` are the lifecycle authority; never parse formatted CLI output. Bind example servers to `127.0.0.1` so Windows `localhost` DNS order cannot split the selected listener from the WebView request. On shutdown, close the runtime session before `server.close()` because Vite can wait for the live WebView HTTP connection.
- In a source WebView example, `OPENTRAY_EXT_PATH` selects only the extension DLL. Unless `OPENTRAY_BROKER_BIN` is explicitly supplied too, the launcher must still build and select the matching source-tree broker; never validate a current extension DLL against a stale packaged broker because tray events and native ABI behavior are a single host contract.
- On Windows, an initialized caller's `ClientFrame::Exit` has already completed core session cleanup. Its dedicated GUI broker must exit directly from that frame instead of waiting for a named-pipe `Disconnected` event, because a client half-close can defer that event indefinitely.
- OpenSpec workflow tests must spawn Bun directly through `process.execPath` and capture output with file descriptors; do not shell through `/bin/sh`, which does not exist on native Windows. All CLI-reported change-relative paths must normalize to `/`, so Windows filesystem separators do not corrupt TOC coverage, JSON output, or test assertions.
- Package staging must still copy runtime hosts marked executable on Windows, but Windows does not expose POSIX executable bits through `stat().mode`; assert `0o111` only on POSIX and assert file presence on Windows.
- Convert `file:` URLs to host paths with `fileURLToPath()` before handing them to a bundler, and use `pathToFileURL(path).href` for dynamic imports. Do not round-trip through `.pathname`, which duplicates Windows drive prefixes.
- Do not add platform special cases into shared layers; expose capability contracts instead.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Older docs that still mention them describe an earlier surface model.

## Runtime Compatibility And Diagnosis Laws

The following laws were established from the 2026-07-18 macOS `pnpm-pub` and `skill-creator-v2` retained-window investigations:

- A broker endpoint is currently derived from the caller package version and caller label. That identity does not fingerprint the actual OpenTray broker binary, WebView facade, or native extension library. `already-running` therefore proves process liveness only; it does not prove runtime artifact compatibility.
- A temporary package runner can install a new OpenTray dependency graph while a same-endpoint broker from an earlier local or cached graph is still alive. Until runtime identity includes an artifact manifest or compatibility fingerprint, restart is the only operation that guarantees broker and extension replacement.
- Core `opentray` declarations cover generic tray/runtime contracts. Typed WebView window methods, events, and style fields belong to `@opentray/ext-webview`; absence from the core declaration file is package-boundary evidence, not a missing extension capability.
- A manifest and lockfile describe the requested dependency graph, not the installed graph. Consumer diagnosis must record `pnpm why`, resolved package versions, and `require.resolve()` or equivalent real paths before attributing strict type failures to a published SDK.
- A normal package-manager install is the consumer contract. Deleting `node_modules`, clearing caches, restarting a broker manually, or setting `OPENTRAY_EXT_PATH` are diagnostic operations only; OpenTray must not require them to obtain a coherent broker/facade/native-extension graph.
- Dynamic extension discovery currently checks the broker working directory's top-level `node_modules` platform package before facade-nested and pnpm virtual-store candidates. That precedence proves only that a file exists. It does not validate the platform package manifest, version, or artifact hash. An orphaned top-level native package can therefore shadow the installed graph even when `pnpm why` and the lockfile both report the current version.
- For native command-surface diagnosis, record the library actually loaded by the broker (`lsof -p <pid>` on macOS), then read the `package.json` beside that exact library and compare its hash with the intended virtual-store artifact. `require.resolve()` from the consumer root may identify the same stale top-level package; neither it nor `pnpm why` is sufficient alone.
- Package-manager resolution belongs to the Node SDK, which can resolve an official extension's platform package relative to the facade package that declared it. The facade may declare a platform-neutral artifact descriptor, but it must not import native packages into its public interface. The broker must receive an exact resolved library path instead of reconstructing npm/pnpm/Yarn/Bun topology in Rust.
- Dynamic loading is compatible-artifact selection, not first-file discovery. A native extension must expose generic embedded identity (extension name, ABI, artifact-set identity, contract fingerprint, target, and build identity); `load-ext` must carry the facade's expected identity. The generic loader must reject or skip mismatched candidates before init and report every rejection reason without parsing extension-specific commands.
- Existing-broker reuse must validate the resolved broker artifact identity, not only caller package version, endpoint, or PID liveness. A mismatch must trigger bounded automatic replacement so a dependency update cannot keep an older broker alive behind the same consumer endpoint.
- Diagnose retained-window failures as a command chain: `menuClick -> facade command -> broker extension dispatch -> native window state`. If `close()/hide()` returns successfully but native visibility stays true, inspect AppKit/Win32 projection. If a newly added command such as `isVisible` is rejected while older event commands still work, inspect broker/dylib command-surface skew before changing window code.
- The dynamic extension ABI must preserve actionable rejection detail. A bare `returned code 1` only identifies `EXT_ERR_REJECTED`; run an isolated broker with `OPENTRAY_DAEMON_STDIO=inherit` or add bounded diagnostic transport before attributing the failure to a specific native branch.
- Native acceptance must use one coherent artifact graph. Record the broker executable path, loaded extension library path, hashes or versions, endpoint identity, and PID before a restart destroys the evidence. A successful restart is runtime-replacement evidence, not proof of the original root cause.
- Extension cleanup remains session-authoritative. Extension state must be scoped to its owning `(appId, trayId, sessionId)` and a session-close callback must not clear another live session's retained window.

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
- `style.platform.windows.showInSwitchers` owns taskbar/Alt+Tab projection. Default `false` means `WS_EX_TOOLWINDOW` and no `WS_EX_APPWINDOW`; title and icon metadata do not decide switcher membership. Comparator/probe topology may change native frame geometry, but it must obey the same switcher projection.
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

## Windows WebView2 Profile Law

- WebView2 user data must not inherit the broker executable path. Temporary package runners such as 'pnpx' can place 'opentray.exe' deeply enough to make the default WebView2 profile fail during environment creation.
- The Windows host owns an explicit 'WebContext' profile under '<home>/.opentray/webview/<package-version>/<caller-label>'; 'OPENTRAY_WEBVIEW_DATA_DIR' is the deployment and diagnostic override.
- 'WebContext' is a retained native resource and must be stored beside 'WebView' so it outlives the child. A WebView2 creation error must include the resolved profile path.
