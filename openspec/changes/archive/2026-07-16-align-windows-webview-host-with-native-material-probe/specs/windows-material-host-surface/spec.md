## ADDED Requirements

### Requirement: Probe state SHALL remain native

When `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`, the Windows host SHALL maintain a native probe state containing material mode, host-paint mode, resize-session count, and paint-message count.

Material mode SHALL be one of Acrylic, Mica, or None. Host-paint mode SHALL be one of handled-without-fill, Black, or Gray. WndProc SHALL apply the selected host-paint mode in both `WM_ERASEBKGND` and `WM_PAINT` without changing WebView2 background or bounds.

The probe state SHALL be disabled when the environment switch is absent. Production material policy SHALL remain Black.

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

### Requirement: Probe frameless shell SHALL match the standalone comparator

When the native material probe switch is enabled and the retained window enters frameless mode, the comparator SHALL preserve the standalone probe's native resize frame and system-menu style, leave DWM non-client rendering under window-style policy, delegate non-client geometry to the default window procedure, and use native resizing. Copied client bits MAY be discarded only in this comparator path.

This probe-only shell SHALL NOT replace the production frameless procedure. Production frameless windows SHALL continue to own full-client geometry, disabled DWM non-client rendering, and application-level soft resize.

#### Scenario: Frameless comparison does not add an OpenTray-only outer frame

- **GIVEN** the standalone native probe and `example:win32-bug` use Acrylic and handled-without-fill host paint
- **WHEN** both retained windows enter frameless mode and are repeatedly resized
- **THEN** the WebView-controlled comparator uses the same native shell projection as the standalone probe
- **AND** it does not introduce an additional classic Windows outer-frame residue.

#### Scenario: Production frameless remains independent

- **GIVEN** an ordinary OpenTray window without the native material probe switch
- **WHEN** it enters frameless mode
- **THEN** its established full-client and soft-resize behavior remains unchanged
- **AND** comparator-only copied-bit and native-frame policies do not apply.

### Requirement: Host event polling SHALL be single-flight and terminal on transport failure

The host-side WebView window event poller SHALL allow at most one drain request in flight. If the transport rejects a drain request, the poller SHALL stop its interval and report that failure once. Existing listeners SHALL NOT cause overlapping retries or duplicate connection-closed diagnostics after the transport has failed.

#### Scenario: Broker disconnect produces one polling diagnostic

- **GIVEN** multiple native window event listeners share one host-side poller
- **WHEN** the broker connection closes while one drain request is pending
- **THEN** that failure is reported once
- **AND** no additional drain requests are issued after the failure.

## MODIFIED Requirements

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

### Requirement: Production SHALL contain no legacy recovery scheduler or diagnostic protocol

The Windows runtime SHALL NOT contain automatic artifact-cleanup flags, delayed reveal timers, private cleanup messages, shell reset helpers, raw host-width commands, runtime composition logging, or a production switch that disables material host painting. Probe-only material/paint commands SHALL require `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1` and SHALL otherwise be rejected without native mutation.

#### Scenario: Probe commands are rejected outside the comparator

- **GIVEN** an ordinary OpenTray window without the native material probe environment switch
- **WHEN** a page submits a `win32Probe*` command
- **THEN** it is rejected as unsupported
- **AND** no native window mutation occurs.

### Requirement: win32-bug SHALL be a WebView-controlled native-probe comparator

`example:win32-bug` SHALL remain Windows-only and SHALL launch the normal source-tree broker and extension with `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`.

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
