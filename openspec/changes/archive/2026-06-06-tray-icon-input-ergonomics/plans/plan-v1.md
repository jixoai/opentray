# Intent Document

## Current Round

- Round: 1
- Status: research-plan
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

> # Issue: `TrayOptions.icon` is required but there's no helper to create one
>
> ## Severity: Medium (friction)
>
> ## Problem
>
> ```ts
> interface TrayOptions {
>   trayId?: TrayId;
>   title?: string;
>   icon: Icon;  // ← REQUIRED, no default
>   menu?: Menu;
> }
> ```
>
> `Icon` requires raw RGBA pixel data:
>
> ```ts
> type Icon = {
>   type: "rgba";
>   data: Uint8Array | number[];
>   width: number;
>   height: number;
> } | { type: "encoded"; ... } | { type: "file"; ... };
> ```
>
> To create a tray icon, the consumer must:
> 1. Manually construct a pixel array
> 2. Or load an image file and convert it to RGBA bytes
> 3. There's no `createDefaultIcon()` or `iconFromPNG()` helper
>
> The troubleshooting reference mentions: "Current native icon support is `rgba`. Other typed icon shapes may still return unsupported." This means only `rgba` actually works.
>
> ## Impact
>
> - Every consumer writes their own pixel-level icon construction code (I had to write a 16x16 checkmark manually).
> - The smoke test has a `createVisibleIcon()` helper that constructs a 32x32 icon with ring/needle shapes — this should be a shared utility.
>
> ## Suggested Fix
>
> 1. **Make `icon` optional** with a reasonable default (a generic app icon or colored dot).
> 2. **Export a `createIcon()` helper** — at minimum, expose the smoke test's `createVisibleIcon()` as a utility.
> 3. **Support `{ type: "file", path }`** — let consumers point to a PNG/ICNS file path instead of constructing RGBA bytes. This is the most common use case for a desktop tray app.

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | Issue #003 | `TrayOptions.icon` is required, but there is no helper to create one; only `rgba` actually works today. | The public tray icon path is too low-level for ordinary users and needs an ergonomic boundary. |
| 2 | Issue #003 | The smoke path already has a `createVisibleIcon()` helper, but it lives inside example/smoke code. | The icon construction logic should be pulled behind a real SDK boundary instead of staying duplicated in demos. |
| 3 | User | “我觉得可以分两步，一个是 core 这边，提供基础的能力。然后再加一个 ext-icon-helper ... 还是 ext-icon-helper 目前没必要？” | The intended direction is to avoid a new public helper package unless the platform law truly needs it. |
| 4 | User | “那你是觉得需要用户手动接触 helper 吗？还是改进 TrayOptions.icon 的参数类型，提升易用性，底层由 helper 处理复杂性？” | The public contract should get easier to use; helper complexity should stay behind the SDK boundary. |
| 5 | User | `同意，开始撰写#003 对应的change` | Lock the scope to the tray icon ergonomics problem and proceed to OpenSpec. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/spec/src/index.ts` | `TrayOptions.icon` is currently required and typed as `Icon`, while `Icon` already includes `rgba`, `encoded`, and `file` variants. | The public shape is already protocol-shaped, so the real fix is about input ergonomics and normalization semantics, not adding a brand-new icon vocabulary. |
| `packages/cli/src/client.ts` | `SpaceHandle.createTray()` forwards the provided tray options directly into the broker request. | There is no normalization layer yet; the SDK currently leaks wire-shape assumptions into the consumer API. |
| `packages/cli/src/smoke/daemon-tray.ts` | The human smoke path defines a local `createVisibleIcon()` that manually constructs RGBA bytes. | The visible icon logic is duplicated in smoke code, which is exactly the friction the issue calls out. |
| `packages/cli/src/smoke/daemon-lynx.ts` | The Lynx smoke path also defines its own `createVisibleIcon()` helper. | The duplication is broader than one demo and should not remain a repeated local pattern. |
| `packages/cli/README.md` | The README states that current native icon support is `rgba` and that `encoded` and `file` are still unsupported at the native backend boundary. | The docs already tell the truth about the backend boundary, so the ergonomic fix must happen before the backend sees the asset. |
| `crates/opentray-backend-tray-icon/src/native.rs` | The native tray backend converts only RGBA into a native tray icon and returns typed unsupported errors for `encoded` and `file`. | Native runtime should stay honest; any ergonomic improvement must normalize or reject before the backend boundary. |
| `openspec/specs/backend-adapters/spec.md` | The backend law explicitly says `rgba` is the supported native tray icon path and other shapes are unsupported until decoding/file policy exists. | This change must not weaken the backend law or pretend the native runtime suddenly gained file decoding. |
| `openspec/specs/client-sdk/spec.md` | The public `opentray` package is the ordinary consumer entrypoint, and `createTray` is the top-level convenience path. | The ergonomic fix belongs in the client SDK surface ordinary users already touch. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Pending |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/backend-adapters/spec.md` | The native tray backend only truthfully supports `rgba` today. | Reuse as the hard backend law; do not fake native file support. |
| `openspec/specs/client-sdk/spec.md` | `opentray` is the public consumer entrypoint and already owns tray creation convenience. | Extend the client SDK boundary so tray icon ergonomics can be handled there. |
| `openspec/specs/monorepo-workspace/spec.md` | `packages/cli` is the final public npm package `opentray`. | Reuse the package boundary; ordinary consumers should not need a new public helper package. |
| `openspec/changes/archive/2026-06-01-implement-broker-transport-kernel-dispatch` | Human-visible tray examples already require a deliberate visible icon. | Extend the acceptance story, but stop duplicating the icon construction in smoke code. |
| `openspec/changes/archive/2026-06-04-add-tray-primary-event` | Tray smoke is already the visible acceptance surface for tray interactions. | Reuse the smoke path to prove the new icon input ergonomics end to end. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `helper` | An implementation detail the user does not want to touch directly in normal app code. | Keep the conversion step behind the SDK boundary. |
| `ext-icon-helper` | A separate helper package for icon conversion. | Rejected for now; it would create another public thing the user must learn. |
| `格式转换` | Convert file-backed or encoded icon sources into native-tray-safe RGBA. | Normalize before the backend sees the icon. |
| `提升易用性` | Ordinary users should be able to create a tray without learning pixel buffers first. | The consumer API should accept higher-level icon sources. |
| `原生能力支持的 icon` | An icon that starts as a file or encoded asset and must be converted before native tray use. | The SDK should absorb that complexity, not the user. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/src/smoke/daemon-tray.ts` | What the current human-visible tray path does for icon creation and tray launch. | Keep and migrate the icon construction logic behind a shared SDK-side path. |
| `packages/cli/src/smoke/daemon-lynx.ts` | Whether the Lynx smoke flow also depends on local visible icon construction. | Keep and migrate the duplicated visible icon logic. |
| `packages/cli/examples/tray-panel.ts` | Which tray-anchored example needs a visible icon to remain readable and stable. | Keep and update to the new icon input contract if it participates in acceptance. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `TrayOptions.icon` become optional, or should it stay required and simply accept higher-level icon sources? | This decides whether the fix is a convenience default or an ergonomics/normalization change. | Keep `icon` required for now; make the input easier to satisfy instead of hiding the visibility requirement. |
| Should icon decoding happen in the public SDK boundary or in a new package? | This decides whether ordinary users need to learn another helper package. | Keep the conversion in the existing `opentray` SDK boundary; do not introduce `ext-icon-helper`. |

## Intent

### Surface Intent

Make tray creation less brittle for ordinary consumers: they should be able to give `opentray` a practical icon source without manually building RGBA pixel buffers or learning a new helper package first.

### Underlying Drive

The product pressure is not “add another icon API.” The pressure is that the public tray path still leaks a low-level wire shape into everyday app code. The SDK should absorb the icon conversion concern the same way it already absorbs broker connection and tray creation convenience. The backend law stays honest and narrow: native tray rendering still only trusts RGBA.

### Final Visible Effect

A developer can create a tray with an ergonomic icon source and see a visible tray icon without writing their own pixel buffer code. The smoke/demo paths stop carrying ad hoc visible-icon generators as the ordinary recipe. If the icon source is missing or cannot be decoded, the SDK rejects with a typed, actionable error instead of silently pretending the tray icon was handled.

## Platform Diagnosis

- Current platform laws: the native tray backend is honest about supporting only `rgba`; `opentray` already owns the public `createTray` path; example code currently repeats visible-icon construction.
- Does this fit as a regular atom: yes. This is a client-SDK ergonomics atom, not a platform-law rewrite.
- Does this require law upgrade: only a narrow SDK-law upgrade. The backend law should stay unchanged, but the consumer-facing tray input boundary should gain normalization semantics.
- Breaking update stance: prefer additive public ergonomics. Do not create a new public helper package. Do not move file decoding into the native backend.
- User confirmations still required: none.

## Reverse-Inferred Design

### Interaction / Visual Story

The developer writes the normal `createTray()` call and supplies an icon source that makes sense for a desktop app, such as a file-backed asset. The tray appears with a visible icon. The developer does not have to hand-author RGBA pixels for ordinary app branding. The human-visible smoke/demo still proves the icon is nonblank, but the source of truth becomes the SDK contract rather than copy-pasted helper code.

### Interface Shape

- Public tray creation remains on the ordinary `opentray` path.
- `TrayOptions.icon` remains a required visible-tray input.
- The SDK boundary accepts ergonomic icon sources and normalizes them into the native-safe `rgba` asset shape before sending the broker request.
- The backend-facing wire asset remains unchanged and still speaks `rgba` as the only native tray icon shape.
- Ordinary users do not manually touch an `ext-icon-helper` package.

### Data Shape

- Public input shape: a tray icon source that may start from file-backed or generated content.
- Normalized wire shape: `Icon::Rgba` / `Icon["rgba"]` before transport reaches the backend boundary.
- Failure categories: missing source, decode failure, or unsupported input source that cannot be normalized.
- The smoke/demo helper becomes a reusable internal asset source rather than a user-facing requirement.

### Architecture Shape

- `packages/cli` owns the consumer-facing tray icon normalization boundary.
- `@opentray/spec` keeps the wire/protocol icon law honest and unchanged.
- `opentray-core` and `opentray-backend-tray-icon` remain backend-neutral/rgba-only and do not grow new file-decoding assumptions.
- No `ext-icon-helper` package is introduced.
- Smoke and example code may reuse the same shared internal visible-icon logic, but ordinary users should not have to learn a second helper surface.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | The user already chose the direction: improve the tray icon input ergonomics instead of making ordinary users touch a helper package. | Keep the conversion boundary inside the existing SDK atom. |

## Intent-Driven Plan

- [ ] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| none for the current change boundary | The user already rejected the separate-helper direction in favor of SDK-side ergonomics. | Proceed with the normalization-first design. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Make `icon` optional and hide the visibility law behind a default placeholder | That solves the friction by making tray visibility less explicit than this repo’s tray law wants. |
| Add a public `ext-icon-helper` package and tell users to wire it manually | It creates another public artifact that ordinary consumers must learn without removing the SDK friction. |
| Push file/encoded decoding into the native backend | That would mix asset conversion policy into the native backend boundary and weaken the backend’s honest `rgba` contract. |
| Keep requiring raw RGBA for ordinary tray creation | That preserves the exact friction the issue is about and keeps the smoke/demo helper duplicated. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: ordinary tray creation can accept an ergonomic icon source without manual RGBA construction, the SDK normalizes to the backend-safe `rgba` shape before transport, and the docs/examples no longer teach a raw-pixel-only path as the ordinary one.
