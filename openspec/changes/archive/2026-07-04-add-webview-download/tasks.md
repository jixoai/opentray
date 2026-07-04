## 1. Alignment / Investigation

Verification for this change is host-scoped: macOS runtime paths are smoked locally, while Windows download behavior is archived on direct source ownership plus focused Rust and TypeScript coverage from this macOS working context.

- [x] 1.1 Confirm `interview_plan.md` reflects the wry 0.55.1 download-handler evidence, the dead `multipleDownloads` policy evidence, and the 16 confirmed Q&A decisions.
- [x] 1.2 Confirm this is a `vision2` change and the agenter vision2 schema (pre-interview orientation) is already synced into `openspec/schemas/vision2/`.
- [x] 1.3 Confirm there is no destructive migration: enabling downloads by default is additive, but verify no existing test asserts "downloads are silently cancelled" before flipping the default.

## 2. BDD Contract

- [x] 2.1 Scenario: anchor `download` attribute writes a file to `~/Downloads` — traces to `interview_plan.md` Original User Input and spec requirement "Webview SHALL support standard HTML download semantics", scenario "Anchor download attribute produces a local file".
- [x] 2.2 Scenario: filename collision deduplicates as `report (1).json` — traces to spec requirement "standard HTML download semantics", scenario "Filename collision does not overwrite".
- [x] 2.3 Scenario: default `download` option enables downloads with zero config — traces to interview Q&A turn 14 and spec scenario "Download defaults to enabled with zero configuration".
- [x] 2.4 Scenario: `download: { enabled: false }` suppresses downloads without crashing — traces to spec scenario "Disabled download option suppresses downloads".
- [x] 2.5 Scenario: local page allowed by default, remote page denied by default under `multipleDownloads` — traces to interview Q&A turn 5 and spec requirement "multipleDownloads permission family".
- [x] 2.6 Scenario: explicit `multipleDownloads` allow rule permits a named remote origin — traces to spec scenario "Explicit allow rule permits a remote download".
- [x] 2.7 Scenario: `prompt` decision fails closed without inventing a download-specific prompt UI — traces to the current spec scenario "Prompt decision fails closed until the carrier prompt substrate exists".
- [x] 2.8 Scenario: `saveAs: false` (default) writes silently with no dialog — traces to spec scenario "Default silent download writes without a dialog".
- [x] 2.9 Scenario: `saveAs: true` on macOS presents `NSSavePanel` and writes to the chosen path — traces to interview Q&A turn 6 and spec scenario "saveAs true presents a native save dialog on macOS".
- [x] 2.10 Scenario: `saveAs: true` on Windows uses WebView2 native Save As — traces to spec scenario "saveAs true presents native Save As on Windows".
- [x] 2.11 Scenario: canceling the save dialog emits `downloadcanceled`, not `downloadfailed` — traces to interview Q&A turn 13 and spec scenario "User canceling saveAs does not write a file".
- [x] 2.12 Scenario: `downloadstarted` / `downloadprogress` / `downloadcompleted` / `downloadfailed` / `downloadcanceled` all flow through the existing `navigator.opentrayWindow.listen(...)` bus — traces to interview Q&A turn 7 + 11 and spec requirement "download lifecycle events on the navigator window bus".
- [x] 2.13 Scenario: `downloadprogress` is reliable on macOS via `WKDownload` KVO (not absent, not polled) — traces to interview Q&A turn 8 and spec scenario "Progress events are reliable on macOS".
- [x] 2.14 Scenario: `downloadcompleted` payload omits `path` on both macOS and Windows — traces to interview Q&A turn 12 and spec scenario "Completed event omits the saved path on all platforms".
- [x] 2.15 Scenario: no registered listener means no event payload is pushed — traces to spec scenario "No listener means no event delivery".
- [x] 2.16 Scenario: unsupported platform (Linux) returns a typed unsupported error, not fake success — traces to interview Q&A turn 9 and spec scenario "Unsupported platform does not fake download success".
- [x] 2.17 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision2 -- commit-check add-webview-download --phase apply` before app-code work starts, then commit the ready OpenSpec artifacts (interview_plan, specs, tasks).
- [x] 3.2 Add a `WebviewDownloadSettings { enabled: bool, save_as: bool }` to `crates/opentray-ext-webview/src/lib.rs`, default `enabled=true, save_as=false`; parse it from a new top-level `download` field on the show command and store it on `WebviewShowSettings` alongside `browser_permission_policy`.
- [x] 3.3 Expose the `download: { enabled?: boolean; saveAs?: boolean }` option on the TypeScript facade `show(...)` contract in `packages/ext-webview/src/index.ts`, with typed defaults; export the option type from the facade package.
- [x] 3.4 macOS: on `crates/opentray-ext-webview/src/macos/mod.rs` `WebViewBuilder` chain (around line 654), install `.with_download_started_handler(...)` and `.with_download_completed_handler(...)`. In the started handler: consult the bridge's `browser_permission_policy` for `multipleDownloads` (source derived from current page URL); deny when policy says deny; when `save_as` is true, run an `NSSavePanel` and write its chosen path back to the `&mut PathBuf`; otherwise let wry's default `~/Downloads` dedup behavior stand.
- [x] 3.5 macOS: add a `WKDownload` progress KVO observer (separate from wry's finish/fail-only delegate) so `downloadprogress` carries real `receivedBytes` / `totalBytes`; tear the observer down on download finish/fail/cancel.
- [x] 3.6 Windows: on `crates/opentray-ext-webview/src/windows/mod.rs` `WebViewBuilder` chain (around line 1496) install the same two handlers; in the started handler consult `multipleDownloads` policy, and for `save_as` rely on WebView2's `DownloadStarting` `ResultFilePath` + native Save As rather than a custom dialog.
- [x] 3.7 Windows: subscribe to `DownloadOperation` bytes-received state changes for `downloadprogress`, since WebView2 provides this natively.
- [x] 3.8 Bridge: extend the macOS (`bridge.rs`) and Windows IPC dispatchers so the native download lifecycle can deliver `downloadstarted` / `downloadprogress` / `downloadcompleted` / `downloadfailed` / `downloadcanceled` events to the page through the existing window-event channel (no new namespace).
- [x] 3.9 Navigator window listen routing recognizes the five download event names through the existing callback-id table with no `download:` prefix.
- [x] 3.10 Record substrate-scope corrections in the change artifacts instead of leaving the contract stale when a new problem surfaces during implementation.
- [x] 3.11 Do not add legacy plan-backup or self-review-loop artifacts to this workflow.
- [x] 3.12 Update only current-context completed task checkboxes and commit them with matching implementation / BDD evidence.

## 4. Verification

- [x] 4.1 Run `cargo test -p opentray-ext-webview` for the native download handler, permission gating, and macOS KVO progress behavior.
- [x] 4.2 Run `pnpm --filter @opentray/ext-webview test` for the TypeScript facade `download` option parsing and defaults.
- [x] 4.3 Run `pnpm --filter opentray example:download` (added in 3.x) on macOS and confirm a real file lands in `~/Downloads` and the lifecycle events render.
- [x] 4.4 Confirm Windows source-level routing for WebView2 Save As + progress behavior from the current host context; host-side Windows smoke remains an external follow-up outside this macOS archive run.
- [x] 4.5 Run `bun run openspec:vision2 -- validate add-webview-download`.
- [x] 4.6 Run `bun run openspec:vision2 -- issues add-webview-download --validate` and inspect grouped issue state with `bun run openspec:vision2 -- issues add-webview-download --group-by group`.
- [x] 4.7 Run `bun run openspec:vision2 -- commit-check add-webview-download --phase close` before writing the closing overview.

## 5. Close

- [x] 5.1 Generate `toc.md` with a preface plus a footnote reference block citing every spec file (`[^id]: specs/webview-extension/spec.md`).
- [x] 5.2 Close or resolve every active issue under `issues/*.md` (`state: closed` or `state: resolved` with a `## Resolution` section), with dependency references still valid.
- [x] 5.3 Run `bun run openspec:vision2 -- check add-webview-download` to verify footnote coverage, issue convergence, and artifact presence.
- [ ] 5.4 If `check` reports open issues or orphan specs, iterate; otherwise archive with `openspec archive add-webview-download` and commit the archive result.
