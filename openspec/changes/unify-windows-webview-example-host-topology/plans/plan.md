# Intent Document

## Current Round

- Round: 1
- Status: intent locked from the user's direct comparison request
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

> webview-control可以和win32-bug使用完全一样的底层路径吗？我在webview-control上仍然看到了一些老问题。
> 另外win32-bug请新增托盘功能，和 webview-control 的托盘保持一致：Show|Hide Example、Quit Demo

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `webview-control` should use the same lower-level host path as the visually cleaner `win32-bug`. | Split comparator host topology from probe instrumentation, then enable the topology in both examples. |
| 1 | User | `win32-bug` must expose the same retained tray actions as `webview-control`: Show/Hide Example and Quit Demo. | Preserve the shared menu helper and add runtime proof for visibility-driven labels. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Both examples already share one window class and one parent-before-child cold-start procedure. | The remaining difference is policy input, not a second implementation. |
| Windows probe branches | `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE` currently couples host topology to paint/material counters and probe commands. | `webview-control` cannot safely enable the old switch because it would also acquire probe title mutation and experimental commands. |
| Windows topology helpers | Probe mode changes initial raw geometry, extended-window styles, non-client policy, frame refresh copy policy, frameless native frame, full-client calculation, and soft resize. | These are the actual reasons the two examples still present different native shells. |
| `packages/cli/examples/webview-control.ts` | The example enables AppWindow overlay by default. | Overlay is an unavoidable post-WebView stage; exact parity means a shared base plus an explicit overlay delta. |
| `packages/cli/examples/win32-bug.ts` | The example already uses `createExamplePrimaryMenu`, `syncExamplePrimaryMenu`, primary-item toggling, and `Quit Demo`. | The requested tray structure exists, but it needs explicit lifecycle verification and operator-facing evidence. |
| User working tree | The user has uncommitted visual adjustments in the webview-control route, titlebar, and CSS. | Implementation must not overwrite those first-party changes. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | pending |
| Normal archive | Commit containing `openspec archive <change>` result | pending user visual acceptance |
| Abnormal handoff | Commit containing `HANDOFF.md` evidence before returning to user discussion | not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/windows-material-host-surface/spec.md` | Defines parent-before-child cold start, probe-native state, comparator frameless shell, and single-flight polling. | Extend by separating comparator topology from probe instrumentation. |
| archived `2026-07-16-align-windows-webview-host-with-native-material-probe` | Establishes the accepted comparator shell and user visual evidence. | Reuse the accepted topology; do not reopen paint-mode conclusions. |
| `AGENTS.md` retained-WebView tray law | Menu label is projected from operational native visibility. | Reuse without inventing a second tray state model. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `完全一样的底层路径` | shared native comparator host topology | The same HWND/DWM/style/geometry/frameless policy before optional overlay work. |
| `仍然看到了一些老问题` | production-example visual regression signal | Treat remaining differences as real topology variables, not page-only styling. |
| `Show|Hide Example、Quit Demo` | retained tray control contract | One primary action whose label follows native visibility plus one terminal quit action. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/webview-control.ts` | Does the rich control surface remain stable on the accepted comparator base? | Keep and opt into comparator topology. |
| `packages/cli/examples/win32-bug.ts` | Does the probe retain exact native-shell evidence and a working tray lifecycle? | Keep and extend its smoke. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Must overlay be removed to claim byte-for-byte path identity? | AppWindow overlay necessarily adds a post-WebView native stage absent from win32-bug. | No. Share the complete base path; document overlay as the sole intentional delta. `--no-overlay` is the exact A/B mode. |

## Intent

### Surface Intent

Make `webview-control` inherit the native host behavior that made `win32-bug` visually cleaner, and make `win32-bug` expose a trustworthy retained tray menu with Show/Hide and Quit.

### Underlying Drive

