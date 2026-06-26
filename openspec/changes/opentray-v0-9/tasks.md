## 1. CLI Public Surface Reset

- [x] 1.1 Remove `createSpace`, `createSurface`, `resolveDefaultSpace`, `SpaceHandle`, `EventfulSpaceHandle`, `SurfaceHandle`, and any related public aliases from `packages/cli/src/index.ts`, `packages/cli/src/client.ts`, and `packages/cli/src/sdk.ts`.
- [x] 1.2 Keep `createTray` as the only public creation entrypoint in the CLI SDK surface.
- [x] 1.3 Rework `packages/cli/src/index.test.ts` so it proves the tray-first public API instead of alias behavior.
- [x] 1.4 Delete `packages/cli/src/sdk.test.ts` once its compatibility coverage is no longer meaningful.

## 2. Tray-First Example Migration

- [x] 2.1 Rewrite `packages/cli/examples/basic-tray.ts`, `packages/cli/examples/debug-runtime-tray.ts`, `packages/cli/examples/tray-panel.ts`, `packages/cli/examples/webview-control.ts`, `packages/cli/examples/badge-panel.ts`, `packages/cli/examples/media-query-panel.ts`, and `packages/cli/examples/placement-panel.ts` to call `createTray(...)` directly.
- [x] 2.2 Update `packages/cli/examples/_support/webview-example-support.ts` and `packages/cli/examples/_support/debug-runtime-lynx-support.ts` so they return tray handles only and stop exposing `space`.
- [x] 2.3 Remove remaining `spaceId` / `space.createTray` assumptions from the CLI example path.

## 3. Protocol Mirror Cleanup

- [x] 3.1 Remove public `SpaceOptions`, `SpaceRef`, `SurfaceOptions`, `SurfaceRef`, and public `spaceId`-based creation from `packages/spec/src/index.ts`.
- [x] 3.2 Update `packages/spec/src/index.test.ts` to cover the tray-first protocol shapes instead of the removed `Space` contract.
- [x] 3.3 Mirror the same contract break in `crates/opentray-spec/src/model.rs` and `crates/opentray-spec/src/protocol.rs`.
- [x] 3.4 Keep request/response/event framing intact while removing public `Space` / `Surface` / `spaceId` names from the protocol.

## 4. Kernel, Backend, and Extension Host Cleanup

- [x] 4.1 Update `crates/opentray-core/src/kernel.rs`, `crates/opentray-core/src/backend.rs`, `crates/opentray-core/src/extension.rs`, and `crates/opentray-core/src/broker.rs` to keep the tray-first runtime law consistent after removing public `Space` / broker ontology.
- [x] 4.2 Fix `crates/opentray-core/src/broker/tests.rs` and any stale Rust coverage that still references `SpaceCreated`, `CreateSpace`, or `space` vocabulary.
- [x] 4.3 Align `crates/opentray-backend-tray-icon/src/lib.rs`, `crates/opentray-backend-tray-icon/src/projection.rs`, `crates/opentray-backend-tray-icon/src/native.rs`, and `crates/opentray-backend-tray-icon/src/runtime.rs` with the new app-scoped tray projection law.
- [x] 4.4 Remove remaining `spaceId`-based assumptions from `packages/ext-badge/src/index.ts` and `packages/ext-badge/src/index.test.ts`.
- [x] 4.5 Update `packages/ext-webview/examples/webview-command.ts`, `packages/ext-webview/src/index.test.ts`, `packages/ext-lynx/src/index.test.ts`, `crates/opentray-ext-lynx/src/lib.rs`, `crates/opentray-bin/src/frame_error.rs`, and remaining example support code that still speaks the old space contract.

## 5. OpenSpec And Docs Alignment

