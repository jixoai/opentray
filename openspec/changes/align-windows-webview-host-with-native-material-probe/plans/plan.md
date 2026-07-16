# Intent Document

## Current Round

- Round: 1
- Status: constructor diagnosis complete; implementation intent locked
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

> ???????????? native-material-host-paint-probe-20260716.exe ???????????
>
> ???????win32-bug ??example????? native-material-host-paint-probe-20260716.exe ?????? native-material-host-paint-probe-20260716.exe ???????????????? win32-bug??webview????????
>
> ??webview??????
>
> ??????????????opentray???????????native-material-host-paint-probe-20260716.exe????????????
> ?????????????

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | WebView ?????????? Acrylic ??????? | ???????? HWND/DWM??????????? |
| 2 | User | ?? probe ? Black host paint ????????????????? | ?????????????????? probe ?????? |
| 3 | User | ?? OpenTray ?? probe ???????????? | ?? change ?????????? change ????????? |
| 4 | User | win32-bug ??? probe ???????? WebView ??? | ??????????? A/B ??????????????? |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| native probe `src/main.rs` | Window class is `CS_HREDRAW | CS_VREDRAW`; `CreateWindowExW` uses no extended style and `WS_OVERLAPPEDWINDOW`. | OpenTray extra class/ex-style behavior must be treated as a variable. |
| native probe `src/main.rs` | Controls are created, then material is projected, then the HWND is shown. | The native substrate is complete before visible child content participates. |
| OpenTray Windows runtime | Class includes `CS_OWNDC`; WebView2 is built before `apply_window_style`. | Cold start currently creates the child/controller before DWM material completion. |
| Wry 0.55.1 source | `with_transparent(true)` configures a transparent WebView2 controller at creation. | The page can be a transparent child without dynamic background switching. |
| archived composition change | Complete black host painting removed residue in the previous visual round. | Retain the black base; correct its cold-start ownership and probe parity instead of reverting to no paint. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | pending |
| Normal archive | Commit containing archive result | pending visual acceptance |
| Abnormal handoff | Commit containing handoff evidence before returning to user discussion | not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/windows-material-host-surface/spec.md` | Material hosts paint a complete black base and parent precedes child during updates. | Upgrade: distinguish cold-start construction from retained style transactions. |
| archived `investigate-windows-webview-composition-recovery` | Removed shell resets, timers, width pulses, and broad diagnostics. | Preserve cleanup; add only probe-parity experiment commands needed for this visual comparator. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `??????????` | cold-start HWND construction topology | ??????????? class/style/material ?????? WebView? |
| `webview?????` | transparent controller plus transparent page pixels | ???????WebView ?????????????????? |
| `??? probe ??` | behavioral and spatial A/B parity | ?????????? Acrylic??????????????? |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/app/src/routes/win32-bug/+page.svelte` | WebView ??????????? probe ??? | Replace with probe-equivalent transparent page. |
| `packages/cli/examples/app/src/lib/components/win32-bug/*` | Previous production regression cards and custom titlebar. | Delete; they introduce visual variables absent from the probe. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| ????? probe ??????? | ????????? smoke ??? | User performs final visual acceptance after source build. |

## Intent

### Surface Intent

? `example:win32-bug` ???? probe ??? WebView ????? OpenTray ?????????? probe ????????????WebView ???????

### Underlying Drive

???? A/B ?????????????????????????????????????????????????????? WebView2 controller ????????????????

### Final Visible Effect

?? `example:win32-bug` ????????? 3x3+1 ??????? probe ?????? WebView ????????????????????? Acrylic???????? framed/frameless??? Acrylic/Mica/None??? no/black/gray host paint ??????? probe ??????????????

## Platform Diagnosis

- Current platform laws: material host owns the native base; WebView2 remains alpha-capable; no shell-state recovery.
- Does this fit as a regular atom: yes, inside the Windows ext-webview host and its regression example.
- Does this require law upgrade: yes; cold-start order becomes a separate invariant from runtime style updates.
- Breaking update stance: remove `CS_OWNDC`; reorder initial host construction; replace the existing win32-bug UI.
- User confirmations still required: final visual equivalence only.

## Reverse-Inferred Design

### Interaction / Visual Story

`Create HWND -> publish paint state -> project complete native material -> create transparent WebView2 child -> attach bounds -> show`.

The page contains only the probe controls. Keyboard shortcuts mirror the native probe. Status is projected into the native title so no opaque page status panel is needed.

### Interface Shape

- Existing typed window bridge owns framed/frameless and material changes.
- Example-only native experiment commands own host paint mode, backdrop reprojection, client invalidation, and title counters.
- Production material default remains black host paint.

### Data Shape

`ProbeState = material + paintMode + frameless + resizeSessions + paintMessages`.

Native state is authoritative because the residue and paint counters belong to HWND processing. The page sends commands and does not pretend DOM state proves native completion.

### Architecture Shape

`win32-bug page -> navigator.opentray.execCommand -> Windows HWND state -> WndProc paint/material action`.

Cold-start construction is physically separated from retained style projection. No timer, synthetic resize, minimize/restore, or WebView background toggle is added.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Visual parity | Automated tests cannot see native DWM residue. | Build and launch exact source artifacts, then wait for user's visual result. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Is removal of `CS_OWNDC` sufficient by itself? | It is a real constructor difference but not the only one. | Apply it together with parent-first cold-start order, then isolate visually through the probe UI. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Revert to no host paint | Native probe already demonstrated resize residue in that mode. |
| Dynamically toggle WebView transparency/background | User already observed those transitions can create residue and they add a second surface variable. |
| Keep generic WindowPanel/cards | They are not present in the native probe and obstruct direct visual comparison. |
| Reintroduce shell recovery or one-pixel pulses | They mutate unrelated shell/geometry state and were already disproven as the root fix. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: one user-observed residue mismatch reopens constructor diagnosis
- Custom exit condition from intent: source-built win32-bug matches the native probe except that its controls are WebView-rendered
