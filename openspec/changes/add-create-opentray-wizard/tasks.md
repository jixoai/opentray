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
- [x] 2.18 BDD: Given a PTY-attached command emitting non-UTF-8 bytes, when output streams, then bytes reach the renderer base64-encoded and unmodified (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.19 BDD: Given a confirmed service, when its tab exists, then the nav bar shows an editable URL with working back/forward (spec: create-wizard / Chrome-style Tabs Panel).
- [x] 2.20 BDD: Given one confirmed and one unconfirmed port, when tabs render, then exactly one iframe tab exists (spec: create-wizard / Chrome-style Tabs Panel).
- [x] 2.21 BDD: Given services in the terminal status bar, when one is clicked, then the matching-hostname iframe tab activates (spec: create-wizard / Chrome-style Tabs Panel).
- [x] 2.22 BDD: Given untouched placeholder-backed fields, when the user confirms, then the frozen identity uses placeholder defaults (spec: create-wizard / Placeholder Defaults And Icon Input).
- [x] 2.23 BDD: Given the terminal and a service tab, when the user switches tabs and back then clicks and types, then keystrokes still reach the command (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.24 BDD: Given the idle form, when all fields are filled without running, then confirm and materialize proceed (spec: create-wizard / Usable Form Without Running).
- [x] 2.25 BDD: Given command text primed without spawning, when placeholders render, then appId/targetDir derive from the command text (spec: create-wizard / Usable Form Without Running).
- [x] 2.26 BDD: Given no service discovered and a manual port, when confirmed, then materialization uses the manual port (spec: create-wizard / Usable Form Without Running).
- [x] 2.27 BDD: Given output arriving before the renderer is ready, when the terminal finishes loading, then buffered chunks flush in order (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.28 BDD: Given the wizard under Bun, when a preview command runs, then output flows through pipe fallback with a visible notice (spec: create-wizard / Interactive Terminal Preview).
- [x] 2.29 BDD: Given a running command, when the process is killed externally, then a run-status event restores the Run button (spec: create-wizard / Interactive Terminal Preview).
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

## 4c. Implementation (Round 4 — objective transport, tabs panel, react-shadcn)

- [x] 4.20 Switch the PTY runtime to prebuilt `@lydell/node-pty` with unchanged runtime probing and pipe fallback.
- [x] 4.21 Rework transport to objective base64 byte frames: PTY output b64-framed on SSE, input endpoint accepts b64 bytes, no server-side UTF-8 decoding.
- [x] 4.22 Build the react-shadcn webui (Vite + React + Tailwind + radix/shadcn components) as a workspace package with static build output.
- [x] 4.23 Implement the Chrome-style tabs panel: terminal tab, per-service iframe tabs, context navigation bar (command vs editable URL with back/forward/reload), terminal status bar (cursor, selection, clickable services).
- [x] 4.24 Rework the form to placeholder-based defaults with a dedicated icon input; confirmation resolves empty fields to placeholder defaults.
- [x] 4.25 Serve built webui assets from the wizard server with token-guarded page + public static asset routes.
- [x] 4.26 Update tests, docs, changeset; browser-accept the full flow.

## 4d. Implementation (Round 5 — responsive terminal, form without run)

- [x] 4.27 Keep the terminal tab mounted across tab switches (forceMount) so the ghostty instance is never destroyed; verify click-and-type works after switching tabs.
- [x] 4.28 Add /api/prime deriving placeholder defaults from command text without spawning; debounce client-side priming on command input.
- [x] 4.29 Make the form visible/editable from idle; add a manual service-port input prefilled by discovery; confirm resolves manual port; create rejects clearly when no port at all.
- [x] 4.30 ego-browser walkthrough of the full flow (click-and-type terminal, tab switch survival, form-without-run creation), recorded in review notes.

## 4e. Implementation (Round 6 — Bun-safe output, run lifecycle button)

- [x] 4.31 Skip the native PTY under Bun (onData never delivers) and degrade to pipes with an explanatory notice.
- [x] 4.32 Emit run-status lifecycle events on spawn/exit; stop discovery polling at exit; allow re-submission after process death.
- [x] 4.33 WebUI: buffer log chunks until the terminal is ready and flush after; prewarm the ghostty module at page load.
- [x] 4.34 WebUI: single Run/Interrupt toggle button bound to process liveness; command input editable again after death.
- [x] 4.35 ego-browser walkthrough
- [x] 4.36 Align the dev script runtime with the openspecui reference (superseded by 4.37).
- [x] 4.37 Implement the Bun-native PTY backend (see plan history).
- [x] 4.38 Rewrite the scraper: collect all link/favicon candidates + /favicon.ico, decode true dimensions (sharp; ICO via directory/PNG-payload/DIB extraction), perceptual-hash dedupe, rank by clarity; never skip SVG.
- [x] 4.39 Wizard/server: icon-candidates state + `icons` event; GET /api/icon-data/:port/:index (token auth); POST /api/icon-upload saving a local image to the session temp dir.
- [x] 4.40 WebUI: tabs strip above the toolbar; forceMount keep-alive for all tab contents (iframe must not reload); auto-open+focus a newly sniffed service tab.
- [x] 4.41 WebUI: square icon FileInput (drag/click upload with preview) + candidate thumbnails ranked by clarity, click fills the icon; full-width row; success dialog shows the chosen icon.
- [x] 4.42 ego-browser walkthrough with `npx @deepseek-ai/dsh web --port 0`: tabs order, iframe no-reload, SVG candidate visible+selectable, auto-focus, full create flow. with the owner's exact commands: `npx @deepseek-ai/dsh web` (port-occupied error visible) and `--port 19000` (service discovered), button toggle, external kill restore.

## 5. Verification

- [x] 5.1 Run package vitest suites (tokenizer, appId, port fixtures, scrape, freeze semantics, launch vector, scaffold artifacts, server guard).
- [x] 5.2 Run an integration test driving CommandRun→discovery→scrape→scaffold against a `node -e` HTTP server command in a temp dir with `--skip-install`.
- [ ] 5.3 Run repo gates: `pnpm run build`, `pnpm run verify`, `openspec validate --all --strict`, `git diff --check`.
- [ ] 5.4 Manual visual acceptance: built bin drives a real browser wizard run end-to-end on macOS (Dock icon/name, open-app cold/warm), recorded in review notes.

## 4f. Implementation (Round 9 — tray icon, advanced panel, generated-app shell)

- [x] 4.43 Scraper: build solid-color variants (black/white) of every candidate via sharp alpha masks; aHash-dedupe variants; unified candidate list tagged with variant metadata.
- [x] 4.44 Wizard/server: trayIconPath + showStartupTerminal + showAddressBar form fields; tray-candidate select endpoint; defaults resolve tray icon = app icon choice.
- [x] 4.45 Materialize: generate downscaled tray icon PNG (template variant for darwin when solid); write shell config; conditionally add @lydell/node-pty dependency and shell UI assets.
- [x] 4.46 Scaffold: shell-enabled main.mjs (PTY spawn+ring, shell HTTP server with SSE/state/input endpoints, continuous multi-port monitor, detach detection) opening a DEDICATED terminal window when enabled and a DEDICATED window per listened port (address-bar wrapper when enabled, direct URL otherwise), per-window (detached) titles; tray icon wiring.
- [x] 4.47 create-webui: shared IconPicker; advanced panel (tray picker + two window-mode checkboxes); dedicated terminal.html page (command bar + status bar + PTY) and browse.html address-bar wrapper page (Navigation API with fallback); vite multi-entry relative-base build.
- [x] 4.48 Tests: scraper variants, form fields/config passthrough, scaffold shell template, server endpoints.
- [x] 4.49 ego-browser walkthrough: wizard advanced flow with `npx @deepseek-ai/dsh web --port 0`; generated app run: startup terminal streams, ports auto-open, address bar navigates (Navigation API), killing the service marks the title `(detached)`. Evidence: dedicated windows verified via CGWindowList (2 service 1200x828 + terminal 900x588 with `— Terminal` title), Navigation API sameDocument traversal verified, detach state verified through shell events; the final titlebar string was blocked from direct observation by a session TCC screen-recording change (window-name reads returned nil for ALL processes), with the setTitle path exercised by the proven detach state machine.
