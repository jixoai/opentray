# Vision-Driven Self Review

## Review State

- Change: `opentray-v0-9`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: implementation loop is internally consistent and verified for the tray-first API/protocol/backend reset, the first packaging-plugin contract and Vite adapter, the session-boundary cleanup, the Node runtime-binding distribution slice, and the first binding-owned headless protocol/session runtime. Platform packages publish `runtime/opentray_runtime.node`; the remaining runtime-distribution work is to move the default `createTray()` path onto a native visible event-loop-backed binding host and then retire daemon diagnostics.
- Next loop action: design and implement the native visible event-loop-backed Node runtime host without archiving `opentray-v0-9`.

## Intent Alignment

| Intent point                                                                     | Evidence                                                                                                                                                                                                                                                                                | Verdict                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Remove public `Space` / `Surface` creation from TypeScript SDK                   | `packages/cli/src/index.ts`, `packages/cli/src/sdk.ts`, deleted `packages/cli/src/sdk.test.ts`, `pnpm --filter opentray test`                                                                                                                                                           | Aligned                   |
| Keep `createTray` as the public creation entrypoint                              | `packages/cli/src/sdk.ts`, `packages/cli/src/index.test.ts`, `packages/cli/README.md`                                                                                                                                                                                                   | Aligned                   |
| Use tray `id` and app-scoped protocol instead of `spaceId` creation              | `packages/spec/src/index.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-core/src/kernel.rs`, `cargo test -p opentray-spec --lib`, `cargo test -p opentray-core --lib`                                                                                                       | Aligned                   |
| Remove top-level tray title as visible text source                               | `packages/cli/src/client.ts`, `packages/spec/src/index.ts`, `crates/opentray-spec/src/protocol.rs`; `set-tray-title` removed                                                                                                                                                            | Aligned                   |
| Model responsive icon projection in one `icon` field                             | `packages/spec/src/index.ts`, `packages/spec/src/index.test.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-backend-tray-icon/src/projection.rs`, `pnpm --filter @opentray/spec test`, `cargo test -p opentray-spec --lib`, `cargo test -p opentray-backend-tray-icon --lib` | Aligned                   |
| Rename internal backend law from surface projection to app projection            | `crates/opentray-core/src/backend.rs`, `crates/opentray-backend-tray-icon/src/projection.rs`, `cargo test -p opentray-backend-tray-icon --lib`                                                                                                                                          | Aligned                   |
| Align official extension scope with app/tray identity                            | `crates/opentray-spec/src/ext.rs`, `crates/opentray-ext-webview/src/lib.rs`, `crates/opentray-ext-lynx/src/lib.rs`, `crates/opentray-ext-badge/src/lib.rs`; focused extension tests                                                                                                     | Aligned                   |
| Remove remaining public Lease aliases and ABI names                              | `packages/spec/src/index.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-core/src/kernel.rs`, `crates/opentray-core/src/extension.rs`, `crates/opentray-bin/src/dynamic_extension.rs`, focused TS/Rust tests                                                                 | Aligned                   |
| Update docs and OpenSpec task ledger                                             | `README.md`, package READMEs, `openspec/changes/opentray-v0-9/tasks.md`, `plans/plan.md`                                                                                                                                                                                                | Aligned                   |
| Define packaging contract and first Vite adapter                                 | `packages/packaging/src/index.ts`, `packages/vite-plugin/src/index.ts`, package READMEs/examples, `pnpm --filter @opentray/packaging test`, `pnpm --filter @opentray/vite-plugin test`, `pnpm run verify`                                                                               | Aligned                   |
| Replace published broker executable packages with Node runtime binding artifacts | `crates/opentray-runtime-node`, `scripts/binaries/*`, platform package manifests, `.github/workflows/verify-native-artifacts.yml`, `bun run scripts/binaries/release-plan.ts --root "$PWD"`, Node `.node` smoke                                                                         | Aligned                   |
| Move protocol/session operations under the Node binding                          | `crates/opentray-runtime-node/src/lib.rs`, `packages/cli/src/runtime-binding-transport.ts`, `packages/cli/src/sdk.ts`, `packages/cli/src/sdk.test.ts`, `cargo test -p opentray-runtime-node --quiet`, Node `.node` request smoke                                                        | Aligned as headless proof |

