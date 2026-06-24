# Intent Document — Collapse Shared Surface and Pin Broker to Caller

## Problem

When third-party software uses OpenTray, the task manager shows only the name
`opentray`, not the host software. An operator trying to kill a misbehaving
process cannot tell which application owns the tray, so they are likely to kill
the wrong thing or avoid OpenTray entirely.

Two facts combine to make this acute:

1. The broker daemon is `detached: true` + `child.unref()` and persists in the
   background after the caller exits (see `packages/cli/src/daemon/lifecycle.ts`).
2. The process name visible in Activity Monitor / Task Manager / `ps` is the
   executable file name `opentray`, which carries no caller identity.

## Root Cause and Why the Obvious Fix Is Insufficient

The obvious fix is "change the binary name." That is insufficient because the
shared-surface model makes the name **logically unresolvable**: one broker
serves N callers, so a single process name cannot honestly name any one caller.
The caller-pinning problem and the shared-surface collapse are therefore **one
decision, not two**. Keeping shared surface while trying to pin a name is a
contradiction; the change does them in the correct order — collapse first, then
pin.

## Strategic Decision (User-Confirmed)

This change confirms two user decisions captured during planning:

- **Collapse shared surface (hard break).** Remove the multi-session space
  aggregation path entirely. Each broker serves exactly one caller session. The
  kernel stops owning cross-session aggregation. Project is at `0.x` alpha;
  breaking is acceptable but must be enumerated.
- **Dedicated broker process carrying caller identity.** Do NOT adopt the
  `lib-[platform]-[arch]` FFI/embedding model. The broker remains a separate
  executable spawned per caller, and its visible process name carries the
  caller label.

## Why FFI / lib Embedding Is Rejected

The `lib-[platform]-[arch]` path was considered and rejected in this change:

- It would duplicate every platform atom into a second distribution family
  (`bin-*` and `lib-*`), violating the "distribution atoms only" monorepo law
  for platform binary packages.
- Cross-language FFI (Rust panic across the FFI boundary is UB; each host
  language needs its own `libloading` glue) is disproportionate cost for what is
  fundamentally a process-naming problem.
- macOS only permits one `NSApplication` / `NSStatusItem` owner per process; an
  embedded broker can conflict with a host that is itself a GUI app.
- A dedicated per-caller broker process achieves the same "task manager shows
  the real owner" outcome without any of the above.

The FFI model is documented as a Rejected Path, not re-litigated.

## Trade-Off (Stated Honestly)

Removing shared surface removes the one feature that distinguished OpenTray from
"just another tray-icon library": N CLIs aggregating onto one status item.
Post-change, each caller occupies its own status item slot. This is accepted.
The win is a kernel that no longer owns aggregation/projection complexity it
could not justify, plus an honest, unambiguous process identity.

## Survey of Current State

| Artifact | What it does today | Fate under this change |
| -------- | ------------------ | ---------------------- |
| `packages/spec/src/index.ts` `createBrokerEndpointIdentity({ packageVersion })` | Endpoint = `opentray-<pkgver>-p<protover>.sock`, keyed only by version → all callers of a version share one socket/broker. | Add caller component; per-caller socket. |
| `packages/cli/src/daemon/paths.ts` `resolveDaemonPaths` | Builds `endpoint`, `pidFile`, `readyFile` from version-only identity. | Carry caller component through. |
| `packages/cli/src/daemon/lifecycle.ts` `spawnBroker` | `spawn(execPath, args, { detached:true, env:{OPENTRAY_DAEMON_*} })` + `child.unref()`. | Inject caller label; control process title / argv0. |
| `crates/opentray-bin` (Rust broker) | Owns idle timeout, session map, health. | Drop multi-session aggregation; honor idle-after-single-session. |
| `crates/opentray-core/src/kernel.rs` | `trays: BTreeMap<(space_id, tray_id), TrayState{lease_id}>`; `sync_surface` rebuilds projection across sessions. | Collapse to single-session ownership. |
| `openspec/specs/kernel-runtime` "Kernel SHALL aggregate tray contributions through space projections" | Defines the shared-surface aggregation law. | Removed (hard break). |
| `openspec/specs/broker-daemon` idle-timeout / sessions requirements | Built around multi-session reuse. | Revised to single-session + caller identity. |

## Intent

### Surface Intent

Make an OpenTray-backed process identifiable to its real owner in the host
operating system's task manager, so an operator can target it without confusion.

### Underlying Drive

