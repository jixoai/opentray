# Intent Document

## Current Round

- Round: 1
- Status: Ready for protocol endpoint identity implementation
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

> 大部分我都是认同你的决策的，我只想补充一个比较关键的，关于我们这个包开放给社区的人使用之后，有一些包可能会更新不及时，不及时导致他们依赖的版本是固定在历史的某个版本号，所以即便我们使用的守护进程，那么仍然要注意不同版本号之间守护进程的这个数据使用，也要确保隔离。简单说，版本的号不同就意味着二进制不同，就要意味着它们其实是不同的程序，那么就不可以共享。
> 理论上，我们可以内部去定一个协议版本号，如果协议版本号一致的话，那么他们就可以共享，这个是一个更理想化的方式，但至于谁去维护使用这个协议，这么多二进制之间谁来作为守护进程留存，那么都是一个值得商榷的问题。所以当前阶段，在我们还没有完全稳定的时候，最简单的做法就是直接把不同版本号的二进制当成不同的程序来使用。
>
> 我简单归纳一下，就是守护进程数据的有状态存储放 -/.opentray/X.Y.Z/ 在这个目录
>
> 未来等我们逐步稳定了，我们可以只锁大版本跟中版本，把小版本放开来共享，这也是可能的，但目前没法确保。所以直接隔离是最简单的，过度关注如何跨版本共享会让我们丢失我们的目标。

> 我突然想到一个问题，虽然说我们做了二进制守护进程的隔离，但是我们的管道是字符串拼接出来的，它并没有带版本号信息啊，所以我觉得我们仍然需要在内核去维护一个协议，然后去定义这个协议版本号，基于协议版本号去做握手，甚至协议版本号本身就应该包含在管道的命名中。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 不同版本号之间守护进程的数据使用要确保隔离。 | Broker state, locks, sockets, and caches must be scoped by version. |
| 1 | User | 版本号不同意味着二进制不同，是不同程序，不可以共享。 | Current-stage endpoint identity must include binary/package version, not only app id. |
| 1 | User | 守护进程有状态存储放 `~/.opentray/X.Y.Z/`。 | State root law is version-scoped and operator-visible. |
| 1 | User | 未来可以用协议版本或 major/minor 放宽共享，但当前阶段不做。 | Do not spend P0 complexity on cross-version reuse or daemon arbitration. |
| 2 | User | 管道字符串没有版本号信息。 | Endpoint naming must carry the same identity as state isolation. |
| 2 | User | 需要在内核维护协议并定义协议版本号。 | Protocol version becomes a first-class contract, not an incidental field. |
| 2 | User | 基于协议版本号做握手。 | Lease creation must be gated by protocol handshake. |
| 2 | User | 协议版本号本身应该包含在管道命名中。 | Pipe/socket names must include protocol version and current-stage package version. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-spec/src/protocol.rs` | Rust already exposes `PROTOCOL_VERSION = 1`, `ClientFrame::Init { version }`, and `ServerFrame::Ready { version }`. | The concept exists but is ambiguous and not yet endpoint identity. |
| `packages/spec/src/index.ts` | TypeScript protocol mirrors `init.version` and `ready.version`, but has no exported protocol constant or endpoint identity helpers. | SDK and broker cannot derive compatible pipe/socket names yet. |
| `crates/opentray-bin/src/main.rs` | Binary currently prints a ready frame and does not resolve socket/pipe names. | Endpoint identity can be introduced before full daemon transport implementation. |
| `openspec/specs/kernel-runtime/spec.md` | Kernel runtime already owns typed protocol frames and lease authority. | This change modifies the existing kernel-runtime law rather than creating a separate feature atom. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Will be prepared in this change. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending implementation. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Not requested yet. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/kernel-runtime/spec.md` | Kernel exposes typed protocol frames and lease cleanup. | Extend with protocol handshake and endpoint identity law. |
| `openspec/specs/backend-adapters/spec.md` | Backend selection belongs to binary composition, not core. | Reuse: OS-specific pipe/socket paths stay outside `opentray-core`. |
| `openspec/specs/extension-host/spec.md` | Extension instances are scoped and cannot mutate unrelated state. | Reuse: extension state will inherit version-scoped broker identity later. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `版本号不同就意味着二进制不同` | Package/binary version is a program identity boundary. | Do not connect different package versions to the same broker. |
| `不可以共享` | No cross-version state, daemon, socket, or lease sharing in the current stage. | Isolation beats premature compatibility. |
| `~/.opentray/X.Y.Z/` | Version-scoped state root. | Store runtime state under the current distribution version. |
| `管道是字符串拼接出来的` | Endpoint naming is currently too weak and collision-prone. | Pipe/socket names need a typed identity builder. |
| `基于协议版本号去做握手` | Handshake is a protocol gate before lease authority exists. | No lease until protocol compatibility is proven. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | This change can be proven through typed helpers and tests without throwaway demos. | Not needed. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `version` fields be renamed to `protocolVersion` now? | Ambiguous `version` can mean protocol, binary, or npm package version. | Yes. Break now while the protocol is still young. |
| Should endpoint names include both package version and protocol version? | Protocol-only naming would allow cross-package sharing, contradicting current-stage isolation. | Yes. Use both until protocol stability justifies relaxing the boundary. |

