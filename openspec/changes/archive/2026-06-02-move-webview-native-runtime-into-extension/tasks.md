## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm any destructive migration / cleanup / state reset assumption with the user when it is not already explicitly approved.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the user wants `opentray` to stay generic When the codebase is searched Then WebView command parsing exists only inside `crates/opentray-ext-webview`.
- [x] 2.2 Scenario: Given the user wants the extension to behave like an independent binary When local macOS release artifacts are inspected Then `opentray` does not link `WebKit.framework` and `libopentray_ext_webview.dylib` does.
- [x] 2.3 Scenario: Given the runtime split moved into the dylib When targeted Rust tests run Then `opentray-bin`, `opentray-ext-webview`, and `opentray-spec` still pass in the current working context.
- [x] 2.4 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check move-webview-native-runtime-into-extension --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Remove direct WebView runtime ownership from `opentray-bin` so the daemon depends only on the generic extension ABI and broker runtime.
- [x] 3.3 Move WebView command parsing, default HTML, and macOS native runtime ownership into `crates/opentray-ext-webview`.
- [x] 3.4 Update README and OpenTray skill references so the documented law matches the new runtime boundary.
- [x] 3.5 Update only current-context completed task checkboxes with matching implementation and verification evidence.

## 4. Verification

- [x] 4.1 Run targeted behavior tests: `cargo test -p opentray-bin`, `cargo test -p opentray-ext-webview`, and `cargo test -p opentray-spec`.
- [x] 4.2 Run targeted artifact proof commands: `cargo build -p opentray-bin -p opentray-ext-webview --release`, `wc -c`, and `otool -L` for daemon and dylib artifacts.
- [x] 4.3 Run `bun run openspec:vision -- validate move-webview-native-runtime-into-extension` for this change.
- [x] 4.4 Run `bun run openspec:vision -- commit-check move-webview-native-runtime-into-extension --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state move-webview-native-runtime-into-extension` to persist iteration / recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff move-webview-native-runtime-into-extension` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive move-webview-native-runtime-into-extension` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check move-webview-native-runtime-into-extension` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
