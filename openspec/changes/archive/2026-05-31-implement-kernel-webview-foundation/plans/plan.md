# Intent Document

## Current Round

- Round: 1
- Status: Draft for architecture decision
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

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 现在要开始正式开发。 | Move from package/release scaffolding into product implementation. |
| 1 | User | 第一阶段完成基础内核。 | P0 must create real broker/kernel laws, not only npm package placeholders. |
| 1 | User | 第一阶段完成 webview 这部分扩展。 | Layer 1 extension architecture must land together with core extension loading contracts. |
| 1 | User | 内核部分已经有现成的 `tauri-apps/tray-icon`。 | Reuse `tray-icon` where it fits; do not rebuild macOS/Windows tray primitives from scratch. |
| 1 | User | 重点是我们的可扩展性的架构。 | The main design value is extension law, capability boundary, and backend/plugin orthogonality. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `SPEC.md` | Current law is `Surface` = broker-owned desktop entry, `Tray` = client contribution, `Lease` = cleanup authority, extensions = dynamic libraries attached to surfaces. | This is the baseline physics; first-stage implementation must not collapse into one process owning one icon. |
| `HANDOFF.md` | Prior ecosystem research selected Rust, `tray-icon` for macOS/Windows, `ksni` for Linux, and dynamic library extensions via C ABI. | Confirms the product direction and why Linux should not blindly use `tray-icon`. |
| `packages/*/package.json` | Workspace currently contains npm package shells only; no `src/`, Rust crates, or build scripts exist yet. | First implementation must introduce real project structure and testable contracts. |
| `tray-icon` README / Context7 | `tray-icon` supports Windows/macOS/Linux, but Linux requires GTK plus libappindicator/libayatana-appindicator. Events are global receivers or event handlers, menus use `muda`, and `rect()` is unsupported on Linux. | `tray-icon` is useful backend evidence, not a universal platform law. Linux would violate the zero-system-dependency target if we use it directly. |
| `tray-icon` source | `TrayIcon` exposes `set_icon`, `set_menu`, `set_tooltip`, `set_title`, `set_visible`, `show_menu`, `rect`, and platform native handles. | These APIs map cleanly to a `SurfaceBackend` adapter for macOS/Windows and to webview anchoring on supported platforms. |
| `ksni` crate metadata/source | `ksni` 0.3.4 provides StatusNotifierItem and DbusMenu in Rust with zbus and async/blocking APIs. | Linux should be a separate backend atom behind the same kernel law. |
| `cargo search` | Current crates include `tray-icon 0.24.0`, `wry 0.55.1`, `tao 0.35.3`, and `ksni 0.3.4`. | Gives current implementation candidates; exact versions should be locked during implementation. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Not yet committed. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending after user chooses architecture option. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Not requested. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/changes/initialize-monorepo-workspace` | Establishes package names and monorepo skeleton. | Reuse package identities; extend with real Rust/TS implementation. |
| `openspec/changes/configure-trusted-release-pipeline` | Release pipeline exists but npm trust mutation is externally blocked by npm auth. | Reuse release scripts; product implementation should not depend on publish completion. |
| `openspec/specs/vision-driven-openspec-workflow/spec.md` | Plans/specs/tasks/review are enforced as workflow artifacts. | Reuse workflow; commit specs before product code. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `正式的开发` | Start product implementation, not just release scaffolding. | Build real kernel and extension code. |
| `第一阶段` | A bounded P0 milestone with kernel plus webview extension foundation. | Not all future badge/island/platform APIs. |
| `基础内核` | Broker runtime laws: surface registry, tray leases, backend abstraction, protocol. | The minimum system that owns physical tray entries and client contributions. |
| `webview 这部分扩展` | Layer 1 rich popup extension atom. | WebView must attach through extension law, not become core. |
| `内核部分已经有现成的（tauri-apps/tray-icon）` | Reuse mature tray primitive instead of rebuilding OS tray integration. | Use `tray-icon` as a backend adapter where it fits. |
| `重点是我们的可扩展性的架构` | The decisive value is plugin/extension physics and orthogonal atoms. | Do not hardcode webview or future capabilities into core. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | Implementation has not started. | Add only if a backend event-loop spike is needed before hardening. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should Linux P0 use `ksni` rather than `tray-icon` despite the user's `tray-icon` shorthand? | `tray-icon` Linux path pulls GTK/libappindicator and lacks rect/click support; prior spec targets zero system deps via ksni. | Use `tray-icon` only for macOS/Windows, `ksni` for Linux. |
| Should webview be a dynamic library extension in P0, or is an in-process Rust module acceptable as a temporary stepping stone? | Dynamic library ABI is the durable law; in-process module is faster but risks extension coupling. | Define and test the extension host law now; implementation may start with an internal extension adapter only if the ABI boundary remains explicit. |
| Should we introduce Rust crates immediately in this change? | Current repo has no Rust workspace; kernel cannot be proven without Rust crates. | Yes: add `crates/opentray-spec`, `crates/opentray-core`, `crates/opentray-bin`, plus backend/extension crates as needed. |

## Intent

### Surface Intent

第一阶段要做出 OpenTray 的基础内核和 webview 扩展。内核 tray 原语可以复用 `tauri-apps/tray-icon`，但真正要完成的是可扩展性架构。

### Underlying Drive

The user is asking for platform physics, not a wrapper. OpenTray must become a broker that owns physical tray surfaces, accepts isolated tray contributions, and loads optional capabilities through stable extension contracts. The first milestone must make future extensions O(1) atoms rather than forcing every feature into core.

### Final Visible Effect

An operator can run a local broker, a Node client can create a surface/tray contribution through typed contracts, the broker can render a native tray surface through a backend adapter, and a webview capability can be loaded and commanded without core knowing webview internals. Even before full UI polish, logs/tests should prove that tray events route only to owning leases and extension commands stay scoped to `(surface_id, tray_id, ext)`.

## Platform Diagnosis

- Current platform laws: Surface/Tray/Lease/Extension are already written as spec laws, but not implemented.
- Does this fit as a regular atom: Partly. `webview` is a regular extension atom if the extension host law exists first.
- Does this require law upgrade: Yes. The repo must gain a concrete kernel/host law: backend adapters are atoms, extension host is a law, and webview is not allowed to import or own core internals.
- Breaking update stance: Safe. There is no production implementation yet; prefer correct crate/package boundaries over compatibility with placeholders.
- User confirmations still required: Confirm Linux `ksni` vs all-platform `tray-icon`; confirm dynamic library ABI strictness in P0 vs internal extension adapter as implementation stepping stone.

## Reverse-Inferred Design

### Interaction / Visual Story

1. Developer installs `opentray` and optionally `@opentray/ext-webview`.
2. Client code calls `createSurface({ appId, default: true })`.
3. Client code calls `createTray({ title, icon, menu })`.
4. Broker creates or updates one physical tray entry for the surface.
5. Client sends `webview.show(...)` through the extension facade.
6. Broker routes the extension command to the webview extension attached to the surface/tray.
7. Webview events return through `ext-event` to the owning lease only.

### Interface Shape

- Public TS packages:
  - `@opentray/spec`: protocol and schema types only.
  - `opentray`: client API, broker discovery/spawn, and typed handles.
  - `@opentray/ext-webview`: typed webview facade that emits `ext-command` frames; it must not depend on native backend packages.
- Rust crates:
  - `opentray-spec`: serde protocol, menu/icon/event models, extension ABI types.
  - `opentray-core`: surface registry, lease registry, aggregation, backend trait, extension host trait.
  - `opentray-bin`: CLI and transports.
  - `opentray-backend-tray-icon`: macOS/Windows adapter over `tray-icon`.
  - `opentray-backend-ksni`: Linux adapter over `ksni`.
  - `opentray-ext-webview`: extension implementation over `tao`/`wry` or platform-native webview primitives.

### Data Shape

- Durable identity:
  - `surface_id`: broker-issued stable surface id.
  - `tray_id`: contribution id scoped to surface and lease.
  - `lease_id`: connection authority.
  - `app_id`: metadata namespace, not authority.
- Runtime state:
  - `SurfaceState`: physical backend handle + aggregated tray projections + loaded extension instances.
  - `TrayLease`: owning lease + contribution options + current menu/icon/tooltip/webview state.
  - `ExtensionInstance`: extension name + surface scope + optional tray scope + command/event channel.
- Wire protocol:
  - Keep newline-delimited JSON-RPC for broker/client.
  - Use a stable C ABI for dynamically loaded extensions; command payload remains JSON to keep ABI small.

### Architecture Shape

Platform laws:

- Core owns identities, leases, aggregation, permission checks, and event routing.
- Backend atoms implement physical surface primitives; they never know about webview or package names.
- Extension atoms implement optional capabilities; they never mutate surface/tray state except through host callbacks.
- TS client atoms only publish declarations and commands; they do not assume OS backend behavior.

Forbidden couplings:

- `opentray-core` must not import `opentray-ext-webview`.
- `opentray-ext-webview` must not reach into `SurfaceRegistry` or backend concrete types.
- `@opentray/ext-webview` must not import platform binary packages.
- Linux backend must not be forced through `tray-icon` if that brings GTK/libappindicator into the core distribution target.
- No `if ext == "webview"` in core command handling; extension dispatch is keyed by registered extension capability.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Backend strategy | User named `tray-icon`, but prior spec chose `ksni` for Linux. | Option A: `tray-icon` for macOS/Windows and `ksni` for Linux. |
| Extension ABI strictness | Dynamic library ABI is correct but more work than an internal module. | Define ABI now; implementation can start with an in-process adapter only if it exercises the same host interface. |
| P0 scope | Full cross-platform webview polish is large. | P0 proves extension host + one platform smoke path + typed TS facade, then iterates. |

## Architecture Options

### Option A: Platform-law-first backend and extension host (recommended)

Upgrade the repo into a real kernel workspace. `tray-icon` is a backend atom for macOS/Windows. Linux gets a separate `ksni` backend atom. Webview is an extension atom behind an extension host interface and C ABI contract. The core sees only `Backend`, `ExtensionHost`, `ExtensionInstance`, and scoped JSON commands.

Why this is the first-principles solution:

- Preserves zero-system-dependency Linux target.
- Keeps future badge/island/platform APIs as O(1) extensions.
- Makes `tray-icon` replaceable without changing TS client API or extension API.
- Prevents webview from becoming a privileged special case in core.

Expected law changes:

- Add Rust workspace and crate boundaries.
- Add `SurfaceBackend` trait with capability reporting.
- Add `ExtensionHost` trait and C ABI contract.
- Add TS spec schemas and client handles.
- Add BDD tests for lease-scoped event routing and extension dispatch.

### Option B: Single `tray-icon` wrapper plus hardcoded webview path (technical debt)

Use `tray-icon` directly for all platforms and implement webview as direct core code. This is faster for a demo but has clear corrosion:

- Linux inherits GTK/libappindicator and `rect()` limitations.
- Webview becomes a core special case.
- Future extensions require edits in core dispatch.
- Backend limitations leak into TS public API.
- Replacing Linux backend later becomes a breaking refactor.

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Get user decision on Option A vs Option B.
- [ ] 3. Write specs from the chosen architecture.
- [ ] 4. Write BDD tasks from specs.
- [ ] 5. Commit OpenSpec artifacts before product code.
- [ ] 6. Implement kernel crates and TS spec/client atoms.
- [ ] 7. Implement webview extension host/facade foundation.
- [ ] 8. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Do we proceed with Option A? | This determines whether Linux uses `ksni` and whether extension ABI is a first-class law now. | Yes, Option A. |
| Is one-platform webview smoke acceptable for P0 if the extension law is cross-platform? | Full macOS/Windows/Linux webview polish may exceed first-stage kernel work. | Accept one native smoke path plus cross-platform contracts/tests. |
| Should trusted-publish commits be pushed before product implementation starts? | Current branch is ahead of origin by two release-pipeline commits. | Product work can continue locally, but release pipeline should be pushed before relying on CI. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Treat `tray-icon` as the OpenTray kernel | It is a physical tray primitive, not a Surface/Tray/Lease/Extension platform. |
| Use `tray-icon` Linux backend by default | It requires GTK/libappindicator and lacks the Linux capabilities prior research selected `ksni` for. |
| Put webview commands directly in core protocol handlers | Violates extension orthogonality and guarantees future feature-specific branching. |
| Skip OpenSpec and start coding crates immediately | The key decision is architectural; writing code first risks hardening the wrong law. |

## Exit Conditions

- Default max review iterations: 5
- Issue recurrence threshold: 2
- Custom exit condition from intent: first-stage kernel and webview extension foundation are implemented, verified locally, and retain strict atom boundaries: core owns laws, backends own OS tray primitives, webview owns only its extension capability.
