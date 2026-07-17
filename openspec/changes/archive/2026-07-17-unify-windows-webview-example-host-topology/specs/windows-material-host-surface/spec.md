## ADDED Requirements

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

## MODIFIED Requirements

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
