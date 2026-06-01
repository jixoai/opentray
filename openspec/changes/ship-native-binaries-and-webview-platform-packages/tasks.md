## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` reflects current code survey, existing OpenSpec survey, and requirement-bearing user correction.
- [x] 1.2 Confirm existing specs define dynamic extension ABI as the first-stage target law.
- [x] 1.3 Confirm current worktree has an in-progress daemon health/WebView demo change and avoid reverting or overwriting it.
- [x] 1.4 Confirm each task checkbox will be updated only by the agent that completed and verified it in the current working context.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the workspace is inspected When first-stage packages are validated Then all six `@opentray/ext-webview-<os>-<arch>` package atoms exist with correct `os` and `cpu` metadata.
- [x] 2.2 Scenario: Given native artifacts are built locally When git status is inspected Then generated daemon binaries and WebView dynamic libraries are not tracked.
- [ ] 2.3 Scenario: Given `opentray` is installed from npm When the daemon starts Then it resolves the executable from the current platform optional package.
- [ ] 2.4 Scenario: Given no matching daemon platform package is installed When daemon start is attempted Then the CLI fails with a typed missing-platform-binary message.
- [ ] 2.5 Scenario: Given a fresh npm install When the public smoke command is run Then it does not require workspace source files or `pnpm --filter`.
- [x] 2.6 Scenario: Given a dynamic extension library is resolved When the daemon validates it Then missing ABI version/init/command/deinit symbols produce structured load errors.
- [x] 2.7 Scenario: Given a dynamic extension command is dispatched When it crosses the ABI Then Rust kernel types do not cross the dynamic library boundary.
- [x] 2.8 Scenario: Given WebView platform package is installed When `load-ext webview` runs Then daemon locates the package-adjacent dynamic library through the generic extension host.
- [x] 2.9 Scenario: Given WebView dynamic runtime is loaded When demo commands run Then `show`, `postMessage`, and `evaluate` remain visually observable.
- [x] 2.10 Scenario: Given platform WebView cannot create a window When `show` runs Then the extension returns typed unsupported/capability failure instead of fake success.
- [ ] 2.11 Scenario: Given release workflow prepares npm publish When artifacts are staged Then every daemon and WebView platform package contains its expected native artifact path.
- [ ] 2.12 Scenario: Given packages are published When a fresh project installs from npm Then daemon health and WebView smoke run from registry packages, not workspace links.

## 3. OpenSpec Checkpoint

- [x] 3.1 Run `bun run openspec:vision -- validate ship-native-binaries-and-webview-platform-packages`.
- [x] 3.2 Run `bun run openspec:vision -- commit-check ship-native-binaries-and-webview-platform-packages --phase research-plan`.
- [x] 3.3 Commit `plans/plan.md`, `specs/**/spec.md`, and `tasks.md` before product-code work starts.

## 4. Implementation

