## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration or cross-version daemon cleanup is required; this change only changes current process idle behavior and demo behavior.
- [x] 1.3 Confirm each task checkbox will be updated only by the agent that completed and verified it in the current working context.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the daemon starts and no client connects When the idle timeout expires Then the daemon exits.
- [x] 2.2 Scenario: Given the last client disconnects When the idle timeout expires without a new connection Then the daemon exits.
- [x] 2.3 Scenario: Given idle shutdown is pending When a new client connects before the timeout Then shutdown is cancelled.
- [x] 2.4 Scenario: Given `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0` When no clients are connected Then idle shutdown is disabled.
- [x] 2.5 Scenario: Given the daemon tray example is running When the user selects the quit item Then the example prints the routed click and exits.
- [x] 2.6 Scenario: Given the demo exits and the daemon becomes idle When the idle timeout expires Then a later demo run auto-starts a fresh daemon.
- [x] 2.7 Scenario: Given the broker emits a menu click event When TS parses it Then event fields are camelCase and `event.itemId` is defined.
- [x] 2.8 Scenario: Given the daemon tray example exposes WebView actions When they are clicked Then `@opentray/ext-webview` facade commands travel through `TrayHandle.commandExtension` and the daemon native WebView extension path.
- [x] 2.9 Scenario: Given the daemon tray example is running on macOS When the user clicks WebView Show HTML Then a real native WebView window appears.
- [x] 2.10 Scenario: Given a same-version daemon is running When `opentray daemon health` is executed Then it prints daemon pid, endpoint, protocol/package metadata, session count, and session metadata.
- [x] 2.11 Scenario: Given no same-version daemon is running When `opentray daemon health` is executed Then it reports not running without starting the daemon.
- [x] 2.12 Scenario: Given the WebView demo window is visible When Post Message and Evaluate JS are clicked Then the document visibly updates inside the WebView.

## 3. OpenSpec Checkpoint

- [x] 3.1 Run `bun run openspec:vision -- validate fix-daemon-idle-and-menu-quit`.
- [x] 3.2 Run `bun run openspec:vision -- commit-check fix-daemon-idle-and-menu-quit --phase research-plan`.
- [x] 3.3 Commit `plans/plan.md`, `specs/**/spec.md`, and `tasks.md` before product-code work starts.

## 4. Implementation

- [x] 4.1 Add broker idle-timeout parsing with default 30 seconds, env override, and `0` disable semantics.
- [x] 4.2 Implement macOS broker idle shutdown by scheduling cancellable idle events on the native event loop.
- [x] 4.3 Implement Unix blocking broker idle shutdown with timeout receive semantics.
- [x] 4.4 Keep idle shutdown out of `opentray-core` and out of TypeScript client direct process-kill behavior.
- [x] 4.5 Make the daemon tray example quit item label unambiguous and ensure routed quit clicks close the client connection and process.
- [x] 4.6 Add concise comments at the idle-generation cancellation point and the demo quit event boundary.
- [x] 4.7 Fix Rust `TrayEvent` serialization so nested event fields are camelCase.
- [x] 4.8 Tighten TypeScript server-frame parsing so snake_case tray event fields are not accepted as valid protocol events.
- [x] 4.9 Extend the daemon tray example with `@opentray/ext-webview` facade actions for show, navigate, postMessage, and hide.
- [x] 4.10 Ensure broker extension loading/command handling can acknowledge the demo WebView native path without hardcoding WebView behavior or pretending arbitrary dynamic loading works in `opentray-core`.
- [x] 4.11 Replace the daemon preview recorder path with a macOS native WebView extension loader that sends runtime commands into the daemon event loop without importing `wry` into `opentray-core`.
- [x] 4.12 Ensure `show`, `navigate`, `postMessage`, `evaluate`, and `hide` operate on the daemon-owned native WebView window.
- [x] 4.13 Add additive protocol health request/response frames in Rust and TypeScript without bumping `PROTOCOL_VERSION`.
- [x] 4.14 Implement daemon-composition health responses in macOS and Unix broker loops, keeping pid/session state out of `opentray-core`.
- [x] 4.15 Add `opentray daemon health` CLI behavior that does not auto-start a daemon when it is absent.
- [x] 4.16 Make WebView demo HTML and fallback runtime HTML expose visible state targets for `postMessage` and `evaluate`.

## 5. Verification

- [x] 5.1 Run targeted Rust tests for idle-timeout parsing and broker/backend code paths.
- [x] 5.2 Run targeted TypeScript tests for the daemon tray example or client behavior if the behavior is testable without native menu clicks.
- [x] 5.3 Run `cargo test -p opentray-bin -p opentray-backend-tray-icon -p opentray-core`.
- [x] 5.4 Run `pnpm --filter opentray test`.
- [x] 5.5 Run `pnpm --filter opentray typecheck`.
- [x] 5.6 Run `pnpm run build`.
- [x] 5.7 Run `pnpm run verify`.
- [x] 5.8 Run `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=500 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=500 pnpm --filter opentray example:daemon-tray` and confirm a later `daemon stop` reports not running or stale cleanup.
- [x] 5.9 Run `bun run openspec:vision -- validate fix-daemon-idle-and-menu-quit`.
- [x] 5.10 Run `git diff --check`.
- [ ] 5.11 Ask the user to run the example without auto-exit and click the quit item before archive.
- [x] 5.12 Run Rust protocol tests proving menu click events serialize as `itemId`.
- [x] 5.13 Run TypeScript spec tests proving snake_case event frames are rejected and camelCase frames are accepted.
- [x] 5.14 Run the daemon demo and confirm WebView menu actions produce broker command/event output through the native WebView extension path.
- [x] 5.15 Run targeted Rust tests or compile gates proving the native WebView loader remains outside `opentray-core`.
- [ ] 5.16 Run the daemon demo and ask the user to confirm `WebView Commands -> Show HTML` opens a real native WebView window.
- [x] 5.17 Run Rust protocol tests proving `health` and `daemon-health` wire shapes.
- [x] 5.18 Run TypeScript spec tests proving `daemon-health` parsing.
- [x] 5.19 Run CLI tests proving `daemon health` is parsed and health output can be formatted.
- [x] 5.20 Run `pnpm --filter opentray cli -- daemon health` against both non-running and running daemon states.
- [ ] 5.21 Ask the user to confirm `Post Message` and `Evaluate JS` visibly update the WebView window.

## 6. Self-Review Loop

- [x] 6.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`, specs, and tasks.
- [x] 6.2 Generate `review/self-review.html` as structured interaction evidence.
- [x] 6.3 Run `bun run openspec:vision -- commit-check fix-daemon-idle-and-menu-quit --phase self-review`.
- [ ] 6.4 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 6.5 If review enters a real loop, run `bun run openspec:vision -- review-state fix-daemon-idle-and-menu-quit`.
- [ ] 6.6 If review cannot exit normally, run `bun run openspec:vision -- handoff fix-daemon-idle-and-menu-quit` and commit the handoff evidence.
- [ ] 6.7 Do not archive until the user confirms idle-stop and quit click behavior.
- [x] 6.8 Run `bun run openspec:vision -- check fix-daemon-idle-and-menu-quit` before claiming workflow completion.
