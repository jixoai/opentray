## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, Wry local API survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration / cleanup / state reset is required; this change is additive and scoped to `@opentray/ext-webview` plus its native crate.
- [x] 1.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 2. BDD Contract

- [x] 2.1 Add TypeScript facade tests proving `show` can request `nativeWindowApi` and `bindWindowGlobals` without changing the generic extension dispatch path.
- [x] 2.2 Add native-extension tests proving the injected script defines `navigator.window` and `navigator.opentrayWindow` as the same object when enabled.
- [x] 2.3 Add native-extension tests proving the injected script exposes scoped `invoke`, `listen`, and `once` APIs plus high-level window method wrappers.
- [x] 2.4 Add native-extension tests proving global `window.close` / `window.resizeTo` overrides are absent by default and present only when `bindWindowGlobals` is enabled.
- [x] 2.5 Add native-extension tests proving the injected script does not use `window.postMessage` or global `message` events for OpenTray control traffic.
- [x] 2.6 Add native-extension tests proving the private invoke request shape includes namespace `opentray.window`, command, success callback id, error callback id, payload, and options.
- [x] 2.7 Add native-extension tests proving callback ids resolve promise success/error exactly once and can unregister listener callbacks.
- [x] 2.8 Add native-extension tests proving unsupported visual effects return typed unsupported errors instead of fake success.
- [x] 2.9 Add native-extension tests proving navigator window requests are parsed and handled inside `crates/opentray-ext-webview`, not `opentray-core` or `opentray-bin`.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check add-webview-navigator-window-api --phase apply` before product-code work starts and commit ready OpenSpec artifacts, unless the user explicitly continues without the commit checkpoint.
- [x] 3.2 Extend `@opentray/ext-webview` TypeScript command types with `nativeWindowApi` and `bindWindowGlobals` options for `show`.
- [x] 3.3 Define extension-owned navigator window protocol types for capabilities, style state, requests, responses, and typed errors.
- [x] 3.4 Define extension-owned callback-id internals for transform/register, unregister, runCallback, request resolution, and listener delivery.
- [x] 3.5 Implement the initialization script generator that installs `navigator.window` and `navigator.opentrayWindow` only when enabled.
- [x] 3.6 Implement scoped `navigator.window.invoke`, `listen`, and `once` over private internals.
- [x] 3.7 Implement high-level wrappers `close`, `moveTo`, `resizeTo`, `getStyle`, `setStyle`, and `getCapabilities` over scoped `invoke`.
- [x] 3.8 Implement optional DOM-style `addEventListener` / `removeEventListener` compatibility wrappers over `listen`.
- [x] 3.9 Implement the isolated private transport wrapper so public APIs do not expose Wry IPC or use `window.postMessage`.
- [x] 3.10 Implement optional global override binding for `window.close`, `window.resizeTo`, and `window.moveTo` behind `bindWindowGlobals`.
- [x] 3.11 Implement native request handling for `close`, `moveTo`, `resizeTo`, `listen`, `unlisten`, `getStyle`, `setStyle`, and `getCapabilities` in the WebView extension runtime.
- [x] 3.12 Implement typed unsupported responses for platform-fragile style effects such as blur/acrylic/vibrancy and unavailable transparency.
- [x] 3.13 Update README and examples to show `navigator.window` as the promoted API, `navigator.opentrayWindow` as the prefixed fallback, and `invoke` / `listen` as the Tauri-consistent base layer.
- [x] 3.14 Add concise intent comments at the injected API/internals boundary and the global override switch.

## 4. Verification

- [x] 4.1 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.2 Run `cargo test -p opentray-ext-webview`.
- [x] 4.3 Run targeted checks proving `opentray-core` and `opentray-bin` do not contain `navigator.window`, `opentrayWindow`, or WebView navigator protocol parsing.
- [x] 4.4 Run `cargo build --release -p opentray-bin -p opentray-ext-webview` as local smoke evidence only.
- [x] 4.5 Run `wc -c target/release/opentray target/release/libopentray_ext_webview.dylib` and confirm the WebView runtime remains in the extension artifact.
- [x] 4.6 On macOS, run `otool -L` for daemon and dylib artifacts and confirm `WebKit.framework` remains only on the dylib.
- [x] 4.7 Run `pnpm run build`.
- [x] 4.8 Run `pnpm run verify`.
- [x] 4.9 Run `git diff --check`.
- [x] 4.10 Run `bun run openspec:vision -- validate add-webview-navigator-window-api`.
- [x] 4.11 Run `bun run openspec:vision -- commit-check add-webview-navigator-window-api --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`, specs, and tasks.
- [x] 5.2 Generate separate `review/self-review.html` as structured evidence for navigator API isolation and global override behavior.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state add-webview-navigator-window-api` to persist iteration / recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff add-webview-navigator-window-api` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive add-webview-navigator-window-api` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check add-webview-navigator-window-api` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
