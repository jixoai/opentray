# Intent Document

## Current Round

- Round: 1
- Status: Updated after spelling correction and ready for implementation
- Previous plan backup: `plans/plan-v1.md`

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

> 继续使用openspec vision推进，有什么需要讨论的话题吗？

> 基本同意，不过命令应用`opentray deamon start|stop|restart`

> 我刚才拼写错了，你可以开始了

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 继续使用 OpenSpec vision 推进。 | Next broker work must start from OpenSpec artifacts, not direct coding. |
| 1 | User | 询问是否有需要讨论的话题。 | Surface only real decision gates; use defaults for implementation details. |
| 2 | User | 基本同意 broker daemon plan。 | Proceed with local broker daemon as next module. |
| 2 | User | 命令应用 `opentray deamon start\|stop\|restart`。 | CLI lifecycle command shape must be captured; spelling is treated as alias unless user insists it is canonical. |
| 3 | User | 刚才拼写错了。 | `deamon` is not a requirement; canonical command spelling is `daemon`. |
| 3 | User | 可以开始了。 | Proceed from OpenSpec artifacts into implementation. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `openspec/specs/kernel-runtime/spec.md` | Versioned endpoint identity is archived into the main spec. | Broker daemon must reuse package/protocol endpoint identity instead of inventing pipe strings. |
| `packages/cli/package.json` | `opentray` currently has no `bin` entry. | This change must introduce a Node-facing command surface. |
| `packages/cli/src/index.ts` | SDK currently has protocol-only handles and endpoint helpers, but no daemon lifecycle API. | Daemon start/stop/restart must be new atoms on top of existing protocol contracts. |
| `crates/opentray-bin/src/main.rs` | Rust binary currently prints a ready frame and composes the default backend, but does not run a transport loop. | Broker daemon implementation must turn the binary into a long-running process. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Pending user acceptance. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/kernel-runtime/spec.md` | Surface/Tray/Lease, protocol frames, and versioned endpoint identity are kernel laws. | Reuse for daemon identity and handshake. |
| `openspec/specs/backend-adapters/spec.md` | Concrete backend selection belongs to `opentray-bin` composition. | Reuse when broker starts the platform backend. |
| `openspec/specs/extension-host/spec.md` | Extension instances are scoped and host-mediated. | Defer dynamic extension loading unless needed for the daemon acceptance path. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `守护进程` | Long-running local broker process. | The broker that owns surfaces and client leases. |
| `管道` | Local IPC endpoint. | Unix socket or Windows named pipe. |
| `opentray deamon start\|stop\|restart` | User typo while naming daemon lifecycle commands. | Correct to `opentray daemon start\|stop\|restart`. |
| `视觉能验收` | Human-visible tray/WebView proof matters. | Broker acceptance must include a visible tray path later in the change. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | Daemon implementation should start from tests and CLI command skeleton, not a throwaway spike. | Not needed now. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should SDK auto-spawn the daemon in this same change? | Auto-spawn adds process supervision and binary resolution complexity. | This change should provide explicit lifecycle first; SDK auto-spawn can follow after the daemon is trustworthy. |

## Intent

### Surface Intent

Continue with OpenSpec vision and implement the local broker daemon lifecycle. The command surface should expose `opentray daemon start`, `stop`, and `restart`.

### Underlying Drive

OpenTray must move from examples and protocol helpers to a real local process that owns surfaces, leases, and backend composition. The daemon must be version-isolated, explicit to operate, and inspectable before SDK auto-spawn hides lifecycle behavior.

### Final Visible Effect

An operator can run `opentray daemon start`, see a same-version broker process become available on the versioned endpoint, check that a second start does not create a competing daemon, run `opentray daemon stop`, and see the process release the endpoint. `restart` performs stop then start through the same version-scoped identity.

## Platform Diagnosis

- Current platform laws: kernel owns `Surface`, `Tray`, and `Lease`; endpoint identity includes package and protocol versions; backend selection belongs to binary composition.
- Does this fit as a regular atom: Partly. The CLI command is an atom, but daemon lifecycle is a platform runtime law.
- Does this require law upgrade: Yes. Broker process ownership, pid/lock files, endpoint binding, and lifecycle commands must become explicit.
- Breaking update stance: Safe in `0.x`; prefer a clean command surface now.
- User confirmations still required: None before implementation; the user corrected the spelling and approved starting.

## Reverse-Inferred Design

### Interaction / Visual Story

1. User runs `opentray daemon start`.
2. CLI resolves the current package version and protocol version.
3. CLI creates or reuses `~/.opentray/<version>/runtime/`.
4. CLI starts the broker if no healthy same-version broker is running.
5. Broker binds the versioned endpoint and writes pid/lock metadata.
6. User runs `opentray daemon stop` or `restart` to control only this version's broker.

### Interface Shape

- Public CLI:
  - `opentray daemon start`
  - `opentray daemon stop`
  - `opentray daemon restart`
- Internal lifecycle API:
  - resolve endpoint identity,
  - check health,
  - start broker process,
  - stop same-version broker,
  - clean stale pid/lock only inside the version directory.

### Data Shape

- `stateRoot`: `~/.opentray/<packageVersion>/`.
- `runtimeDir`: `~/.opentray/<packageVersion>/runtime/`.
- `pidFile`: runtime-owned process id evidence.
- `lockFile`: single-writer guard for concurrent starts.
- `endpoint`: generated from package version plus protocol version.

### Architecture Shape

Platform laws:

- Lifecycle commands operate only on the current package version.
- Start is idempotent: healthy existing broker wins over duplicate spawn.
- Stop is scoped: it must not stop another version's broker.
- Stale pid/lock cleanup is allowed only inside the current version's runtime directory.

Forbidden couplings:

- Do not put process supervision into `opentray-core`.
- Do not let the SDK scan other version directories.
- Do not make local TCP the default transport in this change.
- Do not require WebView or extension host implementation to prove daemon lifecycle.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Auto-spawn | Hidden lifecycle could obscure debugging. | Explicit CLI first, auto-spawn later. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement daemon lifecycle command surface and runtime identity.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should daemon logs be exposed in P0? | Useful for human debugging but can expand scope. | Write logs under version dir; no rich log viewer yet. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `opentray deamon` command path | User confirmed it was a typo; do not implement it as a requirement. |
| SDK auto-spawn before explicit commands | It hides process lifecycle before the daemon is trustworthy. |
| Shared daemon across versions | It violates the current version-isolation law. |

## Exit Conditions

- Default max review iterations: 1
- Issue recurrence threshold: 3
- Custom exit condition from intent: explicit daemon lifecycle commands operate only on the current version endpoint and are covered by BDD tests.
