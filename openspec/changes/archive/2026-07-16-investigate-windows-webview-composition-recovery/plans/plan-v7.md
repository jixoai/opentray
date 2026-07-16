# Intent Document

## Current Round

- Round: 7
- Status: research-plan in progress; no replacement for the shell-state recovery is approved.
- Previous plan backup: `plans/plan-v6.md`

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

> 上一个BUG还是没有修复，还有一个同类的BUG：就是切换 frameless的时候。也会出现渲染残影。
>
> 关键是，我点击页面上的 clearWhiteBlock 并不能清理这些残影（哪怕整个页面抖了一下）。
>
> 反而是resize一下，哪怕非常少的量，也能完成真正的清理。
>
> 我们需要好好研究一种真正意义上的 clearWhiteBlock 技术。我们需要展开专门的研究。
>
> 请你接手 C:/Users/gaube/AppData/Local/Temp/opentray-webview-composition-handoff-20260716.md   ，然后专门做一个 example:win32-bug 我们来复现这个问题。
>
> 这个Example要参考 webview-control，提供Windows相关的控制能力（就是第一个卡片的所有能力）。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 2026-07-16 | User | `clearWhiteBlock` visibly shakes the page but does not clear retained residue after retained reveal or frameless transitions. | Treat the shell-state reset as a control baseline, not as a verified repair. |
| 2026-07-16 | User | A minimal real resize clears the same residue. | Reproduce the exact contrast between a non-geometry clear and a one-pixel geometry mutation in the real host. |
| 2026-07-16 | User | Create a dedicated `example:win32-bug`, based on all controls in WebView Control's first Window card. | Add a Windows-only source example plus a focused app route; do not overload the product demo with diagnostic-only controls. |
| 2026-07-16 | User | Perform dedicated research into a genuine `clearWhiteBlock` technique. | Instrument actual OpenTray HWND/WebView2/DWM state and compare candidates one at a time before replacing the current baseline. |
| 2026-07-16 | User | Frameless diagnostic mode needs a transparent custom titlebar, native drag, and operator-controlled self-drawn window controls. | Make frameless reproduction operable without relying on obsolete native chrome or permanently forcing page controls into every state. |
| 2026-07-16 | User | WinUI test still cannot combine transparent WebView with Mica or Acrylic. Split the active Windowed WebView2 recovery chain into atomic buttons for operator testing. | Keep the current host path and expose only the existing shell, WebView2, host-surface, DWM, and geometry stages; do not add a new hosting model or unrelated recovery candidate. |
| 2026-07-16 | User | Add a switch for the current residue cleanup so residue triggers can be observed without automatic repair. Document the trigger conditions at the cleanup function. | Make one bridge-owned automatic-cleanup gate cancel queued work when disabled; preserve explicit manual clear as the control baseline. |
| 2026-07-16 | User | Read the composition network report and add its new technical direction for acceptance testing. | Record Runtime/background/bounds evidence and DOM surface state; do not introduce a speculative repair. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `C:/Users/gaube/AppData/Local/Temp/opentray-webview-composition-handoff-20260716.md` | Windowed Controller plus transparent Mica shows residue; a basic CompositionController probe also shows residue. | Composition hosting alone is not a proven repair. |
| Same handoff | A normal resize can expose clean new pixels while prior client pixels remain stale. | The retained client/redirection surface is a stronger hypothesis than DOM repaint alone. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | `clearWhiteBlock` invokes `SW_SHOWMINNOACTIVE -> SW_RESTORE`, then refits WebView/host surfaces. | Current clear changes shell state, yet user reports it does not clear the target artifact. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Frameless/background completion uses a queued message or retained-reveal timer; native resize is terminal-only. | Do not reintroduce continuous cleanup while researching a durable clear. |
| Initial isolated-host smoke on 2026-07-16 | A normal `resizeTo()` invokes the existing auto shell-state recovery after the geometry update. | Disable automatic recovery in the diagnostic example, or the one-pixel control cannot isolate geometry from shell recovery. |
| Atomic source-host smoke on 2026-07-16 | The real `example:win32-bug` host completed paired shell reset, controller bounds, child HWND bounds, parent notification, host present, invalidation, update, DWM flush, and raw `960 -> 961 -> 960` host geometry. A prior `0x8007139F` callback failure did not recur with request-level debug logging. | The commands reach the intended live HWND/WebView2 stages; this proves dispatch and isolation boundaries, not visual residue repair. |
| Automatic-cleanup source-host smoke on 2026-07-16 | The diagnostic began with `automatic_cleanup=false`, completed manual clear, recorded enable then disable transitions twice, and skipped automatic frameless style cleanup after the final disabled state. A unit test cancels queued next-message cleanup. | The runtime gate covers automatic paths without blocking manual clear; human evidence still determines which transitions visibly leave residue. |
| `packages/cli/examples/webview-control.ts` | The source example already owns local broker/Vite lifecycle and mounts the typed WebView capability. | Reuse the known source-tree runtime path rather than a raw Win32 probe. |
| `packages/cli/examples/app/src/lib/components/webview-control/window-panel.svelte` | The first Window card owns the required Windows controls: style, frameless, resize, material, corner preference, state, devtools, and `clearWhiteBlock`. | Reuse this control surface directly in the diagnostic page. |
| Microsoft WebView2 hosting documentation | Windowed, Window-to-Visual, and Visual hosting have different composition and input ownership. | The current Windowed path must be measured as its own substrate. |
| Microsoft `SetWindowPos` documentation | `SWP_NOCOPYBITS` discards client content rather than proving a full DWM/WebView2 repair. | Treat it as a later candidate, never as an assumed fix. |
| User WinUI test on 2026-07-16 | WinUI permits transparent or opaque WebView background, but not a Mica/Acrylic combination that satisfies the diagnostic requirement. | Do not switch host architecture as an unverified workaround. |
| `C:/Users/gaube/AppData/Local/Temp/opentray-webview-composition-network-report-20260716.md` | No inspected implementation proves a material-backed transparent WebView2 residue repair. Runtime build and normal controller-bounds ordering remain measurable variables. | Keep production recovery unchanged; add only Runtime, backing-contract, `WM_SIZE -> SetBounds`, and page-surface instrumentation. |
| Environment-backed source-host smoke on 2026-07-16 | A separately built extension DLL logged the Runtime from the created Wry WebView environment, clear backing RGBA, successful normal `WM_SIZE -> SetBounds` HRESULT/timing, and completed the page-side `Surface snapshot` event assertion. | The new fields are live-host evidence rather than static code intent; visual residue acceptance remains human work. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | pending |
| Normal archive | Commit containing `openspec archive <change>` result | pending after visual evidence |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `fix-windows-frameless-visible-state` | Native resize recovery is terminal-only; shell recovery is visible UX debt. | Reuse as control baseline; do not reopen continuous `WM_SIZE` clears. |
| `fix-windows-frameless-visible-state/research/windows-webview2-dwm-composition.md` | Windowed WebView2 plus DWM background has unresolved retained-surface artifacts; composition hosting is unproven. | Extend evidence in a separate research atom. |
| `packages/cli/examples/webview-control.ts` | Source examples use a caller-scoped broker, Vite Node API, retained primary action, and teardown order. | Reuse. |
| `packages/cli/examples/app/src/lib/components/webview-control/window-panel.svelte` | One card exposes native Window controls without a second authority. | Reuse intact. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `真正意义上的 clearWhiteBlock` | A repair that demonstrably invalidates the stale composed surface, rather than merely animating the shell. | Proven retained-surface recovery. |
| `页面抖了一下` | The current shell-state reset is visible but does not fix the target pixels. | Visible recovery churn without accepted result. |
| `resize一下，哪怕非常少` | A real geometry change has a different composition effect from current repaint/shell calls. | One-pixel geometry control baseline. |
| `同类的BUG` | Reveal and frameless-style transitions share the same retained-residue class until evidence separates them. | Same artifact class, distinct triggers. |
| `专门做一个 example:win32-bug` | A durable, source-tree diagnostic tool, not a disposable raw Win32 test program. | Product-adjacent reproduction harness. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/win32-bug.ts` | Can the real OpenTray host reproduce frameless/reveal residue under controlled material and geometry transitions? | Keep as Windows diagnostic example. |
| `packages/cli/examples/app/src/routes/win32-bug/+page.svelte` | Can an operator run the complete Window card controls and a one-pixel pulse without unrelated demo panels? | Keep. |
| `packages/cli/examples/app/src/lib/components/win32-bug/residue-probe.svelte` | Does manual clear differ visibly from a bounded one-pixel resize pulse? | Keep while Windows composition remains under investigation. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| None before first diagnostic delivery | The user supplied the target behavior and explicitly asked for the reproduction harness. | Candidate repair adoption requires later visual evidence, not a pre-implementation choice. |

## Intent

### Surface Intent

Create a Windows-only `example:win32-bug` that reproduces rendering residue in the real OpenTray WebView host. It must provide every control from WebView Control's first Window card, plus direct probes for `clearWhiteBlock`, frameless transition, and a one-pixel resize pulse. Frameless mode must expose a transparent, draggable diagnostic titlebar with optional self-drawn controls.

### Underlying Drive

The current repair changes shell state, but the operator can see it fail while a tiny geometry mutation succeeds. The product needs to distinguish a real retained-surface invalidation from a cosmetic repaint or visible window animation before adding another workaround.

### Final Visible Effect

An operator launches one tray-owned diagnostic window, selects opaque/Mica/Acrylic, toggles frameless, invokes `clearWhiteBlock`, and runs a one-pixel resize pulse. In frameless mode, a transparent page titlebar starts native dragging and can reveal self-drawn minimize, maximize/restore, and close controls. The page and console show which action was requested; the Windows host emits opt-in snapshot/timing evidence for the same HWND. The user can truthfully compare whether the stale pixels clear, whether input/focus survives, and whether shell state visibly changes.

## Platform Diagnosis

- Current platform laws: WebView owns native window protocol and Windows composition behavior; core and broker remain extension-agnostic.
- Does this fit as a regular atom: yes, a Windows-only diagnostic surface plus extension-host instrumentation.
- Does this require law upgrade: not before evidence. A durable non-shell clear may later replace the shell-state law only after visual acceptance.
- Breaking update stance: no public API or migration. Debug diagnostics are opt-in and source-example scoped.
- User confirmations still required: approval before adopting a non-shell candidate as the new production `clearWhiteBlock` mechanism.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
launch example:win32-bug
        |
        v
choose opaque | Mica | Acrylic
        |
        v
toggle frameless / retained show
        |
        v
residue appears?
   |                    |
   no                   yes
   |                    |
record control      +-- clearWhiteBlock baseline
                       |
                       +-- one-pixel resize pulse
                       |
                       v
                  compare pixels, focus, flash, timing
```

