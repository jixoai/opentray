<!--
Orthogonal intents (2026-07-15; original user input: "残影清理工作导致频繁刷新，resize 尤为严重。是否应 debounce 100ms？这到底是 OpenTray、Windows/WebView2，还是 Rust 的问题？官方 Mica 应用为什么正常？需要留下调查报告。"):
1. Separate the observed refresh cost from the original rendering-residue trigger.
2. Compare OpenTray's HWND/WebView2/DWM topology with documented WebView2 and Mica hosting models.
3. Classify evidence as confirmed, inferred, or unproven before changing recovery timing.
4. Define a measurable A/B path instead of adopting a timer as a blind workaround.
-->

# Windows WebView2 DWM Composition Investigation

## Scope

This report investigates Windows-only rendering residue and refresh churn in the
current WebView extension. It does not change runtime behavior. It records the
evidence needed before changing the cleanup policy again.

```text
operator sees residue
        |
        v
OpenTray invokes shell-state repair
        |
        v
SW_SHOWMINNOACTIVE -> SW_RESTORE
        |
        v
DWM/WebView2 redraws correctly, but interaction visibly refreshes
```

## Executive Decision

Do not add a generic `100ms` debounce yet.

The previous implementation had a `120ms` live-resize **throttle** for
ordinary native resize. A throttle performs the invasive repair repeatedly
during a drag. A true debounce would instead perform one trailing repair after
the interaction settles. Windows already provides `WM_EXITSIZEMOVE` for that
terminal boundary, so the first A/B change is terminal-only recovery.

Terminal-only recovery is implemented in this round: `WM_SIZE` now synchronizes
surfaces and records an observed resize, while `WM_EXITSIZEMOVE` may queue one
recovery. Focused automated tests and the isolated Windows source smoke pass;
Windows material/frameless visual acceptance remains pending. A single delayed
terminal repair is a separate experiment only if the next-message recovery
proves too early.

## What Is Confirmed

### 1. The historical visible refresh was directly caused by OpenTray recovery policy

```text
WM_ENTERSIZEMOVE
        |
WM_SIZE ------------ every 120ms while ordinary resize continues
        |                         |
        |                         v
        |               SW_SHOWMINNOACTIVE -> SW_RESTORE
        |                         |
WM_EXITSIZEMOVE ------------------+--> another terminal repair
```

The previous `crates/opentray-ext-webview/src/windows/mod.rs` implementation called
`maybe_auto_clear_windows_white_block_artifact_during_live_resize()` from
`WM_SIZE`. The helper permits the repair when the interaction is not the
frameless soft-resize path and its 120ms throttle fires. The repair calls
`ShowWindow(SW_SHOWMINNOACTIVE)` then `ShowWindow(SW_RESTORE)`.

That historical interaction cost is not mysterious: OpenTray deliberately asked
the shell to change the window state up to about eight times per second during
one native resize. This was sufficient to explain the refresh/flicker feeling,
even if the underlying residue bug originates below OpenTray.

The current terminal-only path is:

```text
WM_ENTERSIZEMOVE
        |
WM_SIZE -> synchronize host/WebView surfaces and record resize
        |
WM_EXITSIZEMOVE -> queue at most one shell-state recovery
```

A `WM_EXITSIZEMOVE` after a pure move has no observed resize and therefore no
recovery. The implementation still requires Windows visual acceptance before
this becomes the permanent policy.

### 2. The active host is windowed WebView2, not a native WinUI composition tree

```text
OpenTray Win32 host HWND
    |
    +-- DWM system backdrop (Mica/Acrylic/Tabbed)
    |
    +-- Wry ICoreWebView2Controller (windowed HWND hosting)
            |
            +-- transparent or clear WebView backing
```

Wry `0.55.1` creates an `ICoreWebView2Controller` with
`CreateCoreWebView2Controller` or
`CreateCoreWebView2ControllerWithOptions`. It subclasses the parent HWND for
resize/move notifications and adjusts the controller bounds. It does not create
an `ICoreWebView2CompositionController` in this path.

