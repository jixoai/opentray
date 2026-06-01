# Self Review

## Verdict

The automated part of the follow-up intent is satisfied. The daemon now owns idle shutdown, Rust event frames serialize nested tray event fields as camelCase, TypeScript rejects snake_case tray event payloads, and the daemon tray example includes a `WebView Commands` submenu that exercises `@opentray/ext-webview` through a real macOS native WebView runtime.

Do not archive yet. The remaining gate is human-visible: run the example without auto-exit, click `WebView Commands -> Show HTML`, confirm a native window appears, then click `Quit Demo` and confirm the native menu event reaches the TS client and exits the demo.

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

## Verification Evidence

- `cargo test -p opentray-spec -p opentray-core -p opentray-bin` passed.
- `pnpm --filter @opentray/spec test` passed.
- `pnpm --filter opentray typecheck` passed.
- `pnpm --filter opentray test` passed.
- `pnpm --filter @opentray/ext-webview test` passed.
- `pnpm --filter @opentray/ext-webview example:webview` passed.
- `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=500 OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1200 pnpm --filter opentray example:daemon-tray` passed and printed `{"type":"shown"}`.
- `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=500 OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1200 pnpm --filter opentray example:daemon-tray` passed and printed `shown`, `navigated`, `message`, `evaluated`, and `hidden` events.
- After waiting 1 second, `pnpm --filter opentray cli -- daemon stop` reported `opentray daemon not running`, confirming idle self-release.
- `cargo fmt --check` passed.
- `git diff --check` passed.
- `bun run openspec:vision -- validate fix-daemon-idle-and-menu-quit` passed.
- `bun run openspec:vision -- check fix-daemon-idle-and-menu-quit` passed.
- `pnpm run build` passed.
- `pnpm run verify` passed.

## Residual Risks

- Automated tests cannot click the macOS status menu. User confirmation is still required for the `Quit Demo` click path.
- Automated smoke can prove the native WebView command completed, but a human still needs to visually confirm the window appears on screen.
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
- Click `Navigate`, `Post Message`, `Evaluate JS`, and `Hide`.
- Terminal prints `webview command: ...` and `broker -> client {"type":"ext-event",...}` with `shown`, `navigated`, `message`, `evaluated`, and `hidden` events.
