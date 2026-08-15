<!--
Orthogonal intents (maintained 2026-07-22; original user request: implement the
npm create-opentray initializer that turns a start command into an OpenTray-hosted
app through a WebUI wizard):
1. Lock the wizard contract as OpenSpec artifacts before product code.
2. Ship the create-opentray package under monorepo and icon/launch platform laws.
3. Prove discovery, scrape, freeze, and materialize behavior with BDD evidence.
4. Keep the consumer path a normal package-manager install.
-->

## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` records the SDK/packaging/vite-plugin/changeset survey plus the user's seven-step wizard requirement.
- [x] 1.2 Confirm the change is additive: new `packages/create` package, no core/crate modifications, no platform law changes beyond the recorded `create-opentray` publish-name exception.
- [x] 1.3 Confirm Windows/Linux persistence stays a hint; no shortcut atom in this change.

## 2. BDD Contract

- [x] 2.1 BDD: Given the wizard launches with `--no-open`, when the server binds, then stdout shows the tokened loopback URL and no browser spawns (spec: create-wizard / Wizard entry and loopback WebUI).
- [x] 2.2 BDD: Given a POST without token or with a non-loopback Host, when it hits a mutating endpoint, then it is rejected 401/403 with unchanged state (spec: create-wizard / Wizard entry and loopback WebUI).
- [x] 2.3 BDD: Given a command that fails immediately, when it is submitted, then the WebUI receives exit code/stderr and returns to an editable retry state (spec: create-wizard / Run command once with live shell output).
- [x] 2.4 BDD: Given a running command writing output, when chunks arrive, then the SSE stream appends log events (spec: create-wizard / Run command once with live shell output).
- [x] 2.13 BDD: Given the wizard page with a command entered, when the user clicks Run, then the terminal panel is visible immediately before any output or state event (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.14 BDD: Given a PTY-attached command reading stdin, when keystrokes are posted to the input endpoint, then the command receives them and its response streams back (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.15 BDD: Given the native PTY dependency is unavailable, when a command is submitted, then the wizard degrades to pipe mode with a notice and stays fully functional (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.16 BDD: Given a PTY-attached command, when the terminal is resized, then the pseudo-terminal adopts the new columns and rows (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.17 BDD: Given an unrelated local process listens on a new port while the preview runs, when the wizard polls, then that port is not listed as a service (spec: create-wizard / HTTP Service Discovery From Port Diffing).
- [x] 2.5 BDD: Given a command opening 19080 then 19081, when both verify as HTTP, then both are listed with 19080 selected (spec: create-wizard / HTTP service discovery from port diffing).
- [x] 2.6 BDD: Given a user-edited appName, when a later scrape returns another title, then the edited value is preserved (spec: create-wizard / Favicon/title scrape with default derivation).
- [x] 2.7 BDD: Given `npx somecommand start --xx`, when defaults derive, then appId is `start.somecommand.npx` (spec: create-wizard / Favicon/title scrape with default derivation).
- [x] 2.8 BDD: Given the user confirms creation while a scrape is mid-flight, when the dialog renders, then the frozen values never change afterwards (spec: create-wizard / Form freeze and confirmation dialog).
- [x] 2.9 BDD: Given materialize succeeds, when the target directory is inspected, then it contains package.json/opentray.app.json/main.mjs/app-icon/README.md and the macOS stable bundle exists (spec: create-wizard / App materialization with progress log).
- [x] 2.10 BDD: Given the generated main.mjs runs, when the service port answers, then createTray + appMode WebView window open with the frozen identity and absolute appLaunch vector (spec: create-wizard / App materialization with progress log).
- [x] 2.11 BDD: Given a non-empty target directory without --force, when materialize starts, then it fails clearly writing nothing (spec: create-wizard / App materialization with progress log).
- [x] 2.12 BDD: Given success on macOS, when 打开应用 is clicked, then `open <bundle>.app` reveals/focuses the app window with the generated icon (spec: create-wizard / Success dialog with open-app and pinning hint).

## 3. OpenSpec Evidence Gate

- [x] 3.1 Run `bun run openspec:vision -- validate add-create-opentray-wizard` and fix strict schema/format errors.
- [x] 3.2 Run `bun run openspec:vision -- commit-check add-create-opentray-wizard --phase research-plan` and commit the ready plan/spec/task artifacts before product-code work starts.

## 4. Implementation

- [x] 4.1 Scaffold `packages/create` (package.json with bin/dist/files, tsconfig, vitest config, build copying the WebUI into dist, README contract) and add it to `.changeset/config.json` fixed group plus a minor changeset.
- [x] 4.2 Implement `tokenize.ts` + `app-id.ts` (shell-style splitting; pre-option segment reversal) with unit tests.
- [x] 4.3 Implement `port-scan.ts` (baseline snapshot, lsof/netstat/PowerShell listeners, HTTP verify) with fixture tests.
- [x] 4.4 Implement `scrape.ts` (NO_PROXY merge, title/favicon candidate ranking, temp-file download, first-letter fallback) with unit tests.
- [x] 4.5 Implement `command-run.ts` (spawn modes, ring buffer, exit reporting, tree kill on POSIX/Windows).
- [x] 4.6 Implement `launch-vector.ts` (absolute interpreter+entry resolution, PATH-independence) with unit tests.
- [x] 4.7 Implement `scaffold.ts` (opentray.app.json, main.mjs template, package.json, README) with artifact tests.
- [x] 4.8 Implement `materialize.ts` + `open-app.ts` (icon generation via vite-plugin generator, pm detection/install, detached first launch, ready marker, macOS bundle gate, open/focus).
- [x] 4.9 Implement `wizard.ts` state machine + `server.ts` (SSE, token/Host guard, JSON API) with API tests.
- [x] 4.10 Implement `bin.ts` (flag parsing, browser open per platform, signal cleanup) and the single-file `webui/index.html`.
- [x] 4.11 Add consumer documentation under `skills/opentray` and root README link.

## 4b. Implementation (Round 2 — interactive terminal)

- [x] 4.12 Add optional `node-pty` dependency with runtime feature detection and pipe-mode fallback in `command-run.ts` (write/resize/run events, PTY tree teardown).
- [x] 4.13 Add `term` SSE events (stream-decoded UTF-8), `/api/terminal-input` and `/api/terminal-resize` endpoints, and static `/vendor/ghostty-web` asset serving with traversal guards.
- [x] 4.14 Reorder `submitCommand` so the running state is emitted before baseline snapshotting, for instant panel feedback.
- [x] 4.15 Replace the WebUI console with a ghostty-web terminal (vendored JS+WASM, FitAddon sizing, batched input flush, plain-text fallback when the module cannot load).
- [x] 4.16 Vendor ghostty-web assets in the build script; add it as a build-time devDependency.
- [x] 4.17 Update README/skill docs and extend the changeset with the interactive-terminal capability.
- [x] 4.18 Carry the wizard session token in every browser-side API call (Authorization header) and in the EventSource URL.
- [x] 4.19 Filter port discovery by preview-process-tree ownership (lsof/netstat PID columns, recursive `pgrep -P` walk on POSIX) so foreign loopback listeners are never adopted as services.

## 5. Verification

- [x] 5.1 Run package vitest suites (tokenizer, appId, port fixtures, scrape, freeze semantics, launch vector, scaffold artifacts, server guard).
- [x] 5.2 Run an integration test driving CommandRun→discovery→scrape→scaffold against a `node -e` HTTP server command in a temp dir with `--skip-install`.
- [ ] 5.3 Run repo gates: `pnpm run build`, `pnpm run verify`, `openspec validate --all --strict`, `git diff --check`.
- [ ] 5.4 Manual visual acceptance: built bin drives a real browser wizard run end-to-end on macOS (Dock icon/name, open-app cold/warm), recorded in review notes.
