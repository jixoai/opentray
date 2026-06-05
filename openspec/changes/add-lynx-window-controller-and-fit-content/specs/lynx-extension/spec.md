## ADDED Requirements

### Requirement: Lynx SHALL expose navigator-owned window controls through the Lynx host bridge

The Lynx extension SHALL expose native window controls to page JavaScript through `navigator.window` and `navigator.opentrayWindow` when the feature is enabled for the shown Lynx window. Both properties SHALL reference the same capability object. `navigator.window` SHALL be the promoted public surface, while `navigator.opentrayWindow` SHALL remain the OpenTray-prefixed fallback for future standards conflict.

The capability object SHALL expose a Tauri-consistent scoped facade with asynchronous `invoke`, `listen`, and `once` methods. High-level asynchronous methods for `close`, `move`, `moveTo`, `resize`, `resizeTo`, `getStyle`, `setStyle`, `getCapabilities`, `getTitle`, `setTitle`, `getIcon`, and `setIcon` SHALL be implemented as wrappers over `invoke`. DOM-style `addEventListener` and `removeEventListener` MAY be provided as compatibility wrappers over `listen`, but SHALL NOT be the only event API.

The Lynx implementation SHALL use Lynx-native host bridges such as Native Modules, runtime-attached globals, and `GlobalEventEmitter` event forwarding. It SHALL NOT require core or daemon product branches, and it SHALL NOT pretend to be the WebView IPC transport.

#### Scenario: Page uses navigator window controls in a Lynx bundle

- **GIVEN** a Lynx window is shown with native window API enabled
- **WHEN** the page reads `navigator.window` and `navigator.opentrayWindow`
- **THEN** both properties exist
- **AND** both properties reference the same capability object
- **AND** the page can call `invoke`, `listen`, and async window-control wrapper methods without importing OpenTray facade code.

#### Scenario: Navigator API is not injected by accident

- **GIVEN** a Lynx window is shown without native window API enablement
- **WHEN** the page loads
- **THEN** the extension does not install `navigator.window`
- **AND** it does not install `navigator.opentrayWindow`.

#### Scenario: High-level methods delegate to scoped invoke

- **GIVEN** a Lynx window is shown with native window API enabled
- **WHEN** the page calls `navigator.window.resizeTo(480, 320)`
- **THEN** the injected API sends the same scoped native request as `navigator.window.invoke("resizeTo", { "width": 480, "height": 320 })`
- **AND** it resolves or rejects the returned promise through the same callback or response path.

#### Scenario: Window metadata methods stay inside the same navigator family

- **GIVEN** a Lynx window is shown with native window API enabled
- **WHEN** the page calls `await navigator.window.setTitle("OpenTray Lynx")` and `await navigator.window.setIcon(...)`
- **THEN** both changes use the same extension-owned window capability object and private Lynx bridge family
- **AND** the page does not need a second metadata-specific API surface.

### Requirement: Lynx window metadata SHALL stay extension-owned and Dock-visible on macOS

The Lynx `show(...)` command SHALL accept host-owned initial metadata such as `title` and `icon`. The Lynx extension SHALL keep title and icon as extension-owned window state and SHALL expose `getTitle`, `setTitle`, `getIcon`, and `setIcon` through the same `navigator.window` capability family.

Because `ext-lynx` owns a dedicated runtime app process on macOS, icon projection MAY safely target both per-window and application-level identity inside that process. The implementation SHALL project the current icon to the window miniwindow image and SHALL avoid a blank Dock runtime icon by shipping a real bundle icon for the carrier app. Title projection SHALL update the native window title; process-name or Dock-name refresh MAY be best-effort but SHALL NOT weaken the durable window-title contract.

#### Scenario: Initial metadata applies at launch

- **GIVEN** a caller shows a Lynx bundle with `title` and `icon`
- **WHEN** the native runtime launches the dedicated host app
- **THEN** the first visible window uses that title
- **AND** the runtime has a real non-blank Dock icon even before page-driven metadata changes occur.

#### Scenario: Runtime metadata updates stay observable

- **GIVEN** a page calls `await navigator.window.setTitle("Inspector")` or `await navigator.window.setIcon(...)`
- **WHEN** the Lynx native runtime handles the request
- **THEN** the native window state updates
- **AND** the runtime emits extension-owned `titlechange` or `iconchange` events
- **AND** subsequent `getTitle` or `getIcon` calls return the updated logical metadata.

