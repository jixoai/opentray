# Vision-Driven Self Review

## Review State

- Change: `implement-ext-lynx-macos-extension`
- Iteration: 1
- Recurring issue counts:
  - Lynx runtime zip staged into the wrong directory in release CI: 1, fixed by `629c3e1 fix(ci): anchor lynx runtime zip output`
  - Final npm publish proof missing: pending external GitHub run `26855436901`
- Exit-condition judgment: The code, package split, local tests, and OpenSpec validation for the macOS-first Lynx extension are in place. This change is not ready for archive yet because release run `26855436901` is still in progress and fresh-install npm acceptance has not been rerun against published packages.
- Next loop action: Wait for release run `26855436901`, then run task `4.6` fresh-install acceptance, refresh this review with the publish evidence, and archive only if the release/publish path is proven.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-lynx` should be a real official extension, not a research residue. | `packages/ext-lynx`, `packages/ext-lynx-darwin-arm64`, `packages/ext-lynx-darwin-x64`, and `crates/opentray-ext-lynx` exist on mainline; the public package READMEs describe the supported install and smoke flow. | Pass |
| Lynx runtime ownership must stay inside the extension family, not `opentray-core` or the broker. | `crates/opentray-ext-lynx/src/macos.rs` resolves `runtime/LynxExplorer.app.zip`, stages the external `.lynx.bundle`, and manages show/hide/cleanup lifecycle; the CLI smoke path loads `@opentray/ext-lynx` through the generic extension path in `packages/cli/src/smoke/daemon-lynx.ts`. | Pass |
| Release CI must stage both the Lynx dylib and the runtime sidecar zip into the darwin platform packages. | `.github/workflows/release.yml` builds `opentray-ext-lynx`, runs `scripts/release/build-lynx-runtime.sh`, and stages `LynxExplorer.app.zip` into `packages/ext-lynx-darwin-*`; `scripts/binaries/release-workflow.test.ts` and `scripts/binaries/artifacts.test.ts` both pass locally. | Pass for implementation, pending external publish proof |
| The user needs a visible, human-checkable Lynx smoke surface. | `packages/cli/src/smoke/daemon-lynx.ts`, `packages/cli/README.md`, and `packages/ext-lynx/README.md` document and implement `opentray smoke daemon-lynx --bundle <path>`; typed command coverage passes in Rust and TypeScript. | Pass for code path, pending post-publish fresh-install rerun |

## Deviations From Intent

1. The implementation is effectively complete, but the release closeout still depends on external GitHub wall-clock time. As of this review snapshot, `gh run view 26855436901` still reports both darwin native jobs inside `Build Lynx runtime sidecar`.
2. npm registry proof is still stale at review time: `npm view @opentray/ext-lynx version` and both darwin platform packages still report `0.0.0`, so task `4.6` cannot honestly be checked until release run `26855436901` finishes and the published versions update.

## New Questions For User

1. None. The remaining work is execution and verification, not product-direction ambiguity.

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `cargo test -p opentray-ext-lynx`
  - `pnpm --filter @opentray/ext-lynx test`
  - `bun test scripts/binaries/artifacts.test.ts scripts/binaries/release-workflow.test.ts`
  - `bun run openspec:vision -- validate implement-ext-lynx-macos-extension`
  - `gh run view 26855436901 --json status,conclusion,url,jobs`
  - `gh run list --workflow release.yml --branch feat/ext-lynx-phase3 --limit 3 --json databaseId,status,conclusion,headSha,createdAt,url`
  - `npm view opentray version`
  - `npm view @opentray/ext-lynx version`
  - `npm view @opentray/ext-lynx-darwin-arm64 version`
  - `npm view @opentray/ext-lynx-darwin-x64 version`
- Git commits reviewed:
  - `629c3e1 fix(ci): anchor lynx runtime zip output`
  - `5220e09 chore: version packages`
  - `a034707 fix(ci): widen intel lynx runtime budget`
- Uncommitted paths, if any:
  - `openspec/changes/implement-ext-lynx-macos-extension/review/self-review.md`
  - `openspec/changes/implement-ext-lynx-macos-extension/review/self-review.html`
  - `openspec/changes/implement-ext-lynx-macos-extension/tasks.md`
- Task checkboxes updated by this working context:
  - `openspec/changes/implement-ext-lynx-macos-extension/tasks.md`

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for screenshots, interaction evidence, structured tables, and any complex review display that does not belong in the Markdown thinking record.

## Exit Handling

- Normal exit: run `openspec archive implement-ext-lynx-macos-extension` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff implement-ext-lynx-macos-extension`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff implement-ext-lynx-macos-extension <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
