## ADDED Requirements

### Requirement: Cold-start construction SHALL complete the native host before WebView2

A newly created Windows WebView host SHALL use this cold-start procedure:

```text
create hidden top-level HWND
-> publish native paint/material ownership
-> project Win32 style and DWM/AppWindow material
-> apply final initial native geometry
-> commit the complete native host client
-> create an alpha-capable WebView2 child
-> commit WebView2 background and bounds
-> show the top-level HWND
```

The top-level window class SHALL use `CS_HREDRAW | CS_VREDRAW` and SHALL NOT use `CS_OWNDC`. Initial geometry correction SHALL NOT run before native paint/material ownership is published.

#### Scenario: First WebView frame has a complete material parent

- **GIVEN** a hidden Windows host is being created with Acrylic or Mica
- **WHEN** WebView2 creates its controller and child HWND
- **THEN** the parent HWND already owns its final material, client-frame, and paint policy
- **AND** no pre-material resize message may seed an unowned redirection surface.

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

## MODIFIED Requirements

### Requirement: win32-bug SHALL be a WebView-controlled native-probe comparator

`example:win32-bug` SHALL remain Windows-only and SHALL launch the normal source-tree broker and extension with `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`.

Its native window SHALL start at 900 by 620 logical pixels, framed, resizable, Acrylic, and Black host paint. Its page SHALL render the same centered 3-column control matrix as `native-material-host-paint-probe-20260716.exe`:

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
