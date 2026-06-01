# Intent Document

## Current Round

- Round: 1
- Status: Drafted for broker transport, kernel dispatch, and human-visible daemon tray apply
- Previous plan backup: none

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

> 我们现在要开始正式的开发，第一阶段是完成基础内核 与 webview 这部分扩展。
> 因为内核部分已经有现成的（tauri-apps/tray-icon），重点是我们的可扩展性的架构

> 我作为人类， 重点在于视觉能力，我要看到的是 真实视觉能验收的东西

> 大部分我都是认同你的决策的，我只想补充一个比较关键的，关于我们这个包开放给社区的人使用之后，有一些包可能会更新不及时，不及时导致他们依赖的版本是固定在历史的某个版本号，所以即便我们使用的守护进程，那么仍然要注意不同版本号之间守护进程的这个数据使用，也要确保隔离。简单说，版本的号不同就意味着二进制不同，就要意味着它们其实是不同的程序，那么就不可以共享。
> 理论上，我们可以内部去定一个协议版本号，如果协议版本号一致的话，那么他们就可以共享，这个是一个更理想化的方式，但至于谁去维护使用这个协议，这么多二进制之间谁来作为守护进程留存，那么都是一个值得商榷的问题。所以当前阶段，在我们还没有完全稳定的时候，最简单的做法就是直接把不同版本号的二进制当成不同的程序来使用。
>
> 我简单归纳一下，就是守护进程数据的有状态存储放 -/.opentray/X.Y.Z/ 在这个目录
>
> 未来等我们逐步稳定了，我们可以只锁大版本跟中版本，把小版本放开来共享，这也是可能的，但目前没法确保。所以直接隔离是最简单的，过度关注如何跨版本共享会让我们丢失我们的目标。

> 我突然想到一个问题，虽然说我们做了二进制守护进程的隔离，但是我们的管道是字符串拼接出来的，它并没有带版本号信息啊，所以我觉得我们仍然需要在内核去维护一个协议，然后去定义这个协议版本号，基于协议版本号去做握手，甚至协议版本号本身就应该包含在管道的命名中。

> 继续使用openspec vision推进，有什么需要讨论的话题吗？

> 基本同意，不过命令应用`opentray deamon start|stop|restart`

> 我刚才拼写错了，你可以开始了

> 我需要你一次性全部列出来，以及我最后如何确定和验收

