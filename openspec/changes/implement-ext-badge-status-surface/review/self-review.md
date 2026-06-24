# Vision-Driven Self Review

## Review State

- Change: `implement-ext-badge-status-surface`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: normal implementation handoff is possible for the Windows Reduced scope; archive should wait for maintainer acceptance and any desired macOS/Linux platform smoke evidence.
- Next loop action: no apply loop is required for the Windows package/runtime distribution work.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-badge` remains a capability atom outside `opentray` core. | Windows package shells, artifact graph, CI staging, and native runtime tests were added without badge-specific branches in `opentray-core` or the broker loader. | Aligned |
| Windows proceeds at Reduced depth for this round. | `@opentray/ext-badge-windows-arm64` and `@opentray/ext-badge-windows-x64` were added; the Rust runtime reports reduced capabilities and rejects progress as unsupported. | Aligned |
| Native artifacts stay package-owned and binary-free in source control. | `scripts/binaries/artifacts.ts`, `native-build-graph.ts`, `stage-local.ts`, release planning tests, and `.gitignore` route Windows DLLs to `packages/ext-badge-windows-*/bin/` without committing generated DLLs. | Aligned |
| Release and verification workflows stage the new atom through the shared native artifact law. | `.github/workflows/verify-native-artifacts.yml` builds and stages `opentray_ext_badge.dll`; release planning infers badge jobs for macOS and Windows through the shared graph. | Aligned |
| The OpenSpec contract tells the truth about reduced Windows behavior. | `specs/badge-extension/spec.md` now says Windows ships as a reduced native package atom until a real taskbar substrate lands. | Aligned |
| Release helper package discovery tolerates local staging directories. | `scripts/npm/configure-trusted-publish.ts` now skips package subdirectories without `package.json`, and `scripts/npm/configure-trusted-publish.test.ts` covers the rule. | Aligned |

## Deviations From Intent

1. Full Windows taskbar badge/progress/overlay projection is intentionally not implemented in this round. This follows the user-confirmed Reduced decision in `plans/plan.md`.
2. Local verification was run on Windows x64. macOS Dock helper visual smoke and Linux platform behavior were not rerun locally in this context.
3. The current facade still uses the existing v1 local capability snapshot model rather than consuming native `getCapabilities` result events. This was not expanded because the current request was Windows Reduced distribution and runtime support, not a facade protocol redesign.

## New Questions For User

1. None for this implementation handoff. The next architectural decision is whether the follow-up should promote Windows from Reduced to a real taskbar projection substrate.

## Evidence

- HTML report: `review/self-review.html`
- Command / log evidence:
  - `bun run openspec:vision -- commit-check implement-ext-badge-status-surface --phase self-review`
  - `cargo test -p opentray-ext-badge`
  - `bun test scripts/binaries/artifacts.test.ts scripts/binaries/native-build-graph.test.ts scripts/binaries/release-plan.test.ts scripts/binaries/release-workflow.test.ts scripts/binaries/verify-native-artifacts-workflow.test.ts`
  - `pnpm --filter @opentray/ext-badge test`
  - `pnpm --filter @opentray/ext-badge typecheck`
  - `pnpm --filter @opentray/ext-badge build`
  - `cargo build -p opentray-ext-badge --release`
  - `pnpm install --frozen-lockfile`
  - `pnpm run test:npm`
  - `bun test scripts/binaries`
  - `bun run scripts/binaries/release-plan.ts --root .`
  - `pnpm run verify`
  - `bun run openspec:vision -- validate implement-ext-badge-status-surface`
  - `bun run openspec:vision -- check implement-ext-badge-status-surface`
  - `git diff --check`
- Git commits reviewed:
  - `f04f50d chore: wire badge dock helper release artifacts`
- Uncommitted paths, if any:
  - `.changeset/badge-status-surface.md`
  - `.changeset/config.json`
  - `.github/workflows/verify-native-artifacts.yml`
  - `.gitignore`
  - `crates/opentray-ext-badge/src/lib.rs`
  - `openspec/changes/implement-ext-badge-status-surface/**`
  - `packages/ext-badge/README.md`
  - `packages/ext-badge/package.json`
  - `packages/ext-badge-windows-arm64/**`
  - `packages/ext-badge-windows-x64/**`
  - `pnpm-lock.yaml`
  - `scripts/binaries/**`
  - `scripts/npm/configure-trusted-publish.ts`
  - `scripts/npm/configure-trusted-publish.test.ts`
- Task checkboxes updated by this working context: 4.5, 5.1, and 5.2 were marked after the self-review commit-check and artifact creation.

## HTML Review Report

The HTML artifact mirrors this review in a scan-friendly structure. There is no new local screenshot because this context ran on Windows x64 and the current deliverable is Reduced Windows native package/runtime distribution.

## Exit Handling

- Normal handoff: run `bun run openspec:vision -- check implement-ext-badge-status-surface` after writing this artifact pair.
- Archive timing: leave `openspec archive implement-ext-badge-status-surface` for maintainer acceptance or a follow-up archive request.
- Abnormal exit: if final OpenSpec check fails for a new reason, fix the workflow artifact or write handoff evidence before returning.
