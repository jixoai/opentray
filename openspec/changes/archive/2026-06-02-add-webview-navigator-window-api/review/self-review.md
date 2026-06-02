# Self Review

## Verdict

The navigator window bridge is implemented inside `@opentray/ext-webview` and verified at the correct boundary.

The public page-facing surface now matches the intended Tauri-style layering:

- `navigator.window`
- `navigator.opentrayWindow`
- scoped `invoke`, `listen`, and `once`
- high-level window helpers such as `close`, `moveTo`, `resizeTo`, `getStyle`, `setStyle`, and `getCapabilities`
- optional global `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides only when `bindWindowGlobals` is enabled

The private transport remains extension-owned and Wry-specific (`window.ipc.postMessage` plus native `runCallback(...)`), while `opentray-core` and `opentray-bin` stay free of public navigator protocol parsing.

This change is ready for archive. The remaining public-release mismatch belongs to the broader release/publish state, not to the navigator bridge implementation itself.

## Trace

| Intent / spec point | Implementation evidence | Verdict |
| ------------------- | ----------------------- | ------- |
| Public API should live under `navigator`, with `navigator.window` promoted and `navigator.opentrayWindow` as the prefixed fallback. | `crates/opentray-ext-webview/src/macos.rs` injects both navigator properties from the same capability object; runtime probe asserts they are the same object. | Pass |
| The page bridge should be Tauri-consistent without switching the runtime to Tauri. | The injected script defines scoped `invoke`, `listen`, and `once`, then layers higher-level helpers above them; no Tauri runtime is imported into `opentray`. | Pass |
| OpenTray control traffic must not pollute `window.postMessage` or global `message` routing. | The injected bridge uses private Wry IPC and callback ids; tests assert `window.postMessage` is not used for control traffic. | Pass |
| Global standard overrides must remain opt-in. | Runtime probe asserts `window.close`, `window.moveTo`, and `window.resizeTo` stay untouched by default and are replaced only when `bindWindowGlobals` is enabled. | Pass |
| Callback delivery should support one-shot request resolution and explicit listener teardown. | Runtime probe verifies `invoke` resolves from the first callback payload and that `listen` returns an `unlisten` function which stops further handler delivery. | Pass |
| Unsupported visual effects must fail explicitly. | `validate_style_request` rejects `transparent` and `backgroundEffect` requests with typed unsupported errors; unit tests cover both cases. | Pass |
| Navigator window request parsing and handling must stay inside the extension atom. | `NavigatorWindowRequest` parsing and `dispatch_navigator_window_command` live in `crates/opentray-ext-webview`; targeted leakage scan over `crates/opentray-core` and `crates/opentray-bin` found no public navigator protocol parsing. | Pass |
| WebView runtime ownership must stay outside the main daemon binary. | Release build size/linkage check shows `WebKit.framework` only on `libopentray_ext_webview.dylib`, not on `opentray`. | Pass |

## Verification Evidence

- `cargo test -p opentray-ext-webview` passed with 17 tests, including runtime probes for global override gating and `listen`/`unlisten`.
- `pnpm --filter @opentray/ext-webview test` passed.
- `pnpm --filter opentray typecheck` passed.
- `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray cli -- smoke daemon-tray` passed and emitted `shown`, `message`, `evaluated`, `navigated`, and `hidden`.
- `cargo build --release -p opentray-bin -p opentray-ext-webview` passed.
- `wc -c target/release/opentray target/release/libopentray_ext_webview.dylib` reported `1,873,936` bytes and `1,079,152` bytes.
- `otool -L target/release/opentray target/release/libopentray_ext_webview.dylib` confirmed `WebKit.framework` remains only on the dylib.
- `rg -n "navigator\\.window|opentrayWindow|nativeWindowApi|bindWindowGlobals" crates/opentray-core crates/opentray-bin` returned no matches.
- `pnpm run build` passed.
- `pnpm run verify` passed.
- `git diff --check` passed.
- `bun run openspec:vision -- validate add-webview-navigator-window-api` passed.
- `bun run openspec:vision -- commit-check add-webview-navigator-window-api --phase self-review` passed.

## Residual Risks

- The current bridge is macOS-first for human-visible acceptance. Linux and Windows native runtime packages still need their own platform implementations and should continue to fail explicitly until they exist.
- `transparent` and `backgroundEffect` stay intentionally unsupported on macOS in this stage. They are documented capability gaps, not accidental omissions.
- Current public npm latest still reflects the previous release state; this change's docs are accurate for the working tree and the next publish, but registry parity still depends on the release flow.

## Archive Decision

- `bun run openspec:vision -- check add-webview-navigator-window-api` should pass after this review is present.
- Normal exit: `openspec archive add-webview-navigator-window-api`
- No handoff is needed for this change in the current working context.