Microsoft documents Windowed, Window-to-Visual, and Visual WebView2 hosting as
different models with different composition and input ownership. Windowed mode
is intentionally the simple child-window model; Visual mode requires the app to
own a DComp visual and forward input. [MS-2]

### 3. OpenTray already uses the modern initial background option

At controller construction Wry attempts
`ICoreWebView2ControllerOptions3::SetDefaultBackgroundColor` before creating
the controller. At runtime OpenTray calls Wry's `set_background_color`, which
uses `ICoreWebView2Controller2::SetDefaultBackgroundColor`.

Microsoft documents transparent background behavior and a historical white
flicker when the background is set through the API; its workaround is an
environment variable set before WebView2 initialization. [MS-1] The first-load
case therefore remains worth testing, but it is not enough to explain every
OpenTray issue: our remaining reports occur on resize, style projection, and
restore after the controller already exists.

### 4. Mica is not a guarantee that every child surface shares WinUI composition

OpenTray applies Mica/Acrylic to the native host through DWM/window-vibrancy and
then exposes a clear WebView backing above it. The DWM system-backdrop contract
describes a material behind application content; it does not turn a child HWND
into a WinUI visual. [MS-4]

Official Windows applications that appear stable can use a native WinUI/XAML
composition tree, an AppWindow-managed title bar, and no transparent WebView2
child at the problematic layer. That is an architecture difference, not proof
that Mica itself is unreliable.

## What Is Not Proven

| Claim | Status | Why it is not yet a conclusion |
| ----- | ------ | ------------------------------ |
| The original residue is a WebView2 runtime defect. | Plausible | Existing behavior is consistent with documented WebView2/DWM edge cases, but no isolated WebView2 reproduction has been captured. |
| `WS_EX_NOREDIRECTIONBITMAP` is the trigger. | Unproven | OpenTray intentionally removes it for material backdrops; the residue also appears in paths beyond plain transparent hosting. |
| Wry has a defect that an upgrade fixes. | Unproven | Wry has historical Windows resize/background fixes, but the active version and exact trace have not been compared against a minimal repro. |
| Visual hosting fixes the problem. | Unproven | Microsoft exposes the option, but it changes DComp/input ownership and is not documented as a residue cure. |
| Rust is the root cause. | Rejected | The visual path is WebView2 COM, Win32, and DWM. Rust is only the language/projection layer invoking those APIs. |

## Responsibility Map

```text
Rust `windows` / `windows-sys`
        |  ABI projections; no compositor policy
        v
Wry + webview2-com
        |  chooses windowed ICoreWebView2Controller hosting
        v
OpenTray
        |  custom WS_POPUP frameless shell, DWM backdrop, clear backing,
        |  resize/style policy, and recovery cadence
        v
Windows DWM + WebView2 Runtime
        |  owns final composition and known transparent/background behavior
        v
pixels
```

The `windows` and `windows-sys` crates expose Windows APIs, but the current host
behavior is defined by OpenTray plus Wry. Wry is a Tauri ecosystem library, not
the WinUI desktop compositor. There is no evidence that changing Rust language
would change the same COM/DWM behavior.

## Why Official Mica Looks Better

This is an inference from the documented hosting models and the current source,
not a claim about every Microsoft application.

```text
Typical native Mica application
    AppWindow / WinUI content visual
    -> compositor-owned material + content path

Current OpenTray material window
    custom Win32 non-client projection
    -> DWM backdrop host
    -> child HWND WebView2 with clear backing
    -> application-managed residue repair when the surfaces disagree
```

OpenTray has intentionally selected capabilities that native Mica applications
do not necessarily combine: runtime background switching, fully frameless
`WS_POPUP`, an independently resized WebView child, custom resize gestures, and
transparent/material content. The capability combination is valid, but it has a
larger composition boundary and demands stricter recovery discipline.

## A/B Investigation Plan

