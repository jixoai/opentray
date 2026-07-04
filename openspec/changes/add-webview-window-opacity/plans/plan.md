# Intent Document

## Current Round

- Round: 1
- Status: planning for direct apply
- Previous plan backup: none, initial plan

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

> 现在 ext-webview 的窗口管理中，缺乏对一整个窗口透明度的样式。
> 注意：这个背景高斯模糊或者背景透明 是 互相正交的功能，窗口透明度和背景材质是两码事，请你开始规划并开发

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record                                                              | Impact on intent                                                               |
| ---- | ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | User    | ext-webview window management lacks a whole-window opacity style.             | Add a public WebView window style field, not page CSS guidance only.           |
| 1    | User    | Background Gaussian blur and background transparency are orthogonal features. | Do not place opacity inside `style.background`.                                |
| 1    | User    | Window opacity and background material are different things.                  | Preserve material/backing ontology and introduce a separate shell-alpha field. |

### Evidence Read

| Source                                                                      | Fact                                                                                                           | Why it matters                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `AGENTS.md`                                                                 | Extensions must attach through tray/session contracts and must not reach into broker internals.                | Scope is ext-webview facade/native runtime only.                      |
| `.agents/skills/develop-opentray-ext/references/webview-window-patterns.md` | `style.background` is the single source of truth for native backing and material modes.                        | Opacity must not be modeled as another background kind.               |
| `packages/ext-webview/src/index.ts`                                         | Public style currently contains `frameless`, `keepOnTop`, `background`, and `platform`.                        | Add opacity at the common style level.                                |
| `crates/opentray-ext-webview/src/lib.rs`                                    | `show(...).style` parses into `WebviewInitialStyle`; `setStyle` passes a style payload to native runtimes.     | Initial and live style paths both need opacity.                       |
| `crates/opentray-ext-webview/src/macos/style.rs`                            | macOS applies native style through one `WindowStyleState` and `apply_window_style`.                            | AppKit `NSWindow` alpha belongs in the same style projection pass.    |
| `crates/opentray-ext-webview/src/windows/mod.rs`                            | Windows applies native style through `WindowStyleState`, `apply_style_patch`, and `apply_native_window_style`. | Win32 layered-window alpha belongs in the same style projection pass. |
| `openspec/specs/webview-extension/spec.md`                                  | WebView window operations are capability-gated and async; style events must match query result shapes.         | `getStyle()` / `stylechange` must include the opacity projection.     |

### Git Evidence

| Checkpoint                      | Expected commit evidence                                                                            | Current status                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts            | Not committed in this run unless user requests commit. |
| Task-progress commits           | Commit containing current-context task checkbox updates plus matching code/BDD evidence             | Not committed in this run unless user requests commit. |
| Self-review updates             | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending.                                               |
| Normal archive                  | Commit containing `openspec archive <change>` result                                                | Not in scope.                                          |
| Abnormal handoff                | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion       | Not needed yet.                                        |

### Existing OpenSpec Survey

| File / change                                                                                                                    | Existing law or pattern                                                                         | Reuse, extend, or break                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `openspec/changes/archive/2026-06-04-add-webview-window-rounded-corners-and-background-material/specs/webview-extension/spec.md` | Material background uses real native visual effects and must not be faked with page-level blur. | Extend by adding shell opacity as a different style dimension.                              |
| `openspec/changes/archive/2026-06-05-rebuild-webview-cross-platform-window-contract-and-runtime/specs/webview-extension/spec.md` | Common shell traits and platform-specific appearance families are separated.                    | Reuse; opacity is common shell alpha, material/corner stay in background/platform families. |
| `openspec/specs/webview-extension/spec.md`                                                                                       | Common shell state is capability-gated and should not fake unsupported style behavior.          | Modify to require opacity validation/projection and explicit capability metadata.           |

### User Language System

| User phrase      | Working meaning                                              | Plain-language translation when needed           |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| 一整个窗口透明度 | Whole native window alpha, including chrome/content surface. | Shell opacity.                                   |
| 背景高斯模糊     | Native or semantic background blur/material.                 | Background material/backing atom.                |
| 背景透明         | Clear backing that lets page/native substrate show through.  | Background backing mode.                         |
| 互相正交         | Independent dimensions that can compose.                     | Do not merge fields or infer one from the other. |
| 两码事           | Separate ontology, separate API fields.                      | No aliasing between opacity and material.        |

### Demo / Spike Code

| Path | Question it answers                                                            | Keep, migrate, or delete |
| ---- | ------------------------------------------------------------------------------ | ------------------------ |
| none | Existing style tests and examples are sufficient for this narrow API addition. | N/A                      |

### Questions To Confirm With User

