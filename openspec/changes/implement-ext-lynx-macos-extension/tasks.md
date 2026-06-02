## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant handoff, research branch assets, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm badge discussion is explicitly out of scope for tonight and that ext-lynx should proceed without further product debate.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the intent document defines a macOS-first Lynx extension When specs are reviewed Then facade, dylib, platform packages, release CI, and smoke proof all trace back to the intent.
- [x] 2.2 Add boundary-condition scenarios for missing runtime zip, unsupported platform, and re-show/hide lifecycle cleanup.
- [x] 2.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check implement-ext-lynx-macos-extension --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Add the official Lynx facade package `packages/ext-lynx` with typed commands, events, tests, README, and example path.
- [x] 3.3 Add darwin platform package atoms `packages/ext-lynx-darwin-arm64` and `packages/ext-lynx-darwin-x64` with correct package metadata and publish file topology.
- [x] 3.4 Add `crates/opentray-ext-lynx` as a `cdylib` and port the proven macOS runtime extraction / external bundle staging / launch lifecycle from the research CLI into the extension-owned runtime.
- [x] 3.5 Keep Lynx runtime ownership outside `opentray-core` and `opentray-bin`; only generic dynamic extension discovery/loading may change.
- [x] 3.6 Add a user-visible Lynx smoke path in the CLI, including explicit bundle-path input and clear output for launch success/failure.
- [x] 3.7 Extend native artifact staging scripts, tests, and release workflow so darwin release jobs stage `libopentray_ext_lynx.dylib` plus `LynxExplorer.app.zip` into Lynx platform packages.
- [x] 3.8 Add concise intent comments only at critical effect points where the runtime sidecar/package law would otherwise be easy to misread.
- [x] 3.9 Add a changeset for any package releases required by the third-stage Lynx landing.
- [ ] 3.10 Bootstrap any newly created npm package atoms and trusted publishing state needed before the release workflow can publish them.
- [x] 3.11 Update only current-context completed task checkboxes and commit them with the matching implementation / BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted Rust and TypeScript tests for the Lynx extension, release artifact topology, and CLI smoke surface.
- [x] 4.2 Build or reuse a real `.lynx.bundle` and prove the local Lynx smoke path launches a visible macOS runtime through the generic extension path.
- [x] 4.3 Run `bun run openspec:vision -- validate implement-ext-lynx-macos-extension` for this change.
- [x] 4.4 Run repo-level verification after the Lynx-specific gates are green.
- [ ] 4.5 Run `bun run openspec:vision -- commit-check implement-ext-lynx-macos-extension --phase self-review` before writing final review evidence.
- [ ] 4.6 After publish, perform fresh-install npm acceptance for `opentray` + `@opentray/ext-lynx` and record the real package/version proof.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [ ] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state implement-ext-lynx-macos-extension`.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff implement-ext-lynx-macos-extension` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive implement-ext-lynx-macos-extension` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check implement-ext-lynx-macos-extension` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
