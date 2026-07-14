<!--
Orthogonal intents (2026-07-14, user input):
1. Windows tray WebViews default to no taskbar/Alt+Tab entry.
2. Requested native overlay completes before first visible show and applies explicit Windows caption-button colors.
3. Overlay geometry, frameless client geometry, and native move/resize interaction stay measurable.
4. Source examples use a caller-scoped broker identity.
5. Source examples own the Vite server-instance lifecycle.
-->

## ADDED Requirements

### Requirement: Source WebView examples SHALL not share a neutral broker endpoint

Each source-tree WebView example invocation SHALL provide a caller label that
is unique to that invocation when connecting to the local broker. The label
SHALL include the process identity before the example name so sanitization or
length limits cannot remove the isolation component. This is an internal
example-runtime contract; it SHALL NOT change the public SDK default caller
identity.

#### Scenario: Neutral broker does not capture a source example

- **GIVEN** a same-version runtime already owns the neutral `opentray`
  Windows named-pipe endpoint
- **WHEN** `example:webview-control` starts from the source tree
- **THEN** it connects to an `example-<pid>-<name>` caller-scoped endpoint
- **AND** it starts a broker using the source runtime and WebView extension.

### Requirement: Source WebView examples SHALL own a Vite server instance through the Node API

The source example runtime SHALL create Vite through its Node API rather than
an intermediary package-script runner. It SHALL bind a single loopback address
(`127.0.0.1`), invoke `listen()`, and derive readiness from
`resolvedUrls.local`; formatted CLI output SHALL NOT be parsed as an authority.
Each readiness request SHALL be bounded by the shared startup deadline.
Shutdown SHALL invoke `close()` so a failed or completed example does not
leave a loopback listener that changes later example startup behavior.

#### Scenario: Vite URL survives formatted-output timing

- **GIVEN** the examples app starts while another Vite port is already occupied
- **WHEN** Vite selects another loopback URL after `listen()`
- **THEN** the source example accepts that URL and waits for its route
- **AND** it does not fail merely because a formatted CLI URL is absent or
  delayed.

#### Scenario: Example shutdown releases its Vite listener

- **GIVEN** a source WebView example has started a Vite listener
- **WHEN** the example exits or startup fails
- **THEN** its Vite server instance is closed
- **AND** the listener cannot remain as an orphan for the next example run.

### Requirement: Windows WebView switcher visibility SHALL be explicit

The WebView extension SHALL expose Windows system-switcher visibility as `style.platform.windows.showInSwitchers`. The durable fact SHALL mean participation in normal Windows task switchers, including the taskbar and Alt+Tab projection. It SHALL default to `false` so tray-owned WebViews behave as utility windows. Setting it to `true` SHALL opt a normal framed window into switcher participation without coupling that policy to title or icon metadata.

#### Scenario: Tray-owned Windows window stays out of switchers by default

- **GIVEN** a Windows WebView is created without `style.platform.windows.showInSwitchers`
- **WHEN** the native window becomes visible
- **THEN** it does not create a normal taskbar or Alt+Tab entry
- **AND** its title/icon metadata remain independent facts.

#### Scenario: Normal app window opts into switchers

- **GIVEN** a Windows WebView is created with `style.platform.windows.showInSwitchers: true`
- **WHEN** the native window becomes visible
- **THEN** it participates in the normal Windows task switchers
- **AND** native title/icon projection continues to work.

### Requirement: Windows native overlay SHALL complete on the HWND-owning thread before show succeeds

When `windowControlsOverlay` is enabled, the Windows runtime SHALL initialize WinRT on the HWND-owning thread and synchronously apply `AppWindowTitleBar.ExtendsContentIntoTitleBar` there. The show operation SHALL NOT report success or make the window visible until the native overlay call has completed successfully and the WebView child has been fitted to the resulting client area. Failure SHALL reject with typed capability truth; it SHALL NOT silently continue with a standard titlebar.

`windowControlsOverlay: true` SHALL remain valid. A caller MAY instead provide
`windowControlsOverlay: { backgroundColor?: "#RRGGBB", symbolColor?: "#RRGGBB" }`.
On Windows, each supplied opaque color SHALL be boxed as WinRT `IReference<Color>` and applied
to the matching native caption-button property before the first visible show. Other platforms
SHALL preserve their native control composition and SHALL NOT emulate opaque Windows buttons.