> 下一步，回到我们的主线任务

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 第一阶段要完成基础内核与 WebView 扩展。 | Mainline work must move from release scaffolding into real runtime behavior. |
| 1 | User | 内核可复用 `tauri-apps/tray-icon`。 | `tray-icon` is a backend atom for supported platforms, not a reason to hardcode tray behavior in core. |
| 1 | User | 重点是可扩展性架构。 | The implementation must preserve extension atoms and backend atoms behind platform laws. |
| 2 | User | 人类验收重点是真实视觉能力。 | Final acceptance must include a real visible tray command, not only unit tests. |
| 3 | User | 不同 npm package version / binary version means different programs and must not share daemon state in the current stage. | Runtime state stays under `~/.opentray/<packageVersion>/`; no cross-version daemon reuse. |
| 4 | User | Pipe/socket identity must carry protocol version and the broker must define a protocol version handshake. | Transport endpoint and handshake are part of the kernel/runtime law, not incidental string glue. |
| 5 | User | Continue using OpenSpec vision. | Write research-plan/specs/tasks before product code. |
| 6 | User | Correct daemon command spelling after typo. | The canonical lifecycle command is `opentray daemon start\|stop\|restart`. |
| 7 | User | Wants a complete task list and final acceptance method. | Tasks must include explicit human-visible acceptance commands and nonvisual verification gates. |
| 8 | User | Return to the mainline task. | Resume broker transport -> kernel dispatch -> visible tray path, not npm bootstrap side quests. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `openspec/specs/kernel-runtime/spec.md` | Kernel laws already define Surface, Tray, Lease, typed protocol frames, protocolVersion handshake, and versioned endpoint identity. | This change should implement and tighten those laws rather than inventing a separate transport model. |
| `openspec/specs/broker-daemon/spec.md` | CLI lifecycle already exists as `opentray daemon start|stop|restart`, version-scoped and single-writer. | The next layer must reuse lifecycle identity and replace the placeholder broker loop with real broker behavior. |
| `openspec/specs/backend-adapters/spec.md` | Backend selection belongs to `opentray-bin` or equivalent composition; core must use `SurfaceBackend`. | Real tray rendering must be composed in the binary, not imported into `opentray-core` or TS extension packages. |
| `packages/cli/src/daemon/broker-runner.ts` | Current daemon binds the versioned endpoint but only writes a `ready` frame and does not parse client frames. | This is the current gap: endpoint exists, broker semantics do not. |
| `packages/cli/src/index.ts` | The TS client only has `OpenTrayTransport.send()` and returns placeholder `pending:*` identities. | The SDK cannot honestly claim broker-created surfaces/trays until it can receive correlated server frames. |
| `packages/spec/src/index.ts` and `crates/opentray-spec/src/protocol.rs` | Protocol types exist in TS/Rust, but command frames lack request correlation and errors only carry `message`. | Real async clients need request ids or equivalent sequencing law; otherwise events can race command responses. |
| `crates/opentray-core/src/kernel.rs` | Rust `Kernel` already creates surfaces, creates/mutates trays, syncs projections, closes leases, dispatches extension commands, and routes menu events by owner lease. | Broker transport can delegate domain behavior to core instead of duplicating policy. |
| `crates/opentray-backend-tray-icon/src/native.rs` | Native tray runtime applies compiled projections but must run under a caller-owned OS event loop on macOS/Windows. | `opentray-bin` must own the native event loop if the daemon is responsible for visible tray state. |
| `crates/opentray-bin/src/main.rs` | The binary only prints one `ready` frame and instantiates the target backend name. | The binary must become the broker composition layer for transport, kernel, backend, and native event ingress. |
| `skills/opentray/references/visual-acceptance.md` | Human-visible work requires real tray or window commands, not only tests. | Acceptance must include a command that creates a visible tray through the daemon path. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending in this change. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending after artifact commit. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending after implementation. |
| Normal archive | Commit containing `openspec archive <change>` result | Do not archive until user accepts visual behavior. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed now. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/kernel-runtime/spec.md` | Surface/Tray/Lease, typed frames, handshake, endpoint version identity. | Reuse and modify to add request correlation and lease acceptance semantics. |
| `openspec/specs/broker-daemon/spec.md` | Version-scoped daemon lifecycle and current-version runtime metadata. | Extend from placeholder endpoint ownership to real broker transport sessions. |
| `openspec/specs/backend-adapters/spec.md` | Backend selection is binary-owned; adapters consume `SurfaceProjection`. | Reuse for daemon projection path and native event ingress. |
| `openspec/specs/extension-host/spec.md` | Extension dispatch is scoped by surface/tray/ext and must not get core privileges. | Preserve; WebView implementation can continue after broker transport is real. |
| `openspec/changes/archive/2026-05-31-implement-local-broker-daemon` | Node CLI lifecycle starts a minimal Node broker process. | Break/replace the broker process implementation if needed, while keeping the public command surface. |
| `openspec/changes/archive/2026-05-31-implement-kernel-webview-foundation` | Established the first-stage crate/package split and visual examples. | Reuse crate boundaries and visual proof style. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `主线任务` | Broker-owned desktop status platform path. | Runtime/kernel/transport/visual tray, not release-ops side quests. |
| `基础内核` | Rust kernel plus broker composition that owns surfaces, trays, leases, projection, and event routing. | The physical tray lifecycle must flow through kernel law. |
| `真实视觉能验收` | Human must see real native tray/window behavior. | Provide `cargo run` / `opentray daemon start` plus client command that creates a visible tray. |
| `守护进程` | Long-running local broker process. | Owns endpoint, client leases, kernel, and backend state. |
| `管道` | Local IPC endpoint. | Unix socket or Windows named pipe carrying package/protocol identity. |
| `协议版本号` | Compatibility boundary independent from package version. | Used in endpoint naming and init handshake. |
| `不同版本号的二进制当成不同的程序` | Current-stage no daemon sharing across package versions. | State root and endpoint identity include package version. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | Existing examples already prove backend visual rendering; this change needs a daemon-path example instead of a throwaway spike. | Add `example:daemon-tray` as a real human example during implementation. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should this change add request correlation to the protocol now? | Without it, TS clients can only fake identities or rely on fragile response ordering. | Yes. This is a platform law upgrade and `0.x` can break placeholders. |
| Should Node CLI keep owning the daemon process, or should it supervise `opentray-bin`? | The visible backend and kernel are Rust-side; keeping Node as broker would duplicate kernel law or require FFI. | Node CLI remains lifecycle supervisor; Rust `opentray-bin` becomes the actual broker. |
| Should Windows named-pipe transport be fully implemented in this change? | Current local validation is macOS; full Windows pipe support may require a transport crate and CI matrix. | Preserve the endpoint law and type contract; implement Unix socket path first if cross-platform pipe support threatens the visual acceptance goal. |

## Intent

### Surface Intent

回到第一阶段主线：把 `opentray daemon start` 从“能启动一个占位 endpoint”推进到“真实 broker 能接收 TS 客户端、完成协议握手、创建 lease、把 client frame dispatch 到 Rust `Kernel`、通过真实 backend 创建人类可见的 tray，并把 native tray/menu event 回传给拥有它的 client”。

### Underlying Drive

The user is pushing OpenTray from package skeleton and examples into a desktop status platform. The broker must become the stable physical boundary: multiple community packages may be installed at fixed historical versions, so package version, protocol version, state root, endpoint, handshake, lease, projection, and backend composition must be coherent. WebView and future extensions depend on this broker law; otherwise every extension will grow private daemon glue.

### Final Visible Effect

The operator can run:

```bash
opentray daemon start
pnpm --filter opentray example:daemon-tray
```

Expected visible result: a real system tray item appears through the daemon path. Opening the menu and clicking an item prints an event in the TS client output. Stopping the daemon removes the daemon-owned tray state for the current version only.

Automated smoke can use:

```bash
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:daemon-tray
```

## Platform Diagnosis

- Current platform laws: `Surface` is broker-owned physical desktop entry; `Tray` is client-owned contribution; `Lease` is client authority; `SurfaceProjection` is the only backend input; endpoint identity includes package version and protocol version; extension commands go through a registry rather than feature branches.
- Does this fit as a regular atom: No. The visual example is an atom, but transport/session/request correlation/broker composition are platform laws.
- Does this require law upgrade: Yes. The placeholder protocol needs real session semantics: init-before-lease, request correlation, structured errors, disconnect cleanup, backend event egress to the owning lease.
- Breaking update stance: Prefer breaking the placeholder TS transport shape now. `pending:*` identities and send-only transports are not acceptable platform laws.
- User confirmations still required: None before implementation. Windows named-pipe completeness may become a scoped follow-up if it blocks macOS visible acceptance.

## Reverse-Inferred Design

### Interaction / Visual Story

1. Operator starts the daemon for the current `opentray` package version.
2. CLI resolves the versioned endpoint under `~/.opentray/<packageVersion>/` and starts the Rust broker binary if needed.
3. TS example connects to that endpoint and sends `init { protocolVersion, clientVersion }`.
4. Broker rejects incompatible protocol before creating a lease; compatible clients get a broker lease.
5. TS example requests a surface and a tray with title, icon, tooltip, and menu.
6. Rust broker dispatches requests into `opentray-core::Kernel`.
7. Kernel derives `SurfaceProjection`; `opentray-bin` applies it through the selected backend.
8. Human sees a real tray item.
9. Human clicks a menu item; native backend maps it to `TrayEvent`.
10. Kernel routes the event by `(leaseId, surfaceId, trayId, itemId)` and the broker writes it only to the owning client.

### Interface Shape

- Public CLI remains:
  - `opentray daemon start`
  - `opentray daemon stop`
  - `opentray daemon restart`
- Public TS SDK gains a real local broker client:
  - Connects to the versioned endpoint.
  - Sends `init` before command frames.
  - Awaits correlated command responses instead of returning `pending:*`.
  - Surfaces async broker events to the application.
- Rust binary becomes the broker composition layer:
  - Owns local transport listener.
  - Owns native event loop on platforms that need it.
  - Owns `Kernel<SelectedBackend>`.
  - Does not move backend or process supervision into `opentray-core`.

### Data Shape

- `packageVersion`: current npm/binary package version; selects state root and prevents cross-version daemon sharing.
- `protocolVersion`: compatibility version; included in endpoint naming and handshake.
- `leaseId`: broker-issued connection authority after compatible init.
- `requestId`: client-issued command correlation id for command responses and structured errors.
- `SurfaceRef`: broker-issued identity returned from `create-surface`.
- `TrayId`: broker-confirmed contribution identity returned from `create-tray`.
- `SurfaceProjection`: kernel-derived physical state and the only backend sync shape.
- `ClientSession`: transport connection state with handshake status, lease id, request writer, and disconnect cleanup.

### Architecture Shape

Platform laws:

- Handshake must happen before lease creation.
- No command except `init` may mutate kernel state before a lease exists.
- Every command response or structured error must be attributable to a request.
- Client disconnect closes only its lease-owned trays and extension state.
- Backend event ingress returns to kernel first, then egresses only to the owning client.
- Node CLI lifecycle may supervise the broker, but Rust `opentray-bin` owns kernel/backend composition.

Forbidden couplings:

- Do not import `tray-icon`, `ksni`, `wry`, npm platform packages, or process supervision into `opentray-core`.
- Do not keep TS client `pending:*` identities once broker responses exist.
- Do not route native menu events by menu id alone.
- Do not let `@opentray/ext-webview` or other extension packages start their own hidden daemon path.
- Do not scan or reuse another package version's daemon state.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Windows named-pipe parity in this exact change | It may enlarge scope beyond the current macOS visual acceptance environment. | Preserve contract and endpoint identity; land Unix/macOS daemon visual path first if needed. |
| Protocol request-id breaking change | Existing examples are placeholder-only and can be migrated in one repo change. | Apply the breaking cleanup now. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Commit OpenSpec artifacts before product code.
- [ ] 5. Implement Rust broker transport, kernel dispatch, backend projection, and event egress.
- [ ] 6. Implement TS local broker client and daemon tray example.
- [ ] 7. Run automated verification and human-visible smoke commands.
- [ ] 8. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| How much Windows transport should land before first visual acceptance? | Named pipes are part of the endpoint law, but current human validation is on macOS. | Do not let Windows parity block macOS visible daemon tray proof. |
| Should the daemon auto-start from `createClient()` in this change? | Auto-start hides lifecycle while the broker contract is still stabilizing. | Keep explicit daemon lifecycle plus explicit `connect()` first; auto-start follows after visual proof. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep Node `broker-runner.ts` as the real broker and mirror Rust kernel behavior in TS. | Duplicates platform law and prevents real backend composition through `opentray-bin`. |
| Keep `OpenTrayTransport.send()` as the only client contract. | Cannot return broker-created identities or safely handle interleaved native events. |
| Rely on response ordering without request ids. | Fragile once event frames and extension frames can arrive during commands. |
| Return fake `pending:*` identities from the public client. | Makes visual and extension flows depend on client-side fiction rather than broker authority. |
| Share daemon state across package versions because protocol version matches. | User explicitly chose current-stage package version isolation to keep the goal focused. |

## Exit Conditions

- Default max review iterations: 1
- Issue recurrence threshold: 3
- Custom exit condition from intent: `opentray daemon start` plus `pnpm --filter opentray example:daemon-tray` creates a real visible tray through the daemon path, and a menu click is routed back to the owning TS client output.