The comparator cannot remain a special island. Its accepted native shell must be reusable without also enabling diagnostic paint state, title counters, or probe commands. Otherwise a visually successful experiment cannot validate the richer production example.

### Final Visible Effect

On Windows, both examples start from the same hidden-HWND, DWM material, native geometry, extended-style, native-frame, and resize topology. With `webview-control --no-overlay`, the host path is the direct comparator path. With overlay enabled, the only additional native stage is AppWindow initialization after WebView2 attachment. `win32-bug` shows a tray menu containing `Hide Example`, a separator, and `Quit Demo` while visible; after hiding, the primary item reads `Show Example`; selecting it reveals the retained window without rebuilding it.

## Platform Diagnosis

- Current platform laws: parent before child; comparator-only native shell; probe commands remain environment-gated; native visibility is authoritative for retained tray menus.
- Does this fit as a regular atom: yes, as a decomposition of one existing environment policy into topology and instrumentation facts.
- Does this require law upgrade: yes. Comparator topology becomes reusable example evidence; probe instrumentation remains exclusive to `win32-bug`.
- Breaking update stance: introduce a new internal environment switch for comparator topology and migrate both source examples to it; retain the old probe switch only as instrumentation and as an implication of comparator topology.
- User confirmations still required: visual acceptance of the resulting `webview-control`; automated checks cannot judge residue pixels.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
shared native comparator base
        |
        +--> win32-bug: probe counters + probe commands
        |
        +--> webview-control: optional AppWindow overlay after WebView2
```

```text
window visible  -> tray: Hide Example | Quit Demo
Hide selected   -> close retained window
visibleChange   -> tray: Show Example | Quit Demo
Show selected   -> toVisible retained window
Quit selected   -> destroy window -> close runtime
```

### Interface Shape

- Add one internal Windows environment fact meaning "use the accepted comparator host topology".
- Keep the existing probe environment fact meaning "enable native paint/material instrumentation and commands"; it also implies comparator topology.
- Source examples set environment facts before broker creation.
- No new public WebView API is introduced.

### Data Shape

```text
ComparatorTopology = enabled | disabled
ProbeInstrumentation = enabled | disabled
Overlay = enabled | disabled

win32-bug       = comparator:on, probe:on,  overlay:off
webview-control = comparator:on, probe:off, overlay:operator choice
ordinary app    = comparator:off, probe:off, overlay:app choice
```

Operational visibility remains native state, not a local tray boolean.

### Architecture Shape

Host topology decisions may influence initial position/size, style/ex-style, DWM non-client policy, frame refresh, full-client projection, and resize ownership. Probe instrumentation may influence only probe state, title counters, paint/material experiment commands, and probe-specific title updates. AppWindow remains post-WebView and must not leak back into pre-WebView host construction.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Residue comparison | DWM residue is a visual native-composition fact. | Deliver source-built `webview-control` for the user to inspect after automated smoke passes. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should comparator topology become the production default for all OpenTray apps? | That would change task-switcher, frameless, geometry, and resize contracts globally. | No. Limit it to source evidence examples in this change. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Set only `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1` in webview-control | It also enables probe title mutation, counters, and experimental commands, so the control example stops representing normal APIs. |
| Make all production windows use the probe shell | It breaks established full-client frameless, soft resize, switcher, and tray-placement contracts without evidence that every app wants those semantics. |
| Remove window-controls overlay from webview-control | Overlay is a core acceptance surface; `--no-overlay` already provides the exact A/B path when needed. |
| Build a second Windows window implementation for webview-control | The problem is coupled policy, not missing implementation. A second constructor would recreate drift. |
| Reimplement the win32-bug menu locally | The shared helper already defines the correct retained-tray contract. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: one user-observed old residue issue after comparator topology is shared reopens the remaining overlay/page variable diagnosis
- Custom exit condition from intent: automated source smoke passes, tray labels are lifecycle-tested, and the user receives the exact source-built command for visual acceptance