```text
page action
    |
    v
native command / geometry request
    |
    v
Windows diagnostic snapshot
    |
    +-- requested background + clear backing intent
    +-- HWND style/ex-style + frame/visibility state
    +-- bounds + operation reason + elapsed time
    |
    v
human-visible result table
```

### Interface Shape

- `pnpm --filter opentray example:win32-bug` is the Windows-only diagnostic entrypoint.
- `/win32-bug` reuses the existing Window card unchanged for native controls.
- The probe adds bounded commands only: manual clear, frameless transition guidance, and a one-pixel native resize pulse.
- `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1` enables native process logging. It is not a product API.
- The launcher disables automatic white-block recovery so the pulse is geometry-only; the manual command remains the explicit shell-state control.
- The residue probe starts `Automatic cleanup` off and may enable it for same-session comparison; disabling it cancels queued automatic cleanup but does not block explicit manual clear.
- Frameless mode shows a transparent titlebar; the residue probe owns whether its self-drawn control cluster is visible.
- The residue probe exposes atomic shell, WebView2, host-surface, DWM, and raw geometry commands so the operator can vary order and timing deliberately.

### Data Shape

- `operation`: native `manual-clear`, `next-message-clear`, `delayed-reveal-clear`, and `explicit-resize`; the page separately labels its bounded `one-pixel-pulse` request.
- `surface contract`: requested background family, whether WebView backing is clear, host fill policy, frameless/resizable state, and HWND style/ex-style.
- `window state`: visible, minimized, maximized, bounds, and active pointer-capture state.
- `outcome`: elapsed time, shell-state transition count, focus/input observation, and human residue result. Human result remains evidence external to automatic logs.
- `atomic command`: one of paired shell reset, WebView2 controller bounds, WRY child HWND bounds, parent-position notification, host fill present, `InvalidateRect`, `UpdateWindow`, DWM flush, raw host grow/shrink, or existing full resize pulse. Raw geometry suppresses only synchronous `WM_WINDOWPOSCHANGED` / `WM_SIZE` surface synchronization; it does not request later WebView, host, paint, or DWM stages.
- `automatic cleanup`: a bridge-owned boolean controlling all automatic shell-state cleanup routes. Its disabled state is the diagnostic baseline and cancels pending next-message or delayed-reveal work; manual `clearWhiteBlock` bypasses it.
- `runtime contract`: the Runtime version returned by Wry and the latest backing RGBA accepted by Wry; this is configured-controller evidence, not DWM/WebView2 pixel readback.
- `WM_SIZE bounds result`: physical client size, `ICoreWebView2Controller::SetBounds` HRESULT, and elapsed microseconds emitted only for the normal unsuppressed `WM_SIZE` path.
- `page surface snapshot`: current bridge style plus computed `html`/`body` background color, opacity, and color scheme; it is non-mutating evidence for opaque/Mica/Acrylic comparisons in one retained session.