### Phase 0: Measure Before Changing Policy

Add temporary, opt-in diagnostics around every clear attempt:

```text
interaction id
    -> reason: first-show | style | live-resize | exit-size-move | soft-release | restore
    -> time since last WM_SIZE
    -> count within current interaction
    -> background family / frameless / maximized / controller hosting mode
    -> clear duration and whether a later WM_PAINT changed the result
```

The diagnostic must be off by default and must not alter the message ordering.

### Phase 1: Recovery Cadence Matrix

| Variant | During continuous `WM_SIZE` | After terminal boundary | Expected result |
| ------- | --------------------------- | ----------------------- | --------------- |
| A: historical baseline | 120ms shell reset | yes | residue lowest, refresh cost highest |
| B: terminal-only (implemented; visual acceptance pending) | none | `WM_EXITSIZEMOVE` / soft-release | preferred interaction baseline |
| C: trailing 100ms | none | one timer after terminal boundary | tests whether next-message repair is too early |
| D: no shell reset | none | none | isolates whether repaint/bounds work alone now |

Run each variant for:

```text
opaque framed
material framed
opaque frameless + resizable
material frameless + resizable
show -> minimize -> toVisible
```

Acceptance is not only "no residue". Record resize smoothness, number of shell
repairs per interaction, and whether titlebar/non-client pixels return.

### Phase 2: WebView2 Background Initialization

Keep the existing Wry `ControllerOptions3` construction path as the baseline.
Then compare a process-start `WEBVIEW2_DEFAULT_BACKGROUND_COLOR` setup with the
same window/background family. This must occur before WebView2 environment or
controller creation and is process-wide, so it cannot be used as a casual
runtime style setter.

### Phase 3: Hosting Model Spike

1. Launch a source-only probe with
   `COREWEBVIEW2_FORCED_HOSTING_MODE=WINDOW_TO_VISUAL` before WebView2 startup.
   This is a low-cost compatibility probe, not production behavior.
2. If it changes the artifact class, create a separate composition-hosting spike
   using `ICoreWebView2CompositionController`.
3. Do not fold that spike into the current runtime until it proves input,
   accessibility, overlay controls, resize, and DWM backdrop all work. Visual
   hosting requires a DComp target/visual and explicit input forwarding. [MS-2]

## Decision Gates

```text
terminal-only smoke and human acceptance clean?
        |
   yes  +--> remove live WM_SIZE shell reset
        |
   no
        v
single trailing repair clean?
        |
   yes  +--> one post-terminal delay, never recurring reset
        |
   no
        v
background-init or Window-to-Visual changes artifact class?
        |
   yes  +--> design a bounded hosting/background change
        |
   no
        v
composition-controller prototype decision with explicit user approval
```

## Sources

- **[MS-1]** Microsoft Learn, "Default background color in WebView2 apps". Explains transparent background constraints, documented white flicker from API background initialization, and the pre-initialization environment-variable workaround. `https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webview2-api/defaultbackgroundcolor?tabs=win32`
- **[MS-2]** Microsoft Learn, "Windowed vs. Visual hosting of WebView2". Defines Windowed, Window-to-Visual, and Visual hosting plus DComp/input responsibilities. `https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/windowed-vs-visual-hosting`
- **[MS-3]** Microsoft Learn, WebView2 SDK release notes. Records runtime fixes for background-color white flicker and transparent-background issues; this is evidence of a real platform/runtime defect class, not proof of this exact reproduction. `https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/archive`
- **[MS-4]** Microsoft Learn, `DWM_SYSTEMBACKDROP_TYPE`. Defines DWM system-backdrop values used for Mica-like host material. `https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type`
- **[Local-1]** Wry `0.55.1`, `src/webview2/mod.rs`, controller construction and background-color paths. Installed Cargo source under `%USERPROFILE%/.cargo/registry`.
- **[Local-2]** OpenTray, `crates/opentray-ext-webview/src/windows/mod.rs`, current resize cleanup and DWM host behavior.
