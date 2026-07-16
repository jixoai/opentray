## ADDED Requirements

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

The Windows runtime SHALL NOT contain automatic artifact-cleanup flags, delayed reveal timers, private cleanup messages, shell reset helpers, raw host-width commands, DWM-flush commands, runtime composition logging, or a switch that disables material host painting.

#### Scenario: Obsolete experiment commands are rejected

- **GIVEN** a page submits a removed `win32Diagnostic*` command
- **WHEN** the extension dispatches the command
- **THEN** it is rejected as unsupported
- **AND** no native window mutation occurs.

### Requirement: win32-bug SHALL exercise production behavior only

`example:win32-bug` SHALL remain Windows-only and SHALL reuse the normal Window control panel, retained tray lifecycle, matching source broker/DLL selection, and transparent frameless titlebar.

The regression card SHALL expose host-surface recommit, surface snapshot, and self-drawn-control visibility. It SHALL NOT expose atomic shell/WebView/DWM stages, automatic cleanup, or material-host-paint disable controls.

#### Scenario: Maintainers verify the accepted matrix

- **GIVEN** the production regression example is running
- **WHEN** a maintainer exercises opaque, Mica, and Acrylic across framed/frameless, resize, and retained hide/show transitions
- **THEN** material remains visible
- **AND** native residue does not appear
- **AND** page input and window controls remain usable.