| Question                                                    | Why this is the real question                                             | Current inference before user answers                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Should opacity accept only `0..1`, or also percent strings? | It decides whether the API is a strict numeric law or convenience parser. | Use only finite numeric `0..1`; clamp only at validation boundary if existing style laws do that. |
| Should opacity be mutable after show?                       | Determines whether `setStyle` applies it live.                            | Yes, because current style law already supports live shell mutations.                             |

## Intent

### Surface Intent

Add a whole-window opacity style to `@opentray/ext-webview` window management while preserving the user's ontology: background blur, background transparency, and whole-window opacity are independent style dimensions.

### Underlying Drive

The current style model can express what the window is backed by (`opaque`, `transparent`, semantic blur, platform material) but not how strongly the entire shell is composited into the desktop. Product code therefore has to misuse background material, CSS opacity, or platform-specific hacks to get a dimmed/faded native window. That blurs ontology and creates future coupling.

### Final Visible Effect

A developer can write:

```ts
await window.setStyle({ opacity: 0.72 });
```

or:

```ts
style: {
  opacity: 0.72,
  background: { kind: "platformMaterial", material: "hudWindow", state: "active" },
}
```

The whole native window becomes 72% opaque while the requested background mode still independently controls whether the backing is opaque, clear, blurred, or material-backed.

## Platform Diagnosis

- Current platform laws: ext-webview owns its window protocol, native projection, page injection, and event payloads. `style.background` owns backing/material. `style.platform.*` owns substrate-specific style families.
- Does this fit as a regular atom: yes. Opacity is a common shell trait under the existing WebView style law.
- Does this require law upgrade: small contract extension only; no broker/core law change.
- Breaking update stance: no breaking removal is needed. Additive field with default `1`.
- User confirmations still required: none for a numeric `0..1` API; broader animation or per-element opacity would be separate work.

## Reverse-Inferred Design

### Interaction / Visual Story

The operator opens a WebView window or panel. The developer may make it fully opaque, gently dimmed, or nearly transparent. This visual intensity composes with the background: a transparent panel can also be 80% opaque, and a blur/material panel can also be 80% opaque. The page does not need to fake the shell with root CSS opacity.

### Interface Shape

Common style:

```ts
interface WebviewWindowStyle {
  frameless: boolean;
  keepOnTop: boolean;
  opacity: number;
  background: WebviewWindowBackground;
  platform: WebviewWindowPlatformStyle;
}
```

Patch style:

```ts
interface WebviewWindowStylePatch {
  opacity?: number;
}
```

Capability metadata should expose `opacity: true` where the current runtime can project it.

### Data Shape

- Ontology: requested shell alpha is `style.opacity`, normalized to `0..1`.
- Projection: native AppKit/Win32 window alpha and returned `getStyle()` JSON.
- Not ontology: CSS `opacity`, CSS `backdrop-filter`, or page background color.

### Architecture Shape

```text
host/page style request
    |
    v
@opentray/ext-webview typed facade
    |
    v
native ext-webview parser + validator
    |
    v
WindowStyleState.opacity -----> AppKit/Win32 shell alpha
WindowStyleState.background --> backing/material projection
```

Forbidden couplings:

- no `opentray-core` WebView branches
- no daemon parser changes
- no page CSS injection
- no `background: "transparent"` inference from opacity
- no platform material inference from opacity

### User Confirmation Gates

| Gate                              | Why confirmation is required                            | Default until user answers |
| --------------------------------- | ------------------------------------------------------- | -------------------------- |
| Percent/string convenience parser | Could weaken type safety and introduce ambiguous units. | Do not add.                |
| Animated fade API                 | Would introduce time/easing as a new action source.     | Out of scope.              |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question               | Why it matters                                                    | Default assumption until user answers                                                                                   |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Should `0` be allowed? | A fully invisible but still interactive window can be surprising. | Allow `0` because it is mathematically valid opacity; future interaction safety belongs to a separate policy if needed. |

## Rejected Paths

| Path                                                                       | Why rejected                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Add `background: "transparentOpacity"` or material-specific opacity fields | Collapses orthogonal atoms and violates the user's explicit ontology.                                    |
| Use page-level CSS `opacity` injection                                     | Makes a projection pretend to be native shell truth and mutates user content.                            |
| Add `macos.opacity` / `windows.opacity` first                              | Opacity is common shell state on the supported runtime families, not a platform-private material detail. |
| Implement in `opentray-core` or broker daemon                              | WebView style protocol belongs to the extension atom.                                                    |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: reopen planning if the same opacity/background confusion appears twice in tests or review.
- Custom exit condition from intent: `style.opacity` works independently of `style.background` through host show, page/host setStyle, getStyle, stylechange, and native projection on supported runtimes.
