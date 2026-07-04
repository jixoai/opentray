## 1. Alignment / Investigation

- [ ] 1.1 Confirm `interview_plan.md` reflects the wry 0.55.1 download-handler evidence, the dead `multipleDownloads` policy evidence, and the 16 confirmed Q&A decisions.
- [ ] 1.2 Confirm this is a `vision2` change and the agenter vision2 schema (pre-interview orientation) is already synced into `openspec/schemas/vision2/`.
- [ ] 1.3 Confirm there is no destructive migration: enabling downloads by default is additive, but verify no existing test asserts "downloads are silently cancelled" before flipping the default.

## 2. BDD Contract

- [ ] 2.1 Scenario: anchor `download` attribute writes a file to `~/Downloads` — traces to `interview_plan.md` Original User Input and spec requirement "Webview SHALL support standard HTML download semantics", scenario "Anchor download attribute produces a local file".
- [ ] 2.2 Scenario: filename collision deduplicates as `report (1).json` — traces to spec requirement "standard HTML download semantics", scenario "Filename collision does not overwrite".
- [ ] 2.3 Scenario: default `download` option enables downloads with zero config — traces to interview Q&A turn 14 and spec scenario "Download defaults to enabled with zero configuration".
- [ ] 2.4 Scenario: `download: { enabled: false }` suppresses downloads without crashing — traces to spec scenario "Disabled download option suppresses downloads".
- [ ] 2.5 Scenario: local page allowed by default, remote page denied by default under `multipleDownloads` — traces to interview Q&A turn 5 and spec requirement "multipleDownloads permission family".
- [ ] 2.6 Scenario: explicit `multipleDownloads` allow rule permits a named remote origin — traces to spec scenario "Explicit allow rule permits a remote download".
- [ ] 2.7 Scenario: `prompt` decision defers to the Darwin runtime carrier's native prompt flow, not a download-specific UI — traces to interview Q&A turn 15 and spec scenario "Prompt decision reuses the carrier-owned permission flow".
- [ ] 2.8 Scenario: `saveAs: false` (default) writes silently with no dialog — traces to spec scenario "Default silent download writes without a dialog".
- [ ] 2.9 Scenario: `saveAs: true` on macOS presents `NSSavePanel` and writes to the chosen path — traces to interview Q&A turn 6 and spec scenario "saveAs true presents a native save dialog on macOS".
- [ ] 2.10 Scenario: `saveAs: true` on Windows uses WebView2 native Save As — traces to spec scenario "saveAs true presents native Save As on Windows".
- [ ] 2.11 Scenario: canceling the save dialog emits `downloadcanceled`, not `downloadfailed` — traces to interview Q&A turn 13 and spec scenario "User canceling saveAs does not write a file".
- [ ] 2.12 Scenario: `downloadstarted` / `downloadprogress` / `downloadcompleted` / `downloadfailed` / `downloadcanceled` all flow through the existing `navigator.opentrayWindow.listen(...)` bus — traces to interview Q&A turn 7 + 11 and spec requirement "download lifecycle events on the navigator window bus".
- [ ] 2.13 Scenario: `downloadprogress` is reliable on macOS via `WKDownload` KVO (not absent, not polled) — traces to interview Q&A turn 8 and spec scenario "Progress events are reliable on macOS".
- [ ] 2.14 Scenario: `downloadcompleted` payload omits `path` on both macOS and Windows — traces to interview Q&A turn 12 and spec scenario "Completed event omits the saved path on all platforms".
- [ ] 2.15 Scenario: no registered listener means no event payload is pushed — traces to spec scenario "No listener means no event delivery".
- [ ] 2.16 Scenario: unsupported platform (Linux) returns a typed unsupported error, not fake success — traces to interview Q&A turn 9 and spec scenario "Unsupported platform does not fake download success".
- [ ] 2.17 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision2 -- commit-check add-webview-download --phase apply` before app-code work starts, then commit the ready OpenSpec artifacts (interview_plan, specs, tasks).
- [ ] 3.2 Add a `WebviewDownloadSettings { enabled: bool, save_as: bool }` to `crates/opentray-ext-webview/src/lib.rs`, default `enabled=true, save_as=false`; parse it from a new top-level `download` field on the show command and store it on `WebviewShowSettings` alongside `browser_permission_policy`.
- [ ] 3.3 Expose the `download: { enabled?: boolean; saveAs?: boolean }` option on the TypeScript facade `show(...)` contract in `packages/ext-webview/src/index.ts`, with typed defaults; export the option type from the facade package.
- [ ] 3.4 macOS: on `crates/opentray-ext-webview/src/macos/mod.rs` `WebViewBuilder` chain (around line 654), install `.with_download_started_handler(...)` and `.with_download_completed_handler(...)`. In the started handler: consult the bridge's `browser_permission_policy` for `multipleDownloads` (source derived from current page URL); deny when policy says deny; when `save_as` is true, run an `NSSavePanel` and write its chosen path back to the `&mut PathBuf`; otherwise let wry's default `~/Downloads` dedup behavior stand.
- [ ] 3.5 macOS: add a `WKDownload` progress KVO observer (separate from wry's finish/fail-only delegate) so `downloadprogress` carries real `receivedBytes` / `totalBytes`; tear the observer down on download finish/fail/cancel.
- [ ] 3.6 Windows: on `crates/opentray-ext-webview/src/windows/mod.rs` `WebViewBuilder` chain (around line 1496) install the same two handlers; in the started handler consult `multipleDownloads` policy, and for `save_as` rely on WebView2's `DownloadStarting` `ResultFilePath` + native Save As rather than a custom dialog.
- [ ] 3.7 Windows: subscribe to `DownloadOperation` bytes-received state changes for `downloadprogress`, since WebView2 provides this natively.
- [ ] 3.8 Bridge: extend the macOS (`bridge.rs`) and Windows IPC dispatchers so the native download lifecycle can deliver `downloadstarted` / `downloadprogress` / `downloadcompleted` / `downloadfailed` / `downloadcanceled` events to the page through the existing window-event channel (no new namespace).
- [ ] 3.9 Bootstrap: update `crates/opentray-ext-webview/src/bootstrap.rs` so `navigator.opentrayWindow.listen(...)` recognizes the five download event names and routes them through the existing callback-id table; no `download:` prefix.
- [ ] 3.10 When a new problem surfaces during implementation, create a typed issue with `bun run openspec:vision2 -- issues add-webview-download --new <bug|task|decision|risk|question> --title "<title>"` instead of silently editing the plan. Use `--group`, `--label`, `--depends-on`, `--blocks`, `--priority`, or `--owner` when triage or dependency law matters.
- [ ] 3.11 Do not add legacy plan-backup or self-review-loop artifacts to this workflow.
- [ ] 3.12 Update only current-context completed task checkboxes and commit them with matching implementation / BDD evidence.

## 4. Verification

- [ ] 4.1 Run `cargo test -p opentray-ext-webview` for the native download handler, permission gating, and macOS KVO progress behavior.
- [ ] 4.2 Run `pnpm --filter @opentray/ext-webview test` for the TypeScript facade `download` option parsing and defaults.
- [ ] 4.3 Run `pnpm --filter opentray example:download` (added in 3.x) on macOS and confirm a real file lands in `~/Downloads` and the lifecycle events render.
- [ ] 4.4 Run the same example on Windows and confirm WebView2 Save As + progress behave natively.
- [ ] 4.5 Run `bun run openspec:vision2 -- validate add-webview-download`.
- [ ] 4.6 Run `bun run openspec:vision2 -- issues add-webview-download --validate` and inspect grouped issue state with `bun run openspec:vision2 -- issues add-webview-download --group-by group`.
- [ ] 4.7 Run `bun run openspec:vision2 -- commit-check add-webview-download --phase close` before writing the closing overview.

## 5. Close

- [ ] 5.1 Generate `toc.md` with a preface plus a footnote reference block citing every spec file (`[^id]: specs/webview-extension/spec.md`).
- [ ] 5.2 Close or resolve every active issue under `issues/*.md` (`state: closed` or `state: resolved` with a `## Resolution` section), with dependency references still valid.
- [ ] 5.3 Run `bun run openspec:vision2 -- check add-webview-download` to verify footnote coverage, issue convergence, and artifact presence.
- [ ] 5.4 If `check` reports open issues or orphan specs, iterate; otherwise archive with `openspec archive add-webview-download` and commit the archive result.
