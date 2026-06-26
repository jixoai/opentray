# Vision-Driven Self Review

## Review State

- Change: `opentray-v0-9`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: implementation loop is internally consistent and verified for the tray-first API/protocol/backend reset, the first packaging-plugin contract and Vite adapter, and the session-boundary cleanup that removes remaining public `Lease` aliases/ABI names. Final `.node` native-binding replacement remains a future runtime-distribution change, but v0.9 now has the required app-manifest staging law and first bundler adapter.
- Next loop action: run `openspec:vision -- check`, final whitespace/status review, then commit the session-boundary cleanup if no new issue appears.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Remove public `Space` / `Surface` creation from TypeScript SDK | `packages/cli/src/index.ts`, `packages/cli/src/sdk.ts`, deleted `packages/cli/src/sdk.test.ts`, `pnpm --filter opentray test` | Aligned |
| Keep `createTray` as the public creation entrypoint | `packages/cli/src/sdk.ts`, `packages/cli/src/index.test.ts`, `packages/cli/README.md` | Aligned |
| Use tray `id` and app-scoped protocol instead of `spaceId` creation | `packages/spec/src/index.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-core/src/kernel.rs`, `cargo test -p opentray-spec --lib`, `cargo test -p opentray-core --lib` | Aligned |
| Remove top-level tray title as visible text source | `packages/cli/src/client.ts`, `packages/spec/src/index.ts`, `crates/opentray-spec/src/protocol.rs`; `set-tray-title` removed | Aligned |
| Model responsive icon projection in one `icon` field | `packages/spec/src/index.ts`, `packages/spec/src/index.test.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-backend-tray-icon/src/projection.rs`, `pnpm --filter @opentray/spec test`, `cargo test -p opentray-spec --lib`, `cargo test -p opentray-backend-tray-icon --lib` | Aligned |
| Rename internal backend law from surface projection to app projection | `crates/opentray-core/src/backend.rs`, `crates/opentray-backend-tray-icon/src/projection.rs`, `cargo test -p opentray-backend-tray-icon --lib` | Aligned |
| Align official extension scope with app/tray identity | `crates/opentray-spec/src/ext.rs`, `crates/opentray-ext-webview/src/lib.rs`, `crates/opentray-ext-lynx/src/lib.rs`, `crates/opentray-ext-badge/src/lib.rs`; focused extension tests | Aligned |
| Remove remaining public Lease aliases and ABI names | `packages/spec/src/index.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-core/src/kernel.rs`, `crates/opentray-core/src/extension.rs`, `crates/opentray-bin/src/dynamic_extension.rs`, focused TS/Rust tests | Aligned |
| Update docs and OpenSpec task ledger | `README.md`, package READMEs, `openspec/changes/opentray-v0-9/tasks.md`, `plans/plan.md` | Aligned |
| Define packaging contract and first Vite adapter | `packages/packaging/src/index.ts`, `packages/vite-plugin/src/index.ts`, package READMEs/examples, `pnpm --filter @opentray/packaging test`, `pnpm --filter @opentray/vite-plugin test`, `pnpm run verify` | Aligned |

## Deviations From Intent

1. Final `.node` native-binding replacement is not implemented in this loop. The v0.9 packaging-plugin requirement is satisfied as a build-layer staging/manifest contract plus Vite adapter; replacing platform runtime packages with final `.node` artifacts remains a separate runtime-distribution break.
2. Transitional files and commands still contain implementation terms such as daemon/local broker for lower-level runtime wiring. They are no longer the top-level SDK ontology, but they have not been renamed across the entire repo.

## New Questions For User

1. Should final `.node` native-binding distribution replace the existing runtime artifact package layout in a dedicated follow-up change?
2. Should transitional CLI command names such as `daemon-tray` and internal `connectLocalBroker` be renamed in that runtime-distribution loop, or kept as low-level diagnostics?

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
  - `bun run openspec:vision -- validate opentray-v0-9`
  - `git diff --check`
- Git commits reviewed: none yet; current work is uncommitted.
- Uncommitted paths, if any: current v0.9 worktree changes across OpenSpec, Rust crates, TS packages, examples, and docs.
- Task checkboxes updated by this working context: all implementation/docs/final validation tasks marked complete after root verification passed.

## HTML Review Report

Created as `review/self-review.html`.

## Exit Handling

- Normal exit condition for this loop: OpenSpec check passes, final validation passes, then commit.
- Archive is not run yet because the user requested the change to be completed and committed in the active worktree; archive should happen only after the final v0.9 change is accepted for closure.
