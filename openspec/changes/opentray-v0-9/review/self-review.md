# Vision-Driven Self Review

## Review State

- Change: `opentray-v0-9`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: implementation loop is internally consistent and verified for the scoped tray-first API/protocol/backend reset; packaging-plugin and final `.node` distribution remain the next runtime-distribution change, not silently claimed by this iteration.
- Next loop action: run `openspec:vision -- check`, final whitespace/status review, then commit if no new issue appears.

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
| Update docs and OpenSpec task ledger | `README.md`, package READMEs, `openspec/changes/opentray-v0-9/tasks.md`, `plans/plan.md` | Aligned |

## Deviations From Intent

1. The packaging-plugin / `.node` native-binding direction is captured in spec and README wording as runtime artifact law, but this iteration does not implement a Vite adapter or replace platform packages with final `.node` artifacts.
2. Transitional files and commands still contain implementation terms such as daemon/local broker for lower-level runtime wiring. They are no longer the top-level SDK ontology, but they have not been renamed across the entire repo.

## New Questions For User

1. Should the next loop implement the packaging adapter and `.node` artifact layout immediately, or keep this as the next OpenSpec change after the tray-first API/protocol reset lands?
2. Should transitional CLI command names such as `daemon-tray` and internal `connectLocalBroker` be renamed in the runtime-host packaging loop, or kept as low-level diagnostics?

## Evidence

- HTML report: `review/self-review.html`
- Command evidence:
  - `pnpm --filter @opentray/spec typecheck`
  - `pnpm --filter opentray typecheck`
  - `pnpm --filter @opentray/spec test`
  - `pnpm --filter opentray test`
  - `pnpm run build`
  - `pnpm run verify`
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