The Windows App Runtime bootstrapper MAY be discovered from a CBS system directory, but runtime implementation DLLs SHALL resolve from the package graph selected by `MddBootstrapInitialize` unless an explicit complete runtime directory is supplied. A bootstrapper directory SHALL NOT be treated as the selected runtime identity.

#### Scenario: First visible paint already has native overlay

- **GIVEN** a Windows WebView requests `windowControlsOverlay`
- **WHEN** its first `show()` resolves
- **THEN** native minimize, maximize, and close controls are already composited above page content
- **AND** the page content occupies the extended titlebar client area.

#### Scenario: Overlay failure is not reported as success

- **GIVEN** the required Windows AppWindow substrate cannot be loaded or invoked
- **WHEN** a WebView requests `windowControlsOverlay`
- **THEN** `show()` rejects with a typed unsupported or internal result
- **AND** the runtime does not show a visually incorrect fallback window.

#### Scenario: Windows overlay uses a configured caption-button background

- **GIVEN** a Windows WebView requests `windowControlsOverlay: { backgroundColor: "#0F6CBD", symbolColor: "#FFFFFF" }`
- **WHEN** its first `show()` resolves
- **THEN** its native caption-button background is not the system default white or black
- **AND** its native symbols use the supplied foreground color.

### Requirement: Windows overlay metrics SHALL remain owner-thread AppWindow geometry

Windows titlebar safe-area reads SHALL create and use `AppWindowTitleBar` only on the HWND-owning thread; they SHALL NOT retain or marshal AppWindow objects across apartments. `getTitlebarAreaRect()` and `overlay.geometrychange` SHALL derive the safe area from `LeftInset`, `RightInset`, and `Height`, then return page-viewport-relative geometry without blocking the broker message pump. Frameless and overlay host geometry SHALL fit the WebView child to the full client rect.

Public Windows window bounds SHALL represent the DWM visible frame rather than the raw `GetWindowRect` including invisible resize borders. `moveTo` and `resizeTo` SHALL compensate those invisible borders so repeated placement or responsive sizing does not drift. Native bounds and browser outer dimensions SHALL differ only by the remaining visible resize-border allowance expected by the acceptance surface.

#### Scenario: Page reads AppWindow overlay geometry without deadlock

- **GIVEN** a visible Windows WebView has overlay enabled
- **WHEN** page code calls `navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **THEN** the call resolves with the native titlebar safe area measured from AppWindow insets
- **AND** the broker remains responsive to later window commands.

#### Scenario: Frameless and overlay geometry fill the client area

- **GIVEN** a Windows WebView is shown in frameless mode or native overlay mode
- **WHEN** native bounds and browser outer dimensions are compared
- **THEN** the WebView fills the available client height
- **AND** any remaining difference is limited to the native resize-border allowance rather than a caption strip.

#### Scenario: Public window geometry excludes invisible DWM borders

- **GIVEN** a Windows window whose raw `GetWindowRect` includes invisible resize borders
- **WHEN** host or page code calls `getBounds`, `moveTo`, or `resizeTo`
- **THEN** the public rectangle is based on `DWMWA_EXTENDED_FRAME_BOUNDS`
- **AND** move/resize inputs are translated back to the raw frame without cumulative size or position drift.

### Requirement: Windows white-block repair SHALL not change shell state after a pure move

Windows SHALL treat `WM_ENTERSIZEMOVE` and `WM_EXITSIZEMOVE` as one native
size-or-move interaction, not as resize-only signals. A white-block workaround
that uses shell-state mutation SHALL require an observed `WM_SIZE` during that
same interaction. A pure drag SHALL preserve the window's state and SHALL NOT
invoke a minimize/restore reset or emit a synthetic `windowstatechange` event.

#### Scenario: Translucent window drag completes without a state animation

- **GIVEN** a visible Windows WebView has a non-opaque background
- **AND** a native size-or-move interaction starts
- **WHEN** the interaction exits without an intervening `WM_SIZE`
- **THEN** the white-block repair does not run
- **AND** the window is not minimized and restored as a side effect.

#### Scenario: Real live resize remains eligible for artifact repair

- **GIVEN** a visible Windows WebView has a non-opaque background
- **AND** a native size-or-move interaction receives `WM_SIZE`
- **WHEN** the interaction exits
- **THEN** the resize-only artifact-repair path remains eligible
- **AND** its existing throttling remains in effect during the live resize.
