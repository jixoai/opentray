# Self Review

## Decision Check

- `ext-webview` remains on the existing `NSWindow + wry` runtime.
- Tao is not introduced for this capability stage.
- `window-vibrancy` is used only as the macOS material projection helper on the existing AppKit view handle.
- Transparent background, title, icon, screen, and sync policy remain owned by the WebView extension dylib.

## Contract Check

- `show(...)` now accepts additive title/icon/style/sync/screen options.
- `navigator.window` / `navigator.opentrayWindow` gained title and icon methods over the existing private bridge family.
- `navigator.screen` / `navigator.opentrayScreen` expose a screen-details-like `getScreenDetails()`.
- `window.getScreenDetails` is opt-in through the same global-binding law as `window.close`.
- Title and favicon sync are declarative and direction-aware.
- Native icon projection is best-effort; page favicon and native icon remain distinct state domains.

## Boundary Check

- No WebView-specific title/icon/screen parser was added to `opentray-core` or `opentray-bin`.
- Release linkage still keeps `WebKit.framework` on `libopentray_ext_webview.dylib`, not on the daemon binary.
- `@opentray/ext-webview` remains a platform-neutral TypeScript facade.

## Verification Evidence

- `pnpm --filter @opentray/ext-webview test`
- `pnpm --filter @opentray/ext-webview typecheck`
- `pnpm --filter @opentray/ext-webview build`
- `cargo fmt -p opentray-ext-webview --check`
- `cargo test -p opentray-ext-webview -- --nocapture`
- `cargo build --release -p opentray-bin -p opentray-ext-webview`
- `wc -c target/release/opentray target/release/libopentray_ext_webview.dylib`
- `otool -L target/release/opentray`
- `otool -L target/release/libopentray_ext_webview.dylib`
- `rg` check over `crates/opentray-core` and `crates/opentray-bin` for WebView window/screen protocol terms
- `git diff --check`
- `bun run openspec:vision -- validate enrich-webview-window-macos-capabilities`

## Residual Risk

- Full `pnpm run verify` passed.
- A short daemon-tray smoke opened the WebView through the dynamic extension path and returned a `shown` event; deeper visual polish still benefits from human inspection because transparency/material/icon projection is inherently visual.