- [x] 5.1 Update `openspec/changes/opentray-v0-9/specs/client-sdk/spec.md` and `openspec/changes/opentray-v0-9/specs/kernel-runtime/spec.md` so they match the tray-first API and the removed `Space` / public broker story.
- [x] 5.2 Reconcile `openspec/changes/opentray-v0-9/specs/backend-adapters/spec.md`, `openspec/changes/opentray-v0-9/specs/extension-host/spec.md`, `openspec/changes/opentray-v0-9/specs/runtime-host/spec.md`, and `openspec/changes/opentray-v0-9/specs/packaging-plugin/spec.md` with the same contract break.
- [x] 5.3 Update `README.md`, `packages/cli/README.md`, `packages/spec/README.md`, `packages/ext-webview/README.md`, `packages/ext-lynx/README.md`, and the platform package READMEs to remove the old `createSpace` / shared broker story.
- [x] 5.4 Keep the implementation file map in `openspec/changes/opentray-v0-9/plans/plan.md` synchronized with the real touched files.

## 6. Validation

- [x] 6.1 Run the narrowest package tests that prove the CLI and protocol changes.
- [x] 6.2 Run `cargo test -p opentray-spec --lib` and `cargo test -p opentray-core --lib` after the Rust mirror cleanup lands.
- [x] 6.3 Run the repo-level verification gates once the mirror and example updates land.
- [x] 6.4 Run `git diff --check` and a final status review before calling the change done.

## 7. Packaging Plugin Completion

- [x] 7.1 Add a bundler-neutral `@opentray/packaging` contract that stages runtime hosts, native sidecars, companion assets, and an app manifest under `app.id`-derived output paths.
- [x] 7.2 Add the first Vite adapter without making packaging own runtime lifecycle, session policy, backend selection, or extension dispatch.
- [x] 7.3 Add focused tests for missing app identity, deterministic app-derived artifact naming, manifest emission, path collision failure, Vite entry resolution, and adapter metadata.
- [x] 7.4 Add README/example coverage for the packaging contract and Vite adapter.
- [x] 7.5 Run package-level build/typecheck/test gates and then the repo-level verification gates.

## 8. Session Boundary Cleanup

- [x] 8.1 Remove remaining public `LeaseId` / `leaseId` compatibility aliases from the TypeScript and Rust protocol surfaces.
- [x] 8.2 Rename core ownership APIs, routed events, dynamic extension cleanup, and official extension ABI symbols from lease cleanup to session cleanup.
- [x] 8.3 Rename daemon health diagnostics from `internalLeaseId` to `internalSessionId`.
- [x] 8.4 Run focused TS and Rust tests for spec, CLI, core, broker runtime, and official extension crates.

## 9. Node Runtime Binding Distribution

- [x] 9.1 Add `crates/opentray-runtime-node` as the host-loadable Node runtime binding crate and expose a minimal `runtimeBindingInfo()` contract.
- [x] 9.2 Change `@opentray/<os>-<arch>` platform packages to publish `runtime/opentray_runtime.node` instead of `bin/opentray`.
- [x] 9.3 Update the native artifact graph, local staging, release staging, preview family graph, and native-artifact verification workflow to build/stage the `runtime` component from `opentray-runtime-node`.
- [x] 9.4 Add `opentray/node` runtime binding resolution APIs and focused tests for missing package, missing artifact, unsupported target, and malformed binding behavior.
- [x] 9.5 Add a binding-owned headless direct runtime transport and SDK opt-in path that handles protocol/session operations without `connectLocalBroker()`.
- [x] 9.6 Record the native host-main-loop boundary for visible binding ownership, including the macOS main-thread event-loop constraint, so the default SDK path cannot be switched based on headless proof alone.
- [x] 9.7 Remove public-facing daemon CLI diagnostics and `opentray/node` local-broker exports while keeping the source-tree debug runtime internal.
- [ ] 9.8 Replace the default `createTray()` transport with the in-process Node runtime binding after a host-main-loop integration contract owns the native visible tray backend and event routing on supported platforms.
- [x] 9.9 Rename the remaining protocol/runtime health vocabulary from daemon-shaped names to runtime-host names.
- [ ] 9.10 Add app identity metadata to `runtime-host-health` after the runtime host/session model retains the app identity and human-facing app name.
