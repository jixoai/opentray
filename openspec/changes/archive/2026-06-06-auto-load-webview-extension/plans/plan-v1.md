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

> 你的目前责任是编写openspec changes。你先把#001 的change写了。写完我们再讨论#003

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | Issue #001 | `attachWebview()` silently fails without prior `load-ext` - SDK should auto-load or throw actionable error | The public webview facade must stop forcing consumers to hand-author `load-ext` for the standard happy path. |
| 2 | User | `先把#001 的change写了，写完我们再讨论#003` | Keep this change tightly scoped to the webview facade loading problem; do not broaden into icon work yet. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-webview/src/index.ts` | `attachWebview(tray)` is a synchronous thin wrapper over `tray.commandExtension("webview", ...)`; it does not load the extension. | Confirms the current facade still leaks the manual `load-ext` trap. |
| `packages/cli/examples/webview-control.ts` | The example manually sends `load-ext` before calling `attachWebview(tray)`. | Shows the current developer path still depends on hidden setup. |
| `packages/cli/examples/tray-panel.ts` | The tray-panel example also manually sends `load-ext` before the WebView facade is used. | Confirms the problem is not isolated to one sample. |
| `packages/spec/src/index.ts` | `ClientRequestFrame` already includes `load-ext`, and `ServerFrame` already includes structured `error` and `ext-event` frames. | The protocol has enough vocabulary to support an internal auto-load handshake and a clear load failure. |
| `openspec/specs/extension-host/spec.md` | Generic `load-ext` is already a first-class extension-host law, with structured failure for missing libraries. | The desired behavior belongs at the extension facade layer, not in core. |
| `openspec/specs/webview-extension/spec.md` | The current webview spec already treats the extension as a platform-neutral facade and requires truthful missing-library errors. | This change extends the facade law; it does not need a platform-law rewrite. |
| `packages/ext-webview/README.md` | The package README already explains dynamic discovery and mentions `load-ext` in the native package flow. | Documentation can be tightened to match the new consumer-facing flow. |

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
| `openspec/specs/webview-extension/spec.md` | WebView is an extension atom; missing libraries must fail honestly; the facade is platform-neutral. | Extend. Add automatic load-on-first-use and a typed actionable failure path. |
| `openspec/specs/extension-host/spec.md` | `load-ext` is already a generic extension-host command with structured errors. | Reuse. The facade should call into this law internally. |
| `openspec/specs/client-sdk/spec.md` | Ordinary consumers should start from the public SDK, not raw transport wiring. | Reuse the spirit; keep the change out of core transport. |
| `openspec/changes/archive/2026-06-05-rebuild-webview-cross-platform-window-contract-and-runtime` | The webview runtime split already assumes a platform-neutral facade and a generic host boundary. | Extend, not replace. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `silent fail` / `silently fails` | The user sees a command path that looks valid but dies because a prerequisite was never made explicit. | The facade must either self-bootstrap or fail with a clear fix. |
| `load-ext` | The generic extension-host registration step for `webview`. | The facade should hide this from ordinary consumers. |
| `actionable error` | The failure must tell the user what to install, load, or change next. | No vague `extension not found` dead end. |
| `attachWebview(tray)` | The ordinary entrypoint the user expects to work directly. | The normal path should feel self-contained. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/webview-control.ts` | What hidden prerequisite the current sample still makes the developer satisfy manually. | Keep as evidence until the facade change lands. |
| `packages/cli/examples/tray-panel.ts` | Whether the tray-panel path still requires manual `load-ext`. | Keep as evidence until the facade change lands. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none for this first fix pass | The user already gave the scope and wants only #001 now. | Proceed with the auto-load + actionable-error design and keep #003 out of scope. |

## Intent

### Surface Intent

Make the standard WebView facade path behave like a real consumer API: `attachWebview(tray)` should be the usable entrypoint, not a trap that first requires an undocumented manual `load-ext` step.

### Underlying Drive

The product problem is not the protocol itself. The problem is that the public facade still leaks a hidden registration ritual into the ordinary happy path, so a developer can follow the surfaced API and still fail before their first visible WebView command. The change should move that ritual behind the facade and keep the failure mode explicit when automatic loading is impossible.

### Final Visible Effect

A developer can write `attachWebview(tray).show(...)` without first hand-authoring `load-ext`. The facade will either load `webview` internally and proceed, or reject with an error that clearly says the WebView extension could not be loaded and why. Ordinary docs no longer teach a hidden prerequisite as part of the main path.

## Platform Diagnosis

- Current platform laws: extension loading is already a generic host capability; the webview package is a platform-neutral facade; the broker and core remain generic.
- Does this fit as a regular atom: Yes.
- Does this require law upgrade: No core or broker law upgrade. The change belongs inside the webview extension atom and its official guidance.
- Breaking update stance: Prefer additive behavior at the facade boundary. Do not expose raw connection objects to ordinary consumers just to solve this.
- User confirmations still required: none.

## Reverse-Inferred Design

### Interaction / Visual Story

The consumer starts with the documented WebView facade. The first visible WebView command works without a manual registration ritual. If the platform library is missing, the consumer gets a direct load failure that names the WebView extension and points at the missing runtime or package discovery problem.

### Interface Shape

- `attachWebview(tray)` stays the ordinary entrypoint.
- `show`, `hide`, `destroy`, `setContent`, `navigate`, `evaluate`, and `postMessage` stay the public verbs.
- The facade lazily ensures the `webview` extension is loaded before the first command for that tray scope.
- The facade surfaces a structured, actionable load error when automatic loading cannot complete.

### Data Shape

- Extension registration state is per webview scope, not an exposed global singleton.
- The load handshake is keyed by extension name and owning space/tray context.
- Failure carries structured context about the missing library, resolution failure, or host rejection.

### Architecture Shape

- `@opentray/ext-webview` owns the automatic load handshake.
- `opentray-core` and the broker continue to know only the generic `load-ext` law.
- Ordinary consumers do not receive a raw transport object just to satisfy webview setup.
- No `if ext == "webview"` branch should be introduced into core or broker layers.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | The user asked for the first fix only and the design choice is constrained by current API shape. | Keep the facade synchronous and do lazy auto-load on first command. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| none for this first fix pass | The design can stay narrow and still satisfy the user requirement. | Auto-load on first command, not a manual preflight step. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep requiring consumers to call `load-ext` manually | It preserves the silent failure trap the issue is calling out. |
| Expose the raw broker connection on ordinary handles | It leaks low-level transport into the normal API and expands the public surface for the wrong reason. |
| Make `attachWebview` itself a new async factory just to perform preload | It is a larger breaking shift than this issue needs; lazy load on first command keeps the facade shape stable. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: a developer can use the standard WebView facade without a manual `load-ext` pre-step, and any load failure clearly identifies the missing webview extension or package resolution problem.
