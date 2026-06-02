# Intent Document

## Current Round

- Round: 2
- Status: Revised after visual feedback: daemon WebView menu actions must open a real native window, not only print preview recorder traffic
- Previous plan backup: `plans/plan-v2.md`

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 刚才你给我的demo，我还有一些疑问：
> 1. daemon既然能自动启动，那么会自动stop吗？就是没有进程连接过来使用的话，过一段时间就自动释放掉
> 2. 这demo我点击Quick Example没反应。

> 1. 点击Quick Demo还是没有退出，打印是：
> ```
> broker -> client {"type":"event","event":{"type":"menuClick","surface_id":"surface-1","tray_id":"daemon-status","item_id":99}}
> menu click: undefined
> ```
>
> 2. Demo 需要尽可能包含尽可能都多的功能，我们第一阶段的功能还包含ext-webview这个扩展包。所以也应该包含webview的一些特性。

> 我点击webview相关的测试，没有窗口出来。终端打印：
> ```
> menu click: WebView: Show HTML
> webview command: show
> broker -> client {"type":"ext-event","surfaceId":"surface-1","trayId":"daemon-status","ext":"webview","data":{"command":{"fallbackRect":{"height":1,"width":1,"x":0,"y":0},"height":260,"html":"<main><h1>OpenTray WebView</h1><p>Daemon demo command.</p></main>","type":"show","width":420},"type":"recorded"}}
> ```

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Daemon auto-start raises the expectation that unused daemon processes auto-stop after a period with no connected users. | Broker lifecycle needs an idle shutdown law, not only manual `daemon stop`. |
| 1 | User | Clicking `Quick Example` in the demo has no visible reaction. | The human-visible demo must have a reliable menu event / quit path and should make the quit action unambiguous. |
| 2 | User | The event printed from the daemon uses `surface_id`, `tray_id`, and `item_id`, so the TS demo prints `menu click: undefined`. | Rust protocol serialization violates the TS camelCase contract for nested `TrayEvent`; fix protocol, not the demo branch. |
| 2 | User | The demo should include as many first-stage capabilities as possible, including `@opentray/ext-webview`. | The daemon demo must include the ext-webview package command surface and broker extension event path where available. |
| 3 | User | Clicking WebView test items only prints a recorded event and does not open a window. | Preview recorder traffic is insufficient for human visual acceptance; the daemon demo's WebView path must create a real native WebView window. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `openspec/specs/broker-daemon/spec.md` | Broker daemon owns local transport sessions, Rust broker composition, backend event ingress, and macOS background behavior. | Idle-stop belongs in the broker process, not the TS client or core kernel. |
| `openspec/specs/client-sdk/spec.md` | Local TS SDK auto-starts the same-version daemon and examples should not require manual `daemon start`. | Auto-start and idle-stop must compose into normal developer UX. |
| `crates/opentray-bin/src/main.rs` | macOS broker owns the winit event loop and transport sessions; menu events route from `tray-icon` into `BrokerKernel`. | The quit bug must be inspected at native menu ingress, route lookup, session egress, and TS event handling. |
| `crates/opentray-bin/src/unix_transport.rs` | Unix broker listener already emits Connected/Frame/Disconnected events and writes ready metadata. | Idle detection can observe session count in the broker composition layer. |
| `packages/cli/examples/daemon-tray.ts` | Demo shuts down only after receiving a routed menu click with item id `99`; there is no fallback or diagnostic if no menu event arrives. | The example needs a clearer quit item and a reliable reaction path. |
| `crates/opentray-backend-tray-icon/src/projection.rs` | Menu ids are stable strings built from surface/tray/item ids and route back into `TrayEvent::MenuClick`. | Route table is the correct law; do not special-case `Quit Example` in the backend. |
| `crates/opentray-spec/src/model.rs` | `TrayEvent` uses serde `rename_all = "camelCase"` for variant names but not variant fields, causing snake_case nested event fields. | Add enum field casing and regression tests so Rust and TS protocol shapes match. |
| `packages/ext-webview/src/index.ts` | `attachWebview(tray)` emits `webview` extension commands: show, hide, navigate, evaluate, postMessage. | The daemon demo can exercise the official extension package facade through the public tray handle. |
| `crates/opentray-core/src/extension.rs` | `RecordingExtension` exists and returns extension events for command envelopes. | Use it only behind an explicit preview recorder loader path for demo-grade extension command acknowledgement; do not let normal dynamic extension paths silently fake success. |
| `crates/opentray-backend-tray-icon/examples/visual_webview.rs` | A real WebView window can be created with `wry::WebViewBuilder` and a native window, but it currently lives outside the daemon path. | Reuse the proven visual behavior in the daemon composition layer, not in `opentray-core`. |
| `crates/opentray-bin/src/main.rs` | macOS daemon already owns the winit event loop and can receive custom `UserEvent`s. | Native WebView commands can cross from `ExtensionInstance` into the main event loop through `EventLoopProxy` without making core depend on `wry`. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/broker-daemon/spec.md` | Broker daemon is version-scoped, owns transport sessions, and runs background-only on macOS. | Extend with idle shutdown after no sessions. |
| `openspec/specs/client-sdk/spec.md` | Local broker client auto-starts the same-version daemon by default. | Extend docs and example behavior so auto-start does not imply forever-running orphan processes. |
| `openspec/specs/backend-adapters/spec.md` | Native backend owns honest icon/menu capability boundaries. | Reuse route table; do not add backend-specific quit behavior. |
| `openspec/changes/archive/2026-06-01-implement-broker-transport-kernel-dispatch` | Mainline daemon tray path was archived after user visual acceptance. | Build a narrow follow-up, not a rewrite of broker dispatch. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `daemon既然能自动启动` | Auto-start creates lifecycle responsibility. | If SDK starts it, SDK/platform must not leave useless background processes forever. |
| `自动stop` | Idle shutdown after no clients. | Broker exits itself when unused, then next SDK call can start it again. |
| `没有进程连接过来使用` | No active client sessions / leases. | Session count is the idle signal. |
| `点击Quick Example没反应` | Human clicked the demo quit/menu item and saw no output or exit. | The demo's menu event path is not trustworthy enough. |
| `item_id` | Actual protocol bug exposed by the printed event. | Rust nested event fields must serialize as `itemId` to match TS types. |
| `包含webview的一些特性` | Demo should cover the official WebView extension package command surface. | Include `show`, `navigate`, `postMessage`, and `hide` commands through `@opentray/ext-webview`. |
| `没有窗口出来` | WebView feature is not visually acceptable when it only records protocol traffic. | `Show HTML` must open a real native WebView window in the daemon demo. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | Automated smoke cannot click native menu; use code-level routing tests and a human-visible command for final proof. | Add focused tests where possible; rely on user visual confirmation for native click. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| What default idle timeout should shipped daemon use? | Too short may churn; too long feels like orphan process. | Use 30 seconds by default, configurable with `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS`, and `0` disables idle exit for debugging. |
| Should daemon demo show a real WebView window now? | User visual feedback confirms the preview recorder is not enough. | Yes. Implement a daemon-composition native WebView extension using `ExtensionLoader + EventLoopProxy`, keeping `wry` out of `opentray-core`. |

## Intent

### Surface Intent

Make the auto-started daemon feel owned by the platform: if no client process is using it, it should release itself after a short idle window. Make the demo's quit/menu click visibly respond instead of feeling dead. Ensure the protocol event shape is truly camelCase end-to-end and the demo covers first-stage ext-webview command features with a real native WebView window for `show`.

### Underlying Drive

Auto-start changes trust boundaries. Once OpenTray starts background processes on behalf of community packages, it must also define when those processes stop. The menu bug shows that visual acceptance is not only "icon appears"; every advertised action must produce a human-observable effect.

### Final Visible Effect

The developer can run `pnpm --filter opentray example:daemon-tray`, click the quit item, and see `itemId`-based event output plus process exit. The same demo can click `WebView Commands -> Show HTML` and see a real native WebView window created by the daemon runtime. `Navigate`, `Post Message`, `Evaluate JS`, and `Hide` operate on that window through the `@opentray/ext-webview` facade. After all clients disconnect, the daemon exits itself after the configured idle timeout. Running the example again starts a fresh daemon automatically.

## Platform Diagnosis

- Current platform laws: broker daemon owns transport sessions and backend event ingress; TS SDK owns local broker connection; leases close on disconnect.
- Does this fit as a regular atom: Mostly yes. Idle-stop is a broker lifecycle law extension; quit reliability is a demo/client behavior fix over the existing menu route law.
- Does this require law upgrade: Yes for daemon lifecycle, protocol casing, and native extension runtime delivery. GUI extensions that need the main event loop must be loaded by the daemon composition layer and send runtime commands via `EventLoopProxy`; `opentray-core` remains only the protocol/registry law.
- Breaking update stance: Non-breaking. Add configurable timeout and clearer example behavior.
- User confirmations still required: Idle timeout default can be adjusted later; use 30 seconds now to keep momentum.

## Reverse-Inferred Design

### Interaction / Visual Story

1. Developer runs the demo.
2. SDK starts daemon if needed and connects.
3. Tray appears with a visible menu.
4. Every enabled menu click prints a label and routed event with camelCase fields.
5. WebView menu actions call `attachWebview(tray).show/navigate/postMessage/evaluate/hide`.
6. `Show HTML` creates or focuses a native WebView window with visible HTML content.
7. `Navigate`, `Post Message`, `Evaluate JS`, and `Hide` operate on the native WebView runtime and print extension command/event output.
8. Clicking the quit item closes the client connection and exits the demo.
9. Broker sees no sessions and starts an idle timer.
10. If no new client connects before timeout, broker exits and runtime files become stale.
11. Next SDK call sees the old pid is dead, cleans current-version runtime files, and starts a fresh broker.

### Interface Shape

- Environment:
  - `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS`: optional daemon idle timeout.
  - `0` disables idle exit for debugging/operator sessions.
- Example:
  - Use a clearer quit item label.
  - Print routed event labels for every enabled click.
  - Import `@opentray/ext-webview` and expose WebView command actions in the tray menu.
  - `Show HTML` must open a real native WebView window in the daemon path on macOS.
  - Keep manual `daemon stop` as cleanup, not a normal requirement.

### Data Shape

- `session_count`: number of active transport sessions in the broker composition.
- `idle_generation`: monotonic token that cancels stale idle timers when new sessions connect.
- `idle_timeout`: broker-local duration; not part of protocol compatibility.
- `item_id`: durable menu action id used for route lookup and TS example behavior.
- `itemId`: protocol wire casing for menu events consumed by TS. Snake-case event fields are invalid on the wire.
- `webview command`: typed extension command emitted by the official `@opentray/ext-webview` package.
- `native webview command`: daemon-internal runtime command sent from the WebView extension instance to the main event loop.

### Architecture Shape

Platform laws:

- Idle-stop belongs in `opentray-bin` broker composition because it owns process/event-loop lifecycle.
- `opentray-core` remains unaware of daemon process timers.
- Menu click semantics remain route-table based; no backend hardcoded quit special case.
- Client examples can attach product behavior to routed `MenuClick` events.
- WebView demo coverage uses extension command protocol through a daemon-composition native extension; it does not import `wry` into core or make the tray backend own WebView windows.

Forbidden couplings:

- Do not make `tray-icon` know about `Quit Demo`.
- Do not put process timers into `opentray-core`.
- Do not make TS client kill arbitrary daemon processes on close.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Native click works on the user's macOS menu bar | Automated tests cannot click the system tray menu. | Provide a smoke command and ask the user to click the quit item. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Commit OpenSpec artifacts before product-code work starts.
- [ ] 5. Implement broker idle-stop, camelCase event protocol, clearer reliable demo quit behavior, and ext-webview command coverage with a real daemon-owned native WebView runtime.
- [ ] 6. Verify with targeted tests, build, smoke, and OpenSpec gates.
- [ ] 7. Self-review and wait for human click confirmation before archive.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should idle-stop default be 30s, 60s, or only dev mode? | It changes perceived daemon availability and resource usage. | 30s default, configurable, `0` disables. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Stop daemon from TS client immediately on `connection.close()` | Would kill daemon while other clients may still own sessions and violates broker ownership. |
| Hardcode `Quit Demo` behavior in native backend | Breaks atom orthogonality; menu events must route through kernel/session law. |
| Require developers to manually restart daemon after source changes | Contradicts the user's auto-start UX requirement. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: Same menu click or idle lifecycle issue recurs twice after a fix.
- Custom exit condition from intent: daemon exits after idle with no sessions; demo quit item prints event output and exits; next demo run auto-starts the daemon again.
- Updated exit condition: event frames use `itemId`/`surfaceId`/`trayId`; demo includes ext-webview command actions, `Show HTML` opens a real native WebView window, and WebView commands print their broker response/event path.
