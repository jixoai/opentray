# Vision-Driven Self Review

## Review State

- Change: `plan-webview-cross-platform-runtime-and-capability-matrix`
- Iteration: 1
- Recurring issue counts:
  - `validate-package-dirs` release-job failure: 1 occurrence, resolved in `23ebf6c`
- Exit-condition judgment: The change now satisfies its publish-ready objective. Docs and skills describe the same maturity matrix as the runtime, the release workflow can publish alpha snapshots without consuming the stable line, the external alpha publish succeeded, and a fresh install smoke proved the published daemon/WebView path against npm rather than workspace links.
- Next loop action: Commit this review, archive the change, and leave the Node 20 GitHub Actions deprecation warnings for a separate CI hygiene atom.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Publish truth must distinguish stable macOS behavior from Windows/Linux alpha or package-topology-only status. | `packages/ext-webview/README.md`, `packages/cli/README.md`, and the repo skills were updated in `d411fe7`; the current alpha registry state keeps `latest` on stable versions while `alpha` points to a snapshot line. | Pass |
| Unsupported taxonomy must stay explicit instead of collapsing into one vague story. | The OpenSpec requirements in `specs/webview-extension/spec.md` and the runtime comments/behavior delivered earlier on this branch keep runtime absence, family mismatch, declarative gate, and context unavailability distinct. | Pass |
| Alpha publish must not consume stable version numbers or stable release evidence. | GitHub Actions run `27011489839` skipped `Publish packages` and `Push release tags`, succeeded on `Publish alpha packages`, and npm reports `opentray latest=0.4.1` while `alpha=0.0.0-alpha-20260605111358`; `@opentray/ext-webview latest=0.3.0` while `alpha=0.0.0-alpha-20260605111358`. | Pass |
| Fresh-install proof must come from npm, not workspace links. | In `/tmp/opentray-alpha-smoke.vO7xMV`, `npm i opentray@alpha @opentray/ext-webview@alpha` followed by `npx opentray smoke daemon-tray` succeeded and produced live broker, tray-bounds, and WebView show evidence. | Pass |
| Build isolation must stop WebView release work from being dragged by Lynx. | The first remote alpha run exposed a planner-adjacent package-validation bug; `23ebf6c` fixed the hoisting error, and the successful rerun kept all Lynx cache/log steps skipped across the six native artifact jobs. | Pass |

## Deviations From Intent

1. The first remote alpha publish run (`27010918550`) failed before package validation completed because `scripts/binaries/validate-package-dirs.ts` referenced `runCommand` before initialization. This was not an intent failure, but it was a real workflow defect that had to be repaired in `23ebf6c` before the publish proof could count.
2. The release-family graph rewrite was split into its own archived OpenSpec atom (`plan-selective-release-family-builds`) instead of being buried inside this larger WebView maturity change. That preserved atom orthogonality while still serving this change's publish-ready objective.

## New Questions For User

1. Should the GitHub Actions Node 20 deprecation annotations (`actions/upload-artifact@v4`, `actions/download-artifact@v4`, `pnpm/action-setup@v4`) be handled immediately in a follow-up CI hygiene change before any stable cross-platform promotion work?

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - GitHub Actions success run: `https://github.com/jixoai/opentray/actions/runs/27011489839`
  - GitHub Actions initial failed run: `https://github.com/jixoai/opentray/actions/runs/27010918550`
  - `bun run scripts/binaries/release-plan.ts --root "$PWD"`
  - `bun run scripts/binaries/validate-package-dirs.ts --package-dirs-json '["packages/darwin-arm64","packages/darwin-x64","packages/ext-webview-darwin-arm64","packages/ext-webview-darwin-x64","packages/ext-webview-linux-arm64","packages/ext-webview-linux-x64","packages/ext-webview-windows-arm64","packages/ext-webview-windows-x64","packages/linux-arm64","packages/linux-x64","packages/windows-arm64","packages/windows-x64"]'`
  - `bun test scripts/binaries/*.test.ts`
  - `pnpm run verify`
  - `git diff --check`
  - `bun run openspec:vision -- commit-check plan-webview-cross-platform-runtime-and-capability-matrix --phase self-review`
  - `npm view opentray dist-tags --json`
  - `npm view @opentray/ext-webview dist-tags --json`
  - `npm view opentray@alpha version`
  - `npm view @opentray/ext-webview@alpha version`
  - Fresh install smoke:
    - working dir: `/tmp/opentray-alpha-smoke.vO7xMV`
    - install: `npm i opentray@alpha @opentray/ext-webview@alpha`
    - smoke: `OPENTRAY_HOME=/tmp/opentray-alpha-smoke.vO7xMV/home OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=500 OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 npx opentray smoke daemon-tray`
- Git commits reviewed:
  - `f6ca9a0 docs(spec): plan webview runtime capability matrix`
  - `d411fe7 feat: add webview alpha release path and maturity truth`
  - `896f84d docs(spec): prepare selective release family builds`
  - `f013c42 refactor(ci): derive release native builds from changesets`
  - `23ebf6c fix(ci): hoist release package validation runner`
- Uncommitted paths, if any:
  - user-owned:
    - `crates/opentray-ext-lynx/src/lib.rs`
    - `crates/opentray-ext-lynx/src/macos.rs`
  - review paths from this working context:
    - `openspec/changes/plan-webview-cross-platform-runtime-and-capability-matrix/review/self-review.md`
    - `openspec/changes/plan-webview-cross-platform-runtime-and-capability-matrix/review/self-review.html`
    - `openspec/changes/plan-webview-cross-platform-runtime-and-capability-matrix/tasks.md`
- Task checkboxes updated by this working context:
  - `2.5`
  - `3.9`
  - `3.10`
  - `4.5`
  - `4.6`
  - `5.1`
  - `5.2`
  - `5.3`

## HTML Review Report

Created `review/self-review.html` as the structured evidence layer for the alpha publish, npm registry state, and fresh-install smoke proof.

## Exit Handling

- Normal exit: run `openspec archive plan-webview-cross-platform-runtime-and-capability-matrix` and commit the archive result.
- Abnormal exit: not needed. The publish blocker recurred only once and is now resolved.
- Intent realignment: not needed. The larger objective remained stable while the selective build-law refactor was split into its own supporting atom.
