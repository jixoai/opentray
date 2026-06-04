# Lynx Window Host Law

Use this reference when extending `@opentray/ext-lynx` beyond launcher-only behavior.

## Core Distinction

- `ext-webview` and `ext-lynx` may expose the same public window vocabulary.
- They must not share the same transport assumptions.
- `ext-webview` uses WebView IPC and injected page bootstrap.
- `ext-lynx` should use Lynx-native host bridges: Native Modules, runtime attach injection, and `GlobalEventEmitter`.

## Public API Direction

Prefer one user-facing window vocabulary across official rich-window extensions:

- `navigator.window`
- `navigator.opentrayWindow`
- `close`
- `moveTo`
- `resizeTo`
- `getStyle`
- `setStyle`
- `getCapabilities`
- `getTitle`
- `setTitle`
- `getIcon`
- `setIcon`
- `navigator.screen`
- `navigator.opentrayScreen`
- `getScreenDetails`
- event listening for host-window lifecycle and frame changes

Keep global overrides opt-in. Do not silently override standard globals by default.

For the Lynx bridge, prefer a Tauri-like shape:

- low-level `invoke`, `listen`, and `once`
- high-level async wrappers layered on that low-level channel
- optional `window.close()` / `window.moveTo()` / `window.resizeTo()` / `window.getScreenDetails()` overrides only when the caller explicitly enables them

Do not use `window.postMessage` as the host law. Keep OpenTray-owned capability traffic isolated from page messaging.

## Metadata and Screen Law

For a dedicated Lynx runtime process on macOS:

- `title` and `icon` are extension-owned window state, not daemon state
- the page should use the same `navigator.window` family for metadata changes
- the runtime should ship a real bundle icon so Dock identity is nonblank before page code runs
- dynamic icon projection may update both `NSWindow` and `NSApplication` within that dedicated process
- dynamic title projection must update the native window title; Dock or process-name refresh is best-effort only

Screen capability belongs in the same extension family:

- expose `navigator.screen` and `navigator.opentrayScreen`
- shape the payload after `getScreenDetails()` instead of raw monitor internals
- keep `window.getScreenDetails()` opt-in, just like other global overrides

## Sizing Law

Do not infer native window size from `document.body` or equivalent DOM semantics.

For Lynx:

- Official host behavior is host-constrained first: the native container sets screen size and frame.
- Official Lynx embedding also supports content-fit sizing modes.
- The OpenTray default-on `fitContentSize` rule is a product decision for popup-style standalone windows, not a claim that upstream LynxExplorer defaults this way.
- Therefore `fitContentSize` is a host sizing policy, not a content-layer hack.

Recommended OpenTray policy for standalone Lynx windows:

- Default `fitContentSize` to `true`
- Allow explicit opt-out with `fitContentSize: false`
- If explicit `width` / `height` are provided, they override content-fit
- Always support bounds such as `minWidth`, `minHeight`, `maxWidth`, `maxHeight`
- Throttle or coalesce repeated content-driven resize updates to avoid resize loops
- Show both fit-content and fixed-size modes in the human smoke so operators can validate the precedence rule with their eyes.

## Runtime Ownership

The `ext-lynx` native atom should own:

- window creation
- style changes
- window frame changes
- title and icon state
- screen snapshots
- content-fit policy
- bridge injection
- native-to-page event forwarding

Do not move any of these back into `opentray-core` or the daemon.

The macOS carrier law is also extension-owned:

- the host app source of truth lives under `native/lynx-runtime-macos/`
- the packaged runtime artifact is `OpenTrayLynxRuntime.app.zip`
- `scripts/release/build-lynx-runtime.sh` may reuse upstream Lynx shared libraries and build graph, but it must not go back to a patch-only `LynxExplorer.app` product path

## Acceptance Surface

For visible acceptance, prove all of these:

- a Lynx window can open from the generic extension path
- the page can call `navigator.window` or `navigator.opentrayWindow`
- the page can call `navigator.screen` and receive a durable screen-details-like payload
- the page can set title and icon through the same navigator-owned capability family
- the runtime Dock icon is nonblank before page-driven metadata changes
- the page can prove optional `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides when enabled
- `fitContentSize` default behavior avoids obvious dead margin / black-edge confusion
- explicit fixed sizing still works when requested
- unsupported style features fail explicitly instead of pretending support

If the runtime carrier needs a full Xcode build and the local machine only has Command Line Tools, treat the final carrier rebuild as a CI-owned gate:

- finish source-side protocol, smoke, docs, and static metadata tests locally
- record the CI/Xcode dependency explicitly in self-review
- do not claim the visual carrier update is fully closed until a CI-built runtime artifact has been smoked by a human
