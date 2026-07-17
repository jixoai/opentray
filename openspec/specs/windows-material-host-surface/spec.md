# windows-material-host-surface Specification

## Purpose
Define ownership, cold-start construction, repaint, resize, and regression-proof laws for Windows WebView hosts using DWM materials.
## Requirements
### Requirement: Material windows SHALL own a complete native composition base

Every Windows Mica, Acrylic, Tabbed, or semantic blur WebView host SHALL retain the DWM redirection surface and paint the complete top-level HWND client with `BLACK_BRUSH` in both `WM_ERASEBKGND` and `WM_PAINT`.

The black client SHALL be the DWM composition base. It SHALL NOT be a DOM layer, WebView background, child HWND, or visible overlay. Plain opaque and plain transparent windows SHALL retain `WS_EX_NOREDIRECTIONBITMAP` plus their configured Softbuffer base.

#### Scenario: Acrylic remains visible over the native black base

- **GIVEN** a Windows WebView uses Acrylic
- **WHEN** the top-level HWND paints its complete black client base
- **THEN** Acrylic remains visible
- **AND** no stale native pixels remain inside or outside WebView child coverage.

#### Scenario: Plain hosts retain Softbuffer ownership

- **GIVEN** a Windows WebView uses opaque or plain transparent background
- **WHEN** its native host surface is committed
- **THEN** the runtime presents the configured Softbuffer base
- **AND** it does not use the material black painter.

### Requirement: Cold-start construction SHALL complete the native host before WebView2

A newly created Windows WebView host SHALL use this cold-start procedure:

```text
create hidden top-level HWND
-> publish native paint/material ownership
-> project Win32 style and DWM material
-> apply final initial native geometry
-> commit the complete native host client
-> create an alpha-capable WebView2 child and establish thread COM
-> apply AppWindow titlebar overlay when requested
-> commit WebView2 background and final client bounds
-> show the top-level HWND
```

The top-level window class SHALL use `CS_HREDRAW | CS_VREDRAW` and SHALL NOT use `CS_OWNDC`. Initial geometry correction SHALL NOT run before native paint/material ownership is published. Initial Mica/Acrylic/Tabbed projection SHALL use the system backdrop and extended client frame without enabling DWM blur-behind. AppWindow titlebar overlay SHALL NOT initialize during the pre-WebView native-host phase. It SHALL run after WebView2 has established COM on the HWND-owning thread and before the first final WebView bounds commit or show.

#### Scenario: First WebView frame has a complete material parent

- **GIVEN** a hidden Windows host is being created with Acrylic or Mica
- **WHEN** WebView2 creates its controller and child HWND
- **THEN** the parent HWND already owns its final material, client-frame, paint policy, and initial geometry
- **AND** no pre-material resize message may seed an unowned redirection surface.

#### Scenario: AppWindow overlay starts after WebView2 COM

- **GIVEN** a Windows WebView requests window-controls overlay
- **WHEN** the hidden host completes cold-start construction
- **THEN** Win32 style, DWM material, host paint, and initial geometry complete before WebView2
- **AND** AppWindow titlebar overlay initializes only after WebView2 exists on the HWND thread
- **AND** the first ordinary bridge action does not terminate the broker.

### Requirement: Material parent painting SHALL cover child-occupied client regions

The top-level material HWND SHALL NOT retain parent `WS_CLIPCHILDREN`. This SHALL allow parent painting to cover the complete client surface beneath the WebView child.

#### Scenario: WebView coverage does not bound host residue

- **GIVEN** the WebView child occupies only part of the top-level client
- **WHEN** the material host repaints
- **THEN** the complete parent client is painted
- **AND** uncovered native material regions do not retain stale pixels.

### Requirement: Style projection SHALL complete the parent before the child

A style/background transaction SHALL run in this order:

```text
publish target host-paint policy
-> suppress synchronous attached-child commits
-> project Win32/DWM/AppWindow style
-> complete native parent host surface
-> commit WebView2 background
-> commit controller and WRY child bounds
-> notify parent position
```

#### Scenario: Switching material or frameless state is residue-free

- **GIVEN** a retained window changes background family or framed/frameless state
- **WHEN** the style transaction completes
- **THEN** the parent material base is valid before WebView2 presents its child
- **AND** no shell transition, synthetic resize, timer, or host rebuild is used as recovery.

### Requirement: Resize SHALL use parent-before-child ordering

`WM_WINDOWPOSCHANGED` SHALL call `DefWindowProc` before notifying WebView2 of parent position and SHALL NOT resize the child. `WM_SIZE` SHALL call `DefWindowProc`, commit the native parent surface, apply WebView2 controller bounds, apply WRY child HWND bounds, and notify parent position in that order.

#### Scenario: Native resize does not expose staircase residue

- **GIVEN** a material-backed Windows WebView is interactively resized
- **WHEN** each `WM_SIZE` is processed
- **THEN** the new parent area is painted before child geometry is presented
- **AND** prior top-level client pixels are not retained as resize residue.

### Requirement: clearWhiteBlock SHALL recommit only the configured host surface

