# Vision-Driven Self Review

## Review State

- Change: `move-webview-native-runtime-into-extension`
- Iteration: 1
- Recurring issue counts:
  - Runtime ownership still in daemon: 0 after current patch set
  - OpenSpec/doc stale after code move: 0 after current patch set
- Exit-condition judgment: The user-requested runtime boundary is implemented and evidenced in the current working tree. OpenSpec artifacts are complete and the change is ready for archive in the current closeout pass.
- Next loop action: Archive the change after final OpenSpec closure commands run.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `opentray` should provide only generic underlying capability and should not couple WebView technology or `ext-webview` parameter parsing. | `crates/opentray-bin/Cargo.toml` no longer depends on `wry`; `crates/opentray-bin/src/main.rs` no longer parses WebView payloads and now uses `UnsupportedExtensionHostContext` for the normal path; `rg` shows WebView command parsing only in `crates/opentray-ext-webview`. | Pass |
| `ext-webview` should contain complete entrance and exit and behave like an independent binary packaged as a dylib. | `crates/opentray-ext-webview/src/lib.rs` owns command parsing and event shaping; `crates/opentray-ext-webview/src/macos.rs` owns `NSWindow`, `NSView`, and `wry::WebView`; `otool -L target/release/libopentray_ext_webview.dylib` shows `WebKit.framework` linkage. | Pass |
| The user needs to see the final binary sizes of `opentray` and `libopentray_ext_webview.dylib`. | `wc -c target/release/opentray target/release/libopentray_ext_webview.dylib` reports `1,874,112` bytes and `957,776` bytes; staged package artifacts match the same values in `packages/darwin-arm64/bin/opentray` and `packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib`. | Pass |
| The change must not leave docs/specs describing the obsolete daemon-owned WebView runtime path. | New OpenSpec change artifacts exist under `openspec/changes/move-webview-native-runtime-into-extension/`; `README.md`, `packages/cli/README.md`, `packages/ext-webview/README.md`, and `skills/opentray/references/*` were updated to describe extension-owned runtime. | Pass |

## Deviations From Intent

1. The generic `invoke_host` ABI hook still exists in `opentray-core` and `opentray-spec`. This is not used by `ext-webview` anymore, so it does not violate the user's requested WebView boundary, but the hook remains available for future privileged atoms.
2. The macOS dylib install name still points at a build-directory path in `otool -L`. The loader uses explicit paths today, so this does not block the current change, but it is still a packaging-hardening residue rather than the cleanest possible artifact metadata.

## New Questions For User

1. Do you want dylib install-name normalization folded into this same change, or should it stay as a separate packaging-hardening pass?
2. Do you want the generic `invoke_host` ABI hook kept for future extension facilities, or would you rather prune it until a real extension needs it again?

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `cargo test -p opentray-bin`
  - `cargo test -p opentray-ext-webview`
  - `cargo test -p opentray-spec`
  - `cargo build -p opentray-bin -p opentray-ext-webview --release`
  - `wc -c target/release/opentray target/release/libopentray_ext_webview.dylib`
  - `wc -c packages/darwin-arm64/bin/opentray packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib`
  - `otool -L target/release/opentray`
  - `otool -L target/release/libopentray_ext_webview.dylib`
  - `bun run openspec:vision -- validate move-webview-native-runtime-into-extension`
  - `bun run openspec:vision -- commit-check move-webview-native-runtime-into-extension --phase apply`
  - `bun run openspec:vision -- commit-check move-webview-native-runtime-into-extension --phase self-review`
- Git commits reviewed: latest repo commit observed by `commit-check` is `e3458c7 docs(spec): close native package release evidence`
- Uncommitted paths, if any:
  - `Cargo.lock`
  - `README.md`
  - `crates/opentray-bin/Cargo.toml`
  - `crates/opentray-bin/src/main.rs`
  - `crates/opentray-ext-webview/Cargo.toml`
  - `crates/opentray-ext-webview/src/lib.rs`
  - `crates/opentray-ext-webview/src/macos.rs`
  - `crates/opentray-spec/src/ext.rs`
  - `packages/cli/README.md`
  - `packages/ext-webview/README.md`
  - `skills/opentray/references/ext-webview.md`
  - `skills/opentray/references/extension-host.md`
  - `openspec/changes/move-webview-native-runtime-into-extension/**`
- Task checkboxes updated by this working context:
  - `openspec/changes/move-webview-native-runtime-into-extension/tasks.md`

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for screenshots, interaction evidence, structured tables, and any complex review display that does not belong in the Markdown thinking record.

## Exit Handling

- Normal exit: run `openspec archive <change>` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff <change>`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff <change> <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
