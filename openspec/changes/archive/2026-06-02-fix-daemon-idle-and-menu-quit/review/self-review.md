# Self Review

## Verdict

The follow-up intent is satisfied. The daemon now owns idle shutdown, Rust event frames serialize nested tray event fields as camelCase, TypeScript rejects snake_case tray event payloads, `opentray daemon health` reports daemon/session state without auto-starting, and the daemon tray example includes a `WebView Commands` submenu that exercises `@opentray/ext-webview` through a real macOS native WebView runtime with visible `postMessage` and `Evaluate JS` state changes.

This change is ready for archive in the current closeout pass. Automated smoke now passes both in-worktree and from a fresh npm install, and human visual acceptance for the native tray/WebView path was already confirmed earlier in this thread.

## Trace

| Intent / spec point | Implementation evidence | Verdict |
| ------------------- | ----------------------- | ------- |
| Idle-stop is broker-owned | `BrokerOptions` resolves `idle_timeout`; macOS and Unix broker loops own the timer behavior. | Pass |
| No core/process coupling | `opentray-core` was not modified for process timers; TS client still closes only its connection. | Pass |
| Protocol event casing | Rust `TrayEvent` now uses camelCase for enum fields; `@opentray/spec` validates `event.itemId`. | Pass |
| Snake-case rejection | `parseServerFrame` now validates concrete `TrayEvent` shapes instead of accepting arbitrary event records. | Pass |
| Demo quit clarity | Menu label is `Quit Demo`; routed item id `99` prints `quit item routed; closing demo connection`. | Pass by protocol/test; native click still needs human confirmation. |
| WebView command coverage | The daemon demo imports the ext-webview facade and exposes show, navigate, postMessage, evaluate, and hide commands. | Pass |
| Native WebView runtime | macOS daemon composition loads `@opentray/ext-webview` through `NativeWebviewLoader` and sends runtime commands through `EventLoopProxy`. | Pass |
| Core boundary | `wry` is only added to `opentray-bin`; `opentray-core` still depends only on contracts and trait objects. | Pass |
| Runtime event feedback | The daemon sends actual WebView runtime events such as `shown`, `navigated`, `message`, `evaluated`, and `hidden` back to the client. | Pass |
| Daemon health | `health` / `daemon-health` frames are additive protocol frames, and `opentray daemon health` prints pid, endpoint, protocol/package metadata, session count, and session metadata. | Pass |
| Health does not mutate lifecycle | Health uses `inspectDaemon` and `connectLocalBroker({ autoStart: false })`; absent daemon reports not running. | Pass |
| Visible WebView message/evaluate feedback | Demo HTML and default runtime HTML expose `message-status` and `eval-status` targets; evaluate can create a visible fallback panel if the current page lacks the target. | Pass |

## Verification Evidence

- `cargo test -p opentray-spec -p opentray-core -p opentray-bin` passed.
- `pnpm --filter @opentray/spec test` passed.
- `pnpm --filter opentray typecheck` passed.
- `pnpm --filter opentray test` passed.
- `pnpm --filter @opentray/ext-webview test` passed.
- `pnpm --filter @opentray/ext-webview example:webview` passed.
- `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=500 OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1200 pnpm --filter opentray example:daemon-tray` passed and printed `{"type":"shown"}`.
- `OPENTRAY_HOME=/tmp/opentray-health-smoke.KeSG1m pnpm --filter opentray cli -- daemon health` passed and reported `opentray daemon not running`.
- `OPENTRAY_HOME=/tmp/opentray-health-smoke.KeSG1m OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0 pnpm --filter opentray cli -- daemon start` passed.
- `OPENTRAY_HOME=/tmp/opentray-health-smoke.KeSG1m pnpm --filter opentray cli -- daemon health` passed and printed pid, endpoint, package/protocol metadata, `sessions: 1`, and `leaseId=lease-1`.
- `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=500 OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1800 pnpm --filter opentray example:daemon-tray` passed and printed `shown`, `message`, `evaluated`, `navigated`, and `hidden` events.
- After waiting 1 second, `pnpm --filter opentray cli -- daemon stop` reported `opentray daemon not running`, confirming idle self-release.
- `cargo fmt --check` passed.
- `git diff --check` passed.
- `bun run openspec:vision -- validate fix-daemon-idle-and-menu-quit` passed.
- `bun run openspec:vision -- check fix-daemon-idle-and-menu-quit` passed.
- `pnpm run build` passed.
- `pnpm run verify` passed.

## Residual Risks

- Automated tests cannot click the macOS status menu. User confirmation is still required for the `Quit Demo` click path.
- Automated smoke can prove the native WebView commands completed, but a human still needs to visually confirm the window appears and the message/evaluate areas mutate on screen.
- The 30s default is a product default, not a protocol compatibility law. It can be tuned before release if it feels too aggressive or too slow.

## Human Acceptance

Run:

```bash
pnpm --filter opentray example:daemon-tray
```

Click `Quit Demo`.

Expected:

- Terminal prints `menu click: Quit Demo`.
- Terminal prints `quit item routed; closing demo connection`.
- The example process exits.
- After roughly 30 seconds with no connected clients, the daemon exits automatically.

Optional WebView command check:

- Open the `WebView Commands` submenu.
- Click `Show HTML` and confirm a native window appears.
- Click `Post Message` and confirm the `postMessage` card changes.
- Click `Evaluate JS` and confirm the `evaluate JS` card changes.
- Click `Navigate` and `Hide`.
- Terminal prints `webview command: ...` and `broker -> client {"type":"ext-event",...}` with `shown`, `navigated`, `message`, `evaluated`, and `hidden` events.

Daemon health check:

```bash
pnpm --filter opentray cli -- daemon health
```

Expected:

- If the daemon is absent, it prints `opentray daemon not running` and does not start one.
- If the daemon is present, it prints pid, endpoint, package/protocol metadata, session count, and session records.