The existing `clearWhiteBlock`, `clear-white-block`, `clearWindowArtifacts`, and `clear-window-artifacts` command aliases SHALL remain accepted. They SHALL synchronously recommit only the configured top-level host surface.

For material backgrounds the command SHALL request parent-only synchronous redraw. For plain backgrounds it SHALL re-present the configured Softbuffer base.

The command SHALL NOT minimize, restore, activate, focus, resize, move, rebuild, or reparent the host. It SHALL NOT apply WebView2 controller bounds, WRY child bounds, or parent-position notification.

#### Scenario: Manual host recommit has no shell or geometry side effects

- **GIVEN** a visible normal or maximized Windows WebView
- **WHEN** the page invokes `navigator.opentray.execCommand("clearWhiteBlock")`
- **THEN** only the native host surface is recommitted
- **AND** visibility, activation, focus, geometry, and WebView child bounds remain unchanged.

### Requirement: Production SHALL contain no legacy recovery scheduler or diagnostic protocol

The Windows runtime SHALL NOT contain automatic artifact-cleanup flags, delayed reveal timers, private cleanup messages, shell reset helpers, raw host-width commands, runtime composition logging, or a production switch that disables material host painting. Probe-only material/paint commands SHALL require `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1` and SHALL otherwise be rejected without native mutation.

#### Scenario: Probe commands are rejected outside the comparator

- **GIVEN** an ordinary OpenTray window without the native material probe environment switch
- **WHEN** a page submits a `win32Probe*` command
- **THEN** it is rejected as unsupported
- **AND** no native window mutation occurs.

### Requirement: win32-bug SHALL be a WebView-controlled native-probe comparator

`example:win32-bug` SHALL remain Windows-only and SHALL launch the normal source-tree broker and extension with both comparator topology and `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`.

Its native window SHALL preserve the native probe's `CW_USEDEFAULT` position and DPI-equivalent raw outer size for width 900 and height 620. A DPI-aware OpenTray host SHALL scale those extents without applying visible-frame border compensation; it SHALL start framed, resizable, Acrylic, and Black host paint. Its page SHALL render the same centered 3-column control matrix as `native-material-host-paint-probe-20260716.exe`:

- No host paint
- Black host paint
- Gray host paint
- Acrylic
- Mica
- No backdrop
- Toggle frameless
- Reset native backdrop
- Invalidate plus UpdateWindow
- Exit

The controls SHALL be rendered by WebView. Every page pixel outside the controls SHALL remain transparent: no page background, card, titlebar, header, event log, badge, or diagnostic panel may cover the native material.

Keyboard shortcuts `1`, `2`, `3`, `A`, `M`, `N`, `F`, `R`, `P`, and `Escape` SHALL invoke the corresponding control.

The tray menu SHALL contain one primary item labeled `Hide Example` while the retained window is operationally visible and `Show Example` while it is hidden or minimized, followed by a separator and `Quit Demo`. The primary item SHALL call `close()` for a visible retained window and `toVisible()` otherwise. `Quit Demo` SHALL destroy the native session and close the example runtime.

#### Scenario: Native and WebView probes differ only by control renderer

- **GIVEN** the native probe and `example:win32-bug` are placed under the same Windows environment
- **WHEN** both use the same material, paint, frame, and size sequence
- **THEN** their top-level native host behavior is directly comparable
- **AND** the expected visible difference is that one control matrix is native and the other is WebView-rendered.

#### Scenario: Transparent page exposes Acrylic around controls

- **GIVEN** `example:win32-bug` starts in Acrylic plus Black host-paint mode
- **WHEN** the page has loaded
- **THEN** Acrylic remains visible across the client area outside button pixels
- **AND** resizing does not reveal a page-colored substrate.

#### Scenario: Tray menu follows retained native visibility

- **GIVEN** `example:win32-bug` has completed its first successful show
- **WHEN** the primary tray item hides and then reveals the retained window
- **THEN** the primary label changes from `Hide Example` to `Show Example` and back to `Hide Example`
- **AND** the same native WebView session is reused.

### Requirement: Probe state SHALL remain native

When `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`, the Windows host SHALL maintain a native probe state containing material mode, host-paint mode, resize-session count, and paint-message count.

Material mode SHALL be one of Acrylic, Mica, or None. Host-paint mode SHALL be one of handled-without-fill, Black, or Gray. WndProc SHALL apply the selected host-paint mode in both `WM_ERASEBKGND` and `WM_PAINT` without changing WebView2 background or bounds.

The probe state SHALL be disabled when the environment switch is absent. Comparator topology alone SHALL NOT create probe state or accept probe commands. Production material policy SHALL remain Black.

#### Scenario: Host paint changes without changing page pixels

- **GIVEN** the probe example uses an alpha-capable WebView and a transparent page
- **WHEN** the operator selects no host paint, Black, or Gray
- **THEN** only top-level HWND paint ownership changes
- **AND** the WebView2 controller and DOM background remain transparent.

#### Scenario: Material changes preserve the redirection host

- **GIVEN** the probe is running on one retained HWND/WebView pair
- **WHEN** the operator selects Acrylic, Mica, or None
- **THEN** DWM material and client-frame projection change in place
- **AND** the host HWND is not rebuilt and the WebView child is not reparented.

