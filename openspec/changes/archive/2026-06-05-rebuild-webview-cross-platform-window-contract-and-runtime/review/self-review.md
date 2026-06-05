# Vision-Driven Self Review

## Review State

- Change: `rebuild-webview-cross-platform-window-contract-and-runtime`
- Iteration: `2 / 5`
- Exit-condition judgment: Normal exit is available for the narrowed atom. The contract/provenance/docs/example slice is complete and verified; archive can proceed after these refreshed review artifacts are committed.
- Review-loop note: A real implementation bug was found while replaying the maintained examples. The macOS initial-style validator treated the default placeholder `platform.windows` family as an explicit Windows style request, causing all three source-tree WebView examples to fail with a false `unsupported`. This loop fixed that validator bug and reran the examples successfully.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Separate common shell traits from platform substrate families | `packages/ext-webview/src/index.ts`, `crates/opentray-ext-webview/src/lib.rs`, `crates/opentray-ext-webview/src/macos/style.rs`, and `crates/opentray-ext-webview/src/macos/bridge.rs` now keep common shell traits in the shared style bag and push substrate controls under `style.platform.<family>`. | Aligned |
| Public capability metadata distinguishes common shell support from platform support | `packages/ext-webview/src/index.ts` exposes `platformCapabilities`; `crates/opentray-ext-webview/src/macos/mod.rs` reports nested macOS capability families instead of flattening them into the common contract. | Aligned |
| Tray placement carries provenance in host and page contracts | `packages/spec/src/index.ts`, `crates/opentray-spec/src/protocol.rs`, `packages/cli/src/client.ts`, and `crates/opentray-core/src/broker.rs` now use `TrayBoundsResult` with `kind`, `source`, and `rect`. | Aligned for the current native/unavailable substrate truth |
| Tray placement remains tray-owned rather than webview-owned | `TrayHandle.getBounds()` stayed on the SDK surface; page projection stays under `navigator.opentray.tray`. | Aligned |
| Official guidance teaches the nested contract truthfully | `packages/ext-webview/README.md`, `packages/cli/README.md`, `packages/cli/examples/EXAMPLE.md`, and the skill references now teach `style.platform.macos.*` and `trayBounds.rect` instead of retired flat fields. | Aligned |
| Source-tree example environment proves the maintained examples against the current dylib | `packages/cli/examples/_support/webview-example-support.ts` centralizes local dylib discovery/building; `packages/cli/src/daemon/lifecycle.ts` now has an explicit stdio debug escape hatch; the three maintained example commands were rerun successfully in this review loop. | Aligned |

## Deviations From The Broader Product Intent

These are explicit deferrals, not blockers for this archive unit:

1. `platform.windows` and `platform.linux` are currently truthful contract placeholders only. `crates/opentray-ext-webview/src/lib.rs` still routes non-macOS runtimes to `UnsupportedWebviewRuntime`.
2. Linux tray provenance fallback chains are not implemented yet. `crates/opentray-backend-ksni/src/lib.rs` still reports capability absence rather than an inferred chain.
3. Bootstrap families such as `window.open()` policy, managed localhost origin serving, profile/partition/session controls, init/dynamic injection, IPC, and host/page devtools remain out of scope for this archive atom.
4. OS appearance propagation and platform-specialized material/corner/screen event matrices remain follow-up work. This archive only restores truthful contract boundaries so that future Windows/Linux work lands on a clean substrate map.

## Verification

Verified in the current review context:

- `cargo test -p opentray-ext-webview -p opentray-core -p opentray-backend-tray-icon -p opentray-backend-ksni -p opentray-spec`
- `pnpm --filter @opentray/spec test`
- `pnpm --filter @opentray/ext-webview test`
- `pnpm --filter opentray test -- --runInBand src/index.test.ts src/local-broker.test.ts src/sdk.test.ts src/daemon/lifecycle.test.ts`
- `pnpm --filter opentray typecheck`
- `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control`
- `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:tray-panel`
- `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:daemon-tray`
- `bun run openspec:vision -- validate rebuild-webview-cross-platform-window-contract-and-runtime`
- `bun run openspec:vision -- check rebuild-webview-cross-platform-window-contract-and-runtime`
- `git diff --check`

Detailed command evidence lives in `review/command-evidence.txt`.

## New Questions For User

1. None. The narrowed archive unit is technically closed; the remaining items are already explicit follow-up families.

## Evidence Notes

- The example regression root cause and fix are in:
  - `crates/opentray-ext-webview/src/macos/style.rs`
  - `crates/opentray-ext-webview/src/macos/tests.rs`
- The example debugging escape hatch is in:
  - `packages/cli/src/daemon/lifecycle.ts`
  - `packages/cli/src/daemon/lifecycle.test.ts`
  - `packages/cli/examples/EXAMPLE.md`
- Unrelated user-side dirty paths still present in the worktree and intentionally excluded from this change:
  - `crates/opentray-ext-lynx/src/lib.rs`
  - `crates/opentray-ext-lynx/src/macos.rs`

## Exit Handling

- Normal archive path: available after committing the refreshed review/OpenSpec artifacts.
- Abnormal handoff: not needed.
- Recommended next product atom after this archive: real Windows/Linux runtime substrate work, then Linux inferred tray fallback provenance, then the bootstrap families on top of that truthful runtime map.
