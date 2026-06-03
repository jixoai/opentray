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
- event listening for host-window lifecycle and frame changes

Keep global overrides opt-in. Do not silently override standard globals by default.

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
- the page can prove optional `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides when enabled
- `fitContentSize` default behavior avoids obvious dead margin / black-edge confusion
- explicit fixed sizing still works when requested
- unsupported style features fail explicitly instead of pretending support