#### Scenario: Comparator-only mode rejects probe commands

- **GIVEN** comparator topology is enabled without `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE`
- **WHEN** a page submits a `win32Probe*` command
- **THEN** it is rejected as unsupported
- **AND** no probe state or native mutation is created.

### Requirement: Probe frameless shell SHALL match the standalone comparator

When the native material comparator topology is enabled and the retained window enters frameless mode, the host SHALL preserve the native resize frame and system-menu style, leave DWM non-client rendering under window-style policy, and use native resizing. It SHALL first delegate `WM_NCCALCSIZE` to the default window procedure, preserve the resulting left/right/bottom native resize insets, and then project only the client top to `window top + DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`. It SHALL NOT retain the caption-height gap above WebView2. Copied client bits MAY be discarded only in this comparator path.

This comparator-only shell SHALL NOT replace the production frameless procedure. Production frameless windows SHALL continue to own full-client geometry, disabled DWM non-client rendering, and application-level soft resize.

#### Scenario: Comparator frameless keeps native resize without a caption gap

- **GIVEN** comparator topology is active on Windows 11
- **AND** the retained window uses frameless style without AppWindow overlay
- **WHEN** Win32 recalculates non-client geometry
- **THEN** the default window procedure owns the left/right/bottom native resize insets
- **AND** the client top is reset to the raw window top plus the DWM visible-frame border thickness
- **AND** public bounds minus `window.outerWidth` and `window.outerHeight` each remain within 0-4 logical pixels.

#### Scenario: Production frameless remains independent

- **GIVEN** an ordinary OpenTray window without comparator topology
- **WHEN** it enters frameless mode
- **THEN** its established full-client and soft-resize behavior remains unchanged
- **AND** comparator-only native-frame and copied-bit policies do not apply.

### Requirement: Host event polling SHALL be single-flight and terminal on transport failure

The host-side WebView window event poller SHALL allow at most one drain request in flight. If the transport rejects a drain request, the poller SHALL stop its interval and report that failure once. Existing listeners SHALL NOT cause overlapping retries or duplicate connection-closed diagnostics after the transport has failed.

#### Scenario: Broker disconnect produces one polling diagnostic

- **GIVEN** multiple native window event listeners share one host-side poller
- **WHEN** the broker connection closes while one drain request is pending
- **THEN** that failure is reported once
- **AND** no additional drain requests are issued after the failure.

### Requirement: Comparator host topology SHALL be independent from probe instrumentation

The Windows source-example runtime SHALL represent comparator host topology and native probe instrumentation as separate facts.

`OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR=1` SHALL select the accepted native comparator topology without creating probe counters, replacing the native title, or enabling `win32Probe*` commands. `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1` SHALL enable probe instrumentation and SHALL also imply comparator topology.

Comparator topology SHALL own only these native host decisions:

```text
initial position and raw outer-size projection
-> top-level extended-window style projection
-> style-derived DWM non-client policy
-> native frame refresh copied-bit policy
-> comparator frameless frame and system menu
-> default non-client geometry
-> native resize instead of application soft resize
```

Probe instrumentation SHALL own only probe material/paint state, resize and paint counters, probe title projection, and `win32Probe*` commands.

#### Scenario: Rich example uses comparator topology without probe state

- **GIVEN** a Windows source example enables comparator topology but not probe instrumentation
- **WHEN** its hidden HWND is created and WebView2 is attached
- **THEN** every comparator topology decision applies
- **AND** no probe state, probe title, or probe command capability exists.

#### Scenario: Probe mode remains a strict superset

- **GIVEN** `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`
- **WHEN** the Windows host evaluates its construction policy
- **THEN** comparator topology is enabled
- **AND** native probe instrumentation is enabled independently.

### Requirement: webview-control SHALL use the accepted comparator host base on Windows

The Windows `example:webview-control` launcher SHALL enable comparator host topology before it creates the source broker. It SHALL NOT enable native probe instrumentation.

With window-controls overlay disabled, its HWND/DWM/style/geometry/frameless/resize construction path SHALL match `example:win32-bug` before probe instrumentation. With overlay enabled, the sole additional native construction stage SHALL be AppWindow titlebar initialization after WebView2 attachment and before final child bounds/show.

Ordinary OpenTray applications SHALL retain production topology unless they explicitly run through this source-example comparator switch.

#### Scenario: no-overlay is a direct native-shell comparison

- **GIVEN** `example:webview-control --no-overlay` and `example:win32-bug` use the same background, frame, size, and DPI inputs
- **WHEN** both windows are created
- **THEN** their native host topology decisions are identical
- **AND** only `win32-bug` owns probe instrumentation and its probe control page.

#### Scenario: overlay is isolated after the shared base

- **GIVEN** Windows `example:webview-control` enables window-controls overlay
- **WHEN** the shared comparator base and WebView2 attachment complete
- **THEN** AppWindow overlay initializes as a post-WebView stage
- **AND** it does not alter the pre-WebView comparator construction sequence.