The user wants OpenTray to stop doing work the kernel shouldn't own (shared
surface aggregation) and to stop hiding behind a generic process name that
invites mis-kills. The request is for a smaller, more honest core.

### Final Visible Effect

When a host application uses OpenTray, the broker process appears in the task
manager with a name derived from the caller (for example
`opentray · myapp`), every caller gets its own broker and socket, and the kernel
no longer carries multi-session aggregation logic.

## Platform Diagnosis

- Current platform laws: `Surface`/`Space` is the broker-owned desktop
  aggregation boundary; `Tray` is client-owned; `Lease`/`Session` is the
  lifecycle contract. This change retires the aggregation part of `Surface`.
- Does this fit as a regular atom: no — it is a kernel/daemon law change.
- Does this require law upgrade: yes. It rewrites the `Surface`/aggregation law
  in `kernel-runtime` and the daemon reuse model in `broker-daemon`.
- Breaking update stance: hard break in alpha. The multi-session projection
  requirement is removed, not deprecated.
- User confirmations still required: the per-platform process-naming primitive
  (argv0 rename vs. copy/symlink of the executable) is an implementation
  detail confirmed during apply, not a planning gate.

## Reverse-Inferred Design

### Interaction / Visual Story

A developer runs their CLI built on OpenTray. The task manager lists a process
named after their application context, not `opentray`. Killing that process
kills only that application's tray. A second, unrelated OpenTray-based process
appears under its own name and is unaffected.

### Interface Shape

The SDK gains an optional caller label concept:

- `new Client({ label })` (explicit, highest priority)
- else `npm_package_name` / `process.env.npm_lifecycle_event`
- else basename of `process.argv[1]` (fallback)

The label flows into the broker endpoint identity so that two callers of the
same OpenTray version no longer collide on one socket.

### Data Shape

Durable facts: the caller label and the OpenTray protocol/package version.
Projections: the OS-visible process name and the per-caller socket path. The
label must not be confused with the tray's `spaceId`; it is a transport/process
identity, not a menu identity.

### Architecture Shape

- `@opentray/spec`: endpoint identity gains a normalized caller component.
- `packages/cli` daemon layer: spawn carries the caller label and sets the
  visible process name via the platform's primary mechanism (argv0 on Linux;
  executable rename/copy on macOS/Windows where Activity Manager / Task Manager
  reflect the binary name).
- `crates/opentray-bin`: the broker pins to one caller session. The idle timeout
  still applies, now meaning "exit when the single caller disconnects."
- `crates/opentray-core`: ownership collapses from
  `(session, spaceId, trayId)` to a single session's trays; the projection step
  becomes a pass-through of that one session's trays.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Process-naming primitive per platform | macOS/Windows reflect binary file name; Linux reflects argv0. The mechanism differs. | argv0 on Linux; copy/rename of the broker binary to a caller-labeled name on macOS/Windows. |
| Label sanitization rules | Caller labels become filesystem/socket components and process names. | Strict allow-list (`[a-z0-9-]`), length-capped, fallback to `opentray` when empty/unsafe. |

## Intent-Driven Plan

- [ ] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should the per-caller broker still respect an idle timeout, or stay alive for the caller's full lifetime by default? | A pinned broker could reasonably be tied 1:1 to caller lifetime. | Keep idle timeout semantics, now scoped to the single caller session, for consistency and easy operator override. |
| Should the caller label be exposed in daemon-health output? | Helps debugging but adds a field. | Yes, expose `callerLabel` in health; it is already a transport-level fact. |
| Should the broker reject a second caller attempting the same socket? | With per-caller sockets this should be impossible, but the failure mode must be defined. | Reject with a typed protocol error; never silently share. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `lib-[platform]-[arch]` FFI embedding | Duplicates platform atoms, adds cross-language FFI cost, risks UB across the panic boundary, conflicts with macOS single-`NSApplication` ownership. A dedicated process achieves the same identity outcome cheaply. |
| Rename the broker to a fixed non-`opentray` name (e.g. `opentray-broker`) | Solves nothing: the name still carries no caller identity, so mis-kill risk is unchanged. |
| Keep shared surface but rotate which caller "owns" the visible name | Logically incoherent; the visible owner of a shared broker is undefined. |
| Soft-deprecate the projection requirement instead of removing it | Leaves dead kernel complexity during alpha with no consumer; contradicts the hard-break decision. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: a host process spawned via OpenTray shows a
  caller-derived name in the task manager; a second concurrent caller gets its
  own broker and socket and is unaffected by the first being killed; and the
  kernel no longer contains multi-session space aggregation code or spec.