## Intent

### Surface Intent

第二阶段 broker 工作开始前，先把版本隔离和协议握手做成平台法则：不同包版本不共享守护进程状态，管道/socket 命名也必须包含版本身份，客户端和 broker 必须通过协议版本握手后才能建立 lease。

### Underlying Drive

The user is protecting community adoption from stale dependency graphs. Old packages will keep using old binaries. If endpoint identity is only a hand-written string, a new SDK can accidentally connect to an old broker or reuse stale state. That would collapse the lease and extension safety model even if the state directory is versioned.

### Final Visible Effect

An operator or future agent can inspect generated endpoint names and see the version boundary directly. A client using `opentray@0.1.0` targets a broker endpoint and state root for `0.1.0` and protocol `1`. A mismatched protocol handshake is rejected before lease creation. No code path silently scans or reuses brokers from another package version.

## Platform Diagnosis

- Current platform laws: `Surface`, `Tray`, and `Lease` are broker/kernel laws; backend and extension atoms are injected; typed protocol frames already exist.
- Does this fit as a regular atom: No. Endpoint identity is not an extension atom; it is a broker/kernel law.
- Does this require law upgrade: Yes. Protocol version and package version must become explicit identity axes for endpoint naming and handshake.
- Breaking update stance: Safe and recommended. The current public API is young and `version` is ambiguous.
- User confirmations still required: None for current stage; user explicitly chose package-version isolation and protocol-version handshake.

## Reverse-Inferred Design

### Interaction / Visual Story

1. A developer installs `opentray@X.Y.Z`.
2. The SDK computes an endpoint identity from package version `X.Y.Z` and `PROTOCOL_VERSION`.
3. The SDK connects only to that endpoint and sends `init { protocolVersion, clientVersion }`.
4. The broker responds `ready { protocolVersion, brokerVersion }` only if compatible.
5. Lease creation starts after handshake success.

### Interface Shape

- `@opentray/spec` and `opentray-spec` expose a single `PROTOCOL_VERSION`.
- Protocol frames use `protocolVersion`, not an ambiguous `version`.
- Endpoint identity helpers produce deterministic endpoint names from package/binary version plus protocol version.
- OS-specific pipe/socket resolution belongs to the SDK/binary composition layer, not `opentray-core`.

### Data Shape

- `packageVersion`: current distribution/binary package version, e.g. `0.1.0`.
- `protocolVersion`: wire protocol version, currently `1`.
- `endpointName`: deterministic name such as `opentray-0.1.0-p1`.
- `stateRoot`: `~/.opentray/<packageVersion>/`.
- `lease`: unavailable until the protocol handshake passes.

### Architecture Shape

Platform laws:

- Protocol version is a stable contract exported by spec packages.
- Endpoint identity is deterministic and typed, not ad-hoc string concatenation.
- Current-stage broker sharing key is package version plus protocol version.
- Future sharing relaxations must be explicit compatibility law changes.

Forbidden couplings:

- `opentray-core` must not know OS pipe path syntax.
- SDK must not scan other package-version directories for a compatible broker.
- Protocol handshake must not create a lease on mismatch.
- Endpoint helpers must not hide cross-version fallback behavior.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Future protocol sharing | It may become valid after protocol stability. | Out of scope; no sharing across package versions now. |
| Exact path root on non-Unix platforms | Windows named pipes are not filesystem paths. | State root remains version-scoped; pipe name carries package and protocol version. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement protocol and endpoint identity helpers.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should future patch versions share broker state when protocol is stable? | This affects endpoint identity migration. | No. Keep `X.Y.Z` isolated now. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Protocol-only endpoint name | It violates the current-stage rule that different package versions are different programs. |
| Package-version-only endpoint name | It cannot prevent incompatible protocol clients from connecting to the same stale endpoint. |
| Runtime scanning for compatible brokers | It creates daemon arbitration complexity before the protocol is stable. |

## Exit Conditions

- Default max review iterations: 1
- Issue recurrence threshold: 3
- Custom exit condition from intent: endpoint identity and handshake tests prove package version plus protocol version are visible before broker lease creation.