## Deviations From Intent

1. The binding now owns a headless direct protocol/session path, but default `createTray()` still uses transitional `connectLocalBroker()` because the binding does not yet own the native visible tray event-loop host.
2. Transitional files and commands still contain implementation terms such as daemon/local broker for lower-level runtime wiring. They are no longer the top-level SDK ontology, but they have not been renamed across the entire repo.

## New Questions For User

1. Should the native visible binding host use a platform-specific main-thread bootstrap contract for macOS, or keep macOS on a contributor debug host until that can be proven visually?
2. Should transitional CLI command names such as `daemon-tray` and internal `connectLocalBroker` be renamed in that runtime-distribution loop, or kept as contributor-only diagnostics?

## Evidence

- HTML report: `review/self-review.html`
- Command evidence:
  - `pnpm --filter @opentray/spec typecheck`
  - `pnpm --filter opentray typecheck`
  - `pnpm --filter @opentray/spec test`
  - `pnpm --filter opentray test`
  - `pnpm run build`
  - `pnpm run verify`
  - `pnpm --filter @opentray/packaging build`
  - `pnpm --filter @opentray/packaging typecheck`
  - `pnpm --filter @opentray/packaging test`
  - `pnpm --filter @opentray/vite-plugin build`
  - `pnpm --filter @opentray/vite-plugin typecheck`
  - `pnpm --filter @opentray/vite-plugin test`
  - `pnpm --filter @opentray/spec typecheck`
  - `pnpm --filter @opentray/spec test`
  - `pnpm --filter opentray typecheck`
  - `pnpm --filter opentray test`
  - `cargo test -p opentray-spec --lib`
  - `cargo test -p opentray-core --lib`
  - `cargo test -p opentray-backend-tray-icon --lib`
  - `cargo test -p opentray-backend-ksni --lib`
  - `cargo test -p opentray-bin`
  - `cargo test -p opentray-ext-webview --lib`
  - `cargo test -p opentray-ext-lynx --lib`
  - `cargo test -p opentray-ext-badge --lib`
  - `cargo test -p opentray-runtime-node --lib --quiet`
  - `cargo test -p opentray-runtime-node --quiet`
  - `cargo build -p opentray-runtime-node --release` plus Node `require()` smoke for copied `opentray_runtime.node`
  - Node `createHeadlessRuntime().request(...)` smoke for `init`, `resolve-default-app`, and `create-tray`
  - `pnpm --filter opentray typecheck`
  - `pnpm --filter opentray test -- --run src/sdk.test.ts src/native-runtime.test.ts`
  - `bun test scripts/binaries/artifacts.test.ts scripts/binaries/native-build-graph.test.ts scripts/binaries/release-plan.test.ts scripts/binaries/preview-families.test.ts scripts/npm/bootstrap-package.test.ts`
  - `bun run scripts/binaries/release-plan.ts --root "$PWD"`
  - `bun run openspec:vision -- validate opentray-v0-9`
  - `bun run openspec:vision -- check opentray-v0-9`
  - `git diff --check`
- Git commits reviewed: `272bf64`, `06088ee`, `1104e5a`, `f1a5023`; current runtime-binding slice is uncommitted.
- Uncommitted paths, if any: current runtime-binding distribution changes across OpenSpec, Rust crate metadata, TS CLI runtime resolver, package manifests, scripts, CI, docs, and changeset.
- Task checkboxes updated by this working context: runtime-distribution tasks 9.1 through 9.5 marked complete; 9.6 and 9.7 remain open.

## HTML Review Report

Created as `review/self-review.html`.

## Exit Handling

- Normal exit condition for this loop: OpenSpec check passes, final validation passes, then commit this runtime-binding slice.
- Archive is not run yet because the user requested the change to be completed and committed in the active worktree; archive should happen only after the final v0.9 change is accepted for closure.
