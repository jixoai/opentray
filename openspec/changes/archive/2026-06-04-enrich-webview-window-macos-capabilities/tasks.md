## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, local `wry` API survey, local `window-vibrancy` API survey, and user Q&A.
- [x] 1.2 Confirm this is an extension-atom capability change scoped to `@opentray/ext-webview` plus `crates/opentray-ext-webview`, not a Tao-first core runtime migration.
- [x] 1.3 Confirm `window-vibrancy` is suitable only for the macOS material layer on the existing AppKit/Wry runtime, and that transparency/title/icon/screen still remain ext-webview-owned responsibilities.

## 2. BDD Contract

- [x] 2.0 Add TypeScript facade and native-parser tests proving `nativeApiPolicy` is carried declaratively, can gate capability families independently, and denies remote capability widening by default.
- [x] 2.1 Add TypeScript facade tests proving `show(...)` can carry additive `title`, `icon`, `style`, sync, and screen-binding options without changing the generic extension dispatch path.
- [x] 2.2 Add native-extension script tests proving `navigator.window` exposes `getTitle`, `setTitle`, `getIcon`, and `setIcon` over the same private bridge family as existing window methods.
- [x] 2.3 Add native-extension script tests proving `navigator.screen` and `navigator.opentrayScreen` are installed as the same object only when enabled.
- [x] 2.4 Add native-extension script tests proving opt-in `window.getScreenDetails` binding delegates to `navigator.screen.getScreenDetails()`.
- [x] 2.5 Add native-extension tests proving title sync does not bounce indefinitely when page and native title projections meet.
- [x] 2.6 Add native-extension tests proving favicon observer traffic stays inside extension-owned private internals and does not use `window.postMessage`.
- [x] 2.7 Add native-extension tests proving unsupported or partial native icon projection remains explicit instead of claiming full parity.
- [x] 2.8 Add native-extension tests proving capability metadata now covers transparent/material/title/icon/screen/global-binding support.
- [x] 2.9 Add native-extension tests proving screen/title/icon requests are parsed and handled in `crates/opentray-ext-webview`, not `opentray-core` or `opentray-bin`.
- [x] 2.10 Add native-extension tests proving `keepOnTop` is part of style state and projects through the same window capability family.
- [x] 2.11 Add contract coverage for subscription-driven window events and `windowstatechange` payload parity with `getWindowState()`.
- [x] 2.12 Add contract coverage for clearing native icon state with `setIcon(null)` and preferring PNG data URLs for favicon-to-native projection.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check enrich-webview-window-macos-capabilities --phase research-plan` before product-code work starts and commit ready OpenSpec artifacts, unless the user explicitly continues without the commit checkpoint. The user explicitly continued interactive implementation without stopping for the research-plan checkpoint.
- [x] 3.2 Extend `packages/ext-webview/src/index.ts` with additive show-command fields for initial title/icon/style, title/icon sync, and screen capability bindings while preserving current public compatibility.
- [x] 3.3 Extend `crates/opentray-ext-webview/src/lib.rs` show-command parsing to carry the new window metadata, sync policy, and screen injection settings into the runtime.
- [x] 3.4 Enable the `wry` transparent feature and add the minimum native dependencies needed for macOS color, icon, and screen projection.
- [x] 3.5 Integrate `window-vibrancy` into the existing AppKit view path for macOS background material support, including clear/apply behavior inside `setStyle(...)`.
- [x] 3.6 Implement macOS transparent background projection on the current `NSWindow + wry::WebView` runtime without introducing Tao.
- [x] 3.7 Implement initial title/icon/style application during `show(...)`, keeping title/icon as native state rather than page-only metadata.
- [x] 3.8 Implement `navigator.window` title/icon methods plus native request handling, events, and capability reporting.
- [x] 3.9 Implement page-to-native title sync with `wry` document-title change handling.
- [x] 3.10 Implement native-to-page title projection and loop suppression when window-to-document sync is enabled.
- [x] 3.11 Implement injected favicon observation plus private IPC reporting for page-to-native icon sync.
- [x] 3.12 Implement best-effort native icon projection on macOS for OpenTray `Icon` values and favicon-derived updates, with explicit fallback behavior when perfect projection is unavailable.
- [x] 3.13 Implement native-to-page favicon projection only when `windowToFavicon` is explicitly enabled.
- [x] 3.14 Implement `navigator.screen` / `navigator.opentrayScreen` plus a screen-details-like payload sourced from `NSScreen` / `NSWindow.screen()`.
- [x] 3.15 Implement opt-in `window.getScreenDetails` binding that delegates to the screen capability family.
- [x] 3.16 Update the default demo HTML and README to show the expanded window/screen contract and the declarative sync options.
- [x] 3.17 Add concise intent comments only at the native/page sync boundary and the material/transparent split boundary.
- [x] 3.18 Replace the scattered remote-capability booleans with a source-scoped declarative policy model, while preserving backward-compatible command fields as inputs that normalize into the policy.
- [x] 3.19 Deny remote URL page bridge exposure by default unless the resolved policy explicitly allows the requested capability family.
- [x] 3.20 Add `keepOnTop` to the public ext-webview window contract and implement macOS native projection with explicit unsupported behavior on other runtimes.
- [x] 3.21 Split `crates/opentray-ext-webview/src/macos.rs` into internal capability-family modules so bootstrap, style, metadata, screen, and policy concerns stop accumulating in one file.
- [x] 3.22 Update README/example/demo comments to explain capability policy defaults, `keepOnTop`, and the ext-webapp escape hatch for future Dock-owned web apps.
- [x] 3.23 Update README and ext-webview skill guidance with native framed, overlay, borderless glass, and screen-aware window development recipes.
- [x] 3.24 Align native icon payload parsing, injected favicon projection, README, skill guidance, and demo assets with clearable icon state and PNG data URLs.

## 4. Verification

- [x] 4.0 Run `bun run openspec:vision -- validate enrich-webview-window-macos-capabilities` again after reopening the change for policy/keepOnTop/module-split scope.
- [x] 4.1 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.2 Run `cargo test -p opentray-ext-webview`.
- [x] 4.3 Run targeted checks proving `opentray-core` and `opentray-bin` still do not contain WebView-specific title/icon/screen protocol parsing.
- [x] 4.4 Run `cargo build --release -p opentray-bin -p opentray-ext-webview` as local smoke evidence only.
- [x] 4.5 Run `wc -c target/release/opentray target/release/libopentray_ext_webview.dylib` and confirm the WebView runtime still lives in the extension artifact.
- [x] 4.6 On macOS, run `otool -L` for daemon and dylib artifacts and confirm WebKit/framework linkage remains owned by the dylib, not the daemon.
- [x] 4.7 Run `pnpm --filter @opentray/ext-webview build`.
- [x] 4.8 Run `pnpm run verify`.
- [x] 4.9 Run `git diff --check`.
- [x] 4.10 Run `bun run openspec:vision -- validate enrich-webview-window-macos-capabilities`.
- [x] 4.11 Run the narrowest human-visible smoke path that proves frameless + transparent/material + title/icon/screen behavior on macOS.
- [x] 4.12 Run focused verification for policy denial, `keepOnTop`, and the new macOS module boundaries.
- [x] 4.13 Run focused verification for typed window-state APIs, ext-webview skill docs, OpenSpec validation, and the webview-control smoke path.
- [x] 4.14 Run focused verification for clearable native icon state and subscription-driven overlay geometry emission.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review record against `plans/plan.md`, specs, tasks, and the no-Tao decision.
- [x] 5.2 Review did not reopen OpenSpec artifacts or tasks, so no extra apply loop update was required.
- [x] 5.3 Review did not enter a real loop, so no `review-state` file was required.
- [x] 5.4 Review exited normally, so no abnormal handoff was required.
- [x] 5.5 If review exits normally, run `bun run openspec:vision -- check enrich-webview-window-macos-capabilities` and decide whether to archive or reopen intent.
