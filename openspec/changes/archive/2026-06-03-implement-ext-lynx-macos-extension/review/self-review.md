# Vision-Driven Self Review

## Review State

- Change: `implement-ext-lynx-macos-extension`
- Iteration: 1
- Recurring issue counts:
  - Lynx runtime zip staged into the wrong directory in release CI: 1, fixed by `629c3e1 fix(ci): anchor lynx runtime zip output`
  - Release workflow tail pushed the branch together with tags: 1, fixed by `91a84ab fix(ci): push release tags without branch fast-forward`
- Exit-condition judgment: The macOS-first Lynx extension is now publish-proven. Release run `26855436901` built both darwin artifacts, npm published `opentray@0.4.0` plus the Lynx packages, fresh-install acceptance launched the packaged Lynx runtime from npm, and the missing release tags were pushed manually after the run exposed a branch-fast-forward flaw in the workflow tail.
- Next loop action: Archive this change now that the workflow tail fix is committed and the publish proof is complete.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-lynx` should be a real official extension, not a research residue. | `packages/ext-lynx`, `packages/ext-lynx-darwin-arm64`, `packages/ext-lynx-darwin-x64`, and `crates/opentray-ext-lynx` exist on mainline; the public package READMEs describe the supported install and smoke flow. | Pass |
| Lynx runtime ownership must stay inside the extension family, not `opentray-core` or the broker. | `crates/opentray-ext-lynx/src/macos.rs` resolves `runtime/LynxExplorer.app.zip`, stages the external `.lynx.bundle`, and manages show/hide/cleanup lifecycle; the CLI smoke path loads `@opentray/ext-lynx` through the generic extension path in `packages/cli/src/smoke/daemon-lynx.ts`. | Pass |
| Release CI must stage both the Lynx dylib and the runtime sidecar zip into the darwin platform packages. | Release run `26855436901` produced `native-darwin-arm64` and `native-darwin-x64` artifacts containing `libopentray_ext_lynx.dylib` and `LynxExplorer.app.zip`; `native-darwin-x64` also contained `opentray` and `libopentray_ext_webview.dylib`. The workflow tail later failed only when pushing the branch together with tags, not during artifact staging or npm publish. | Pass |
| The user needs a visible, human-checkable Lynx smoke surface. | A fresh npm install of `opentray@0.4.0` plus `@opentray/ext-lynx@0.1.0` in a temp directory auto-started the daemon, created the smoke tray, and emitted a `shown` ext-event pointing at the packaged runtime zip inside `node_modules/.pnpm/@opentray+ext-lynx-darwin-arm64@0.1.0.../runtime/LynxExplorer.app.zip`. | Pass |

## Deviations From Intent

1. Release run `26855436901` published the packages successfully, but the workflow still ended red because `git push --follow-tags` also tried to push branch `feat/ext-lynx-phase3` from the older run checkout `629c3e1`, which was behind remote `4e3e7b8`. This was a release-tail mechanics flaw, not a package or native artifact failure.
2. The first fresh-install retry used `OPENTRAY_HOME="$tmp/.opentray"`, which duplicated the state root into `.../.opentray/.opentray/<version>/...`. The CLI README now clarifies that `OPENTRAY_HOME` is the home root and OpenTray itself appends `.opentray/<package-version>`.

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
  - `pnpm add opentray @opentray/ext-lynx` in a temp directory, then `OPENTRAY_HOME="$tmp" pnpm exec opentray daemon health`
  - `OPENTRAY_HOME="$tmp" pnpm exec opentray smoke daemon-lynx --bundle /Users/kzf/Dev/GitHub/jixoai-labs/opentray/research/lynx/app/dist/main.lynx.bundle`
  - `OPENTRAY_HOME="$tmp" pnpm exec opentray daemon stop`
  - `git push origin 'opentray@0.4.0' '@opentray/darwin-arm64@0.4.0' '@opentray/darwin-x64@0.4.0' '@opentray/ext-lynx@0.1.0' '@opentray/ext-lynx-darwin-arm64@0.1.0' '@opentray/ext-lynx-darwin-x64@0.1.0' '@opentray/linux-arm64@0.4.0' '@opentray/linux-x64@0.4.0' '@opentray/windows-arm64@0.4.0' '@opentray/windows-x64@0.4.0'`
- Git commits reviewed:
  - `629c3e1 fix(ci): anchor lynx runtime zip output`
  - `5220e09 chore: version packages`
  - `a034707 fix(ci): widen intel lynx runtime budget`
  - `91a84ab fix(ci): push release tags without branch fast-forward`
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