### Architecture Shape

```text
packages/cli example host
        |
        +-- tray lifecycle + local Vite URL
        |
        v
Svelte /win32-bug page
        |
        +-- existing WindowPanel
        +-- residue probe controls
        +-- computed html/body surface snapshot
        +-- transparent frameless titlebar + optional controls
        +-- atomic native composition commands
        |
        v
@opentray/ext-webview Windows host
        |
        +-- opt-in composition snapshots
        +-- Runtime/backing and WM_SIZE SetBounds evidence
        +-- auto recovery disabled for this diagnostic session
        +-- explicit manual-clear baseline
        |
        v
Win32 HWND + Wry Windowed WebView2 + DWM material
```

Forbidden: raw standalone probe evidence as a product conclusion, `opentray-core` WebView branches, recurring resize timers, and production adoption of an unproven candidate.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Replace shell-state clear | A candidate can affect focus, input, accessibility, and material behavior. | Keep current shell-state path as an explicit control baseline. |
| Start a composition/off-screen host rewrite | It changes ownership of pixels and input beyond this diagnostic atom. | Do not start. |

## Intent-Driven Plan

- [x] 1. Read the external handoff, current Windows host, existing investigation, and Window card scenario.
- [ ] 2. Specify the diagnostic example, opt-in evidence fields, and candidate-acceptance rules.
- [ ] 3. Write BDD tasks for source lifecycle, first-card reuse, one-pixel pulse, and native diagnostics.
- [ ] 4. Commit OpenSpec artifacts before product code.
- [ ] 5. Implement `example:win32-bug` and opt-in Windows composition diagnostics.
- [ ] 6. Run source smoke and collect an opaque/Mica/Acrylic human evidence matrix.
- [ ] 7. Select one non-shell candidate only if the matrix identifies a preserved-surface mechanism; otherwise keep research open.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Does OpenTray apply a clear WebView backing in the exact material order expected by the current Wry controller? | A wrong contract makes every repair comparison invalid. | Record requested contract and call ordering before testing candidates. |
| Is the residue tied to host redirection content, child WebView2 content, or their composition boundary? | Determines whether `SWP_NOCOPYBITS`, geometry pulse, reparent, or another layer is meaningful. | Do not claim root cause until the matrix separates opaque and material cases. |
| Can a non-shell candidate preserve focus/input and clear the same pixels as a one-pixel resize? | A pixel-only cure that breaks interaction is not acceptable. | Reject until both human-visible conditions pass. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Reintroduce the 120ms live `WM_SIZE` shell reset | It explains resize flicker but does not prove a retained-surface repair. |
| Add a generic debounce around `clearWhiteBlock` | Delaying a failing operation does not make it a genuine clear. |
| Compare a one-pixel pulse while automatic recovery remains enabled | The pulse would include shell recovery and could not isolate the geometry effect. |
| Promote standalone raw probe behavior to OpenTray law | The prior probe had unreliable input and did not reproduce OpenTray's real host contract. |
| Start off-screen/hybrid rendering now | It is a separate rendering/input architecture before low-cost real-host evidence is exhausted. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: any candidate that leaves residue, flashes shell state, or regresses focus/input is rejected and recorded.
- Custom exit condition from intent: the user completes the opaque/Mica/Acrylic matrix in `example:win32-bug`, then explicitly approves either one proven candidate experiment or a larger hosting-model investigation.