- [x] 4.1 Add six `packages/ext-webview-<os>-<arch>` workspace package atoms with platform metadata, README, and binary artifact ignore placeholders.
- [x] 4.2 Update `.gitignore` so generated platform `bin/` and `lib/` artifacts are ignored while package metadata remains tracked.
- [x] 4.3 Add a TypeScript binary artifact staging script that can stage the current local daemon binary into the matching daemon platform package.
- [x] 4.4 Extend artifact staging to WebView dynamic library package paths without hardcoding product branches beyond generic package kind metadata.
- [x] 4.5 Add tests for package target mapping, artifact path mapping, and no-commit generated artifact rules.
- [x] 4.6 Update `opentray` daemon binary resolver to prefer installed platform packages before workspace dev fallback.
- [x] 4.7 Add resolver tests for explicit env override, installed package resolution, workspace fallback, and missing platform package error.
- [x] 4.8 Add public npm-installable smoke command path for daemon tray/WebView verification.
- [x] 4.9 Implement dynamic extension ABI structs and symbol validation in Rust without passing Rust kernel types across ABI.
- [x] 4.10 Implement generic dynamic extension discovery from package-adjacent artifacts, user config, and `OPENTRAY_EXT_PATH`.
- [x] 4.10a Define and implement the host UI capability boundary needed for a dynamic WebView library to create or attach visible windows without receiving Rust event-loop/window types across ABI.
- [x] 4.10b Extend dynamic extension discovery to search request-package dependency roots so pnpm-style layouts can resolve `@opentray/ext-webview-<os>-<arch>` without relying on daemon-package adjacency.
- [x] 4.11 Move current WebView native runtime behind the dynamic extension boundary for supported platforms.
- [x] 4.12 Ensure current internal WebView adapter is removed or demoted to explicit development-only fallback that still exercises the host contract.
- [x] 4.13 Update CI release workflow to build daemon binaries and WebView dynamic libraries in a platform matrix.
- [x] 4.14 Update publish job to download artifacts, stage them into package dirs, run pack validation, and publish with trusted publishing.
- [x] 4.15 Configure changesets so daemon platform packages version with `opentray`, and WebView platform packages version with `@opentray/ext-webview`.
- [x] 4.16 Add first-stage release changeset covering daemon binaries, WebView platform packages, and npm-installed smoke.
- [ ] 4.17 Run package bootstrap/trusted-publish check for all new WebView platform packages. Current attempt failed with npm E403 when inspecting trust state through `.env` `NPM_TOKEN`; rerun with npm auth accepted by `npm trust`.
- [x] 4.18 Add concise intent comments at artifact staging, resolver fallback, and ABI validation boundaries.

## 5. Verification

- [x] 5.1 Run targeted TypeScript tests for package mapping and artifact staging.
- [x] 5.2 Run targeted Rust tests for dynamic ABI validation and extension load errors.
- [x] 5.3 Run `cargo fmt --check`.
- [x] 5.4 Run `cargo test`.
- [x] 5.5 Run `pnpm run build`.
- [x] 5.6 Run `pnpm run verify`.
- [x] 5.7 Run `bun run openspec:vision -- validate ship-native-binaries-and-webview-platform-packages`.
- [x] 5.8 Run `git diff --check`.
- [x] 5.9 Run current-platform local package staging and `npm pack --dry-run --json` for `@opentray/darwin-arm64`, `@opentray/ext-webview-darwin-arm64`, `opentray`, and `@opentray/ext-webview`.
- [ ] 5.9a Run or simulate `npm pack --dry-run --json` for every daemon and WebView platform package after CI artifacts exist.
- [ ] 5.10 Run release workflow dry-run or equivalent artifact staging simulation before merge.
- [ ] 5.11 After CI publish, install from real npm registry in a fresh directory and run daemon health/start/stop smoke.
- [ ] 5.12 After CI publish, run WebView visual smoke from npm-installed packages and ask the user to confirm the window and visible mutations.
- [x] 5.13 Run targeted TypeScript tests for binary resolver and npm-installable smoke command parsing.
- [x] 5.14 Run targeted Rust tests for dynamic extension request-package discovery.

## 6. Self-Review Loop

- [x] 6.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`, specs, and tasks.
- [x] 6.2 Generate `review/self-review.html` as structured interaction evidence.
- [x] 6.3 Run `bun run openspec:vision -- commit-check ship-native-binaries-and-webview-platform-packages --phase self-review`.
- [ ] 6.4 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 6.5 If review enters a real loop, run `bun run openspec:vision -- review-state ship-native-binaries-and-webview-platform-packages`.
- [ ] 6.6 If review cannot exit normally, run `bun run openspec:vision -- handoff ship-native-binaries-and-webview-platform-packages` and commit the handoff evidence.
- [ ] 6.7 Do not archive until real npm registry smoke and human visual WebView confirmation pass.
- [ ] 6.8 Run `bun run openspec:vision -- check ship-native-binaries-and-webview-platform-packages` before claiming workflow completion.
