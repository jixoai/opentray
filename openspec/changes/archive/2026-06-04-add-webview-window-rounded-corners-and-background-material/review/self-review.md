# Self Review

## Decision Check

- `ext-webview` stays on the existing `NSWindow + wry` runtime and does not introduce Tao.
- Native material remains an AppKit/WebView-hosted window effect instead of a page-painted blur.
- Rounded corners stay on the native shell through layer-backed clipping, not CSS border radius.
- Transparent background semantics remain extension-owned and are coordinated with the native material state.

## Contract Check

- `show(...)` and `setStyle(...)` can drive `frameless`, `transparent`, `backgroundEffect`, `backgroundEffectState`, and `cornerRadius`.
- `getStyle()` reports the actual native style state, including explicit numeric `cornerRadius` or platform-default `null`.
- Borderless glass uses the native window shell and native blur/material backdrop instead of page-level chrome tricks.
- System-default corner behavior is preserved when callers do not opt into a numeric radius.

## Boundary Check

- No WebView-specific material or corner-radius parsing was added to `opentray-core` or `opentray-bin`.
- `window-vibrancy` is used only as a helper inside the extension-owned macOS runtime.
- The page is constrained to rendering inside the native shell; shell blur, clipping, and transparency remain native concerns.

## Verification Evidence

- `pnpm --filter @opentray/ext-webview test`
- `cargo test -p opentray-ext-webview`
- `bun run openspec:vision -- validate add-webview-window-rounded-corners-and-background-material`
- Focused grep checks proving `opentray-core` and `opentray-bin` do not parse WebView material/corner commands
- Manual `pnpm --filter opentray example:webview-control` acceptance:
  - transparent-only mode is fully transparent
  - glass mode uses native blur/material
  - borderless glass plus system corners are visible
  - adjustable corner radius works in frameless mode
- `git diff --check`

## Residual Risk

- Material families and corner semantics are truthfully modeled as platform-owned effects; future Windows/Linux support will need their own capability matrix instead of pretending to share identical substrates.
- Visual correctness still depends on keeping the page itself free of synthetic shell styling such as CSS border radius or fake blur.