### Requirement: Lynx SHALL expose navigator-owned screen capability

The Lynx extension SHALL expose screen information through `navigator.screen` and `navigator.opentrayScreen` when the feature is enabled for the shown Lynx window. Both properties SHALL reference the same capability object. The API shape SHALL follow the `window.getScreenDetails()` mental model rather than exposing raw monitor-management internals.

The capability object SHALL expose `getScreenDetails()` as the promoted public method. The returned structure SHALL include the current screen and the discovered screen set in a durable, screen-details-like shape that page code can inspect without platform-specific imports. If global override mode is enabled for screen bindings, `window.getScreenDetails()` SHALL delegate to the same capability family.

#### Scenario: Page reads screen details from navigator

- **GIVEN** a Lynx window is shown with native screen API enabled
- **WHEN** the page calls `await navigator.screen.getScreenDetails()`
- **THEN** the extension resolves a screen-details-like payload containing the current screen and the discovered screen set
- **AND** `navigator.opentrayScreen` references the same capability object.

#### Scenario: Screen capability is not injected by accident

- **GIVEN** a Lynx window is shown without native screen API enablement
- **WHEN** the page loads
- **THEN** the extension does not install `navigator.screen`
- **AND** it does not install `navigator.opentrayScreen`.

### Requirement: Lynx window operations SHALL be capability-gated and extension-owned

Window operations exposed through `navigator.window` SHALL return promises. The Lynx native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported move, resize, style, transparency, blur, or global override behavior SHALL reject with a typed unsupported error instead of faking success.

Style state SHALL include the frameless and visual-effect concepts needed for future platform work, including transparency and background effect support. Blur, acrylic, vibrancy, and Windows transparency behavior SHALL remain best-effort capabilities and MUST NOT be forced when the platform implementation would be slow or unstable.

#### Scenario: Capability metadata describes available operations

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states whether close, move, resize, title, icon, screen, transparency, background effects, and global overrides are supported
- **AND** the page can decide whether to render custom chrome.

#### Scenario: Unsupported visual effect is explicit

- **GIVEN** a page calls `navigator.window.setStyle({ backgroundEffect: "blur" })`
- **AND** the current platform does not support blur cleanly
- **WHEN** the extension handles the request
- **THEN** the returned promise rejects with a typed unsupported error
- **AND** the native runtime does not enable a slow fake blur path.

#### Scenario: Global overrides are disabled by default

- **GIVEN** a Lynx window is shown with native window API enabled
- **AND** global override mode is not enabled
- **WHEN** the page inspects `window.close`, `window.resizeTo`, and `window.getScreenDetails`
- **THEN** OpenTray has not replaced those functions.

### Requirement: Lynx launch behavior SHALL use explicit startup controls instead of implicit fit-content

For OpenTray standalone Lynx windows, the extension SHALL treat startup behavior as an explicit host-launch contract. `show` SHALL accept fixed or explicit size inputs plus startup capability flags such as `nativeWindowApi`, `bindWindowGlobals`, `nativeScreenApi`, `bindScreenGlobals`, and `style.frameless`. The extension SHALL support sizing bounds such as `minWidth`, `minHeight`, `maxWidth`, and `maxHeight`, but it SHALL NOT enable host-owned fit-content policy implicitly.

#### Scenario: Default Lynx launch uses a fixed host shell

- **GIVEN** a caller shows a Lynx bundle without explicit size or startup feature flags
- **WHEN** the extension launches the window
- **THEN** the native host uses its fixed fallback shell
- **AND** the extension does not start a hidden content-fitting loop.

#### Scenario: Startup flags are independently controllable

- **GIVEN** a caller shows a Lynx bundle with `nativeWindowApi`, `bindWindowGlobals`, `nativeScreenApi`, `bindScreenGlobals`, and `style.frameless` configured independently
- **WHEN** the extension launches the window
- **THEN** the enabled host capabilities match that startup request
- **AND** disabling one parent capability such as `nativeScreenApi` also disables dependent startup bindings such as `bindScreenGlobals`.
- **AND** enabling `style.frameless` does not silently remap the whole content area into a background drag region or swallow page pointer/input events.

#### Scenario: Explicit width and height remain authoritative

- **GIVEN** a caller shows a Lynx bundle with explicit `width` and `height`
- **WHEN** the extension launches the window
- **THEN** the native window starts from the explicit size
- **AND** no host-owned content-fitting policy overrides those explicit dimensions.
