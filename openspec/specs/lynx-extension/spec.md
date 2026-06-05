# lynx-extension Specification

## Purpose

Define the official OpenTray Lynx extension family, its macOS-first runtime packaging law, and its tray-scoped lifecycle over the generic extension host boundary.
## Requirements
### Requirement: Lynx SHALL be an official extension atom

The Lynx capability SHALL live outside the kernel as `@opentray/ext-lynx` plus platform-native package atoms. The daemon SHALL load it through the generic extension host law and SHALL NOT own Lynx command parsing, runtime setup, bundle staging, or process lifecycle.

#### Scenario: Lynx facade routes through the generic extension host

- **GIVEN** a client has a tray handle
- **WHEN** it calls the Lynx facade to show a bundle
- **THEN** the client emits an `ext-command` with `ext: "lynx"`
- **AND** the daemon dispatches that scoped envelope through the generic dynamic extension boundary
- **AND** the daemon does not parse Lynx-specific command fields itself.

### Requirement: Lynx show SHALL stage an external bundle into the runtime sidecar

The Lynx extension SHALL accept a client-owned `.lynx.bundle` path and SHALL stage that bundle into an OpenTray-owned Lynx runtime host app before launch. The extension SHALL launch the runtime with the Lynx-local URL form proven by research rather than a raw absolute `file://` bundle path.

The runtime carrier SHALL be an OpenTray-maintained minimal host app rather than a long-term dependency on the upstream `LynxExplorer.app` shell. Upstream Lynx runtime libraries and resources MAY still be reused, but the app bundle identity, host bridge ownership, and release artifact provenance SHALL belong to OpenTray.

#### Scenario: Show command uses the OpenTray-owned runtime host app

- **GIVEN** a valid external `.lynx.bundle` path
- **WHEN** the Lynx extension handles `show`
- **THEN** it stages the bundle at `opentray-external/main.lynx.bundle` inside the OpenTray Lynx runtime host app resources
- **AND** it launches the host app with `file://lynx?local://opentray-external/main.lynx.bundle`
- **AND** it returns a success event only after the launch command succeeds.

### Requirement: Lynx runtime packaging SHALL stay extension-owned

The official macOS Lynx platform packages SHALL contain the native extension dynamic library and the runtime sidecar zip required to launch the OpenTray-owned Lynx host app. The daemon SHALL only discover and load the dynamic library generically. It SHALL NOT own or embed the Lynx runtime app bundle itself.

The runtime sidecar SHALL remain an app bundle on macOS. This law does not require an in-process-only dylib runtime equivalent to the WebView extension.

#### Scenario: Missing runtime sidecar is explicit

- **GIVEN** the Lynx extension library is present but the required runtime zip is missing
- **WHEN** a client requests `show`
- **THEN** the extension returns a typed unsupported or rejected error
- **AND** it does not report a fake successful window launch.

### Requirement: Lynx lifecycle SHALL be tray-scoped and cleanup-aware

The Lynx extension SHALL keep runtime state per active tray slot. Re-showing the same tray SHALL replace its previous Lynx process. `hide`, lease cleanup, and extension deinitialization SHALL close active Lynx child processes owned by that extension instance.

#### Scenario: Re-show replaces the previous tray runtime

- **GIVEN** a tray already has an active Lynx process
- **WHEN** the same tray receives another `show`
- **THEN** the extension closes the previous child process for that tray
- **AND** it launches the new bundle cleanly instead of leaking two runtimes.

#### Scenario: Hide closes the active Lynx runtime

- **GIVEN** a tray has an active Lynx process
- **WHEN** the client sends `hide`
- **THEN** the extension terminates that child process
- **AND** it emits a `hidden` lifecycle result instead of leaving an orphaned runtime window behind.

### Requirement: Lynx facade SHALL stay platform-neutral and bundle-path-centric

`@opentray/ext-lynx` SHALL depend only on public OpenTray contracts and typed command/event definitions. It SHALL NOT import platform-native package atoms from public API code. The primary public input SHALL be a `.lynx.bundle` path supplied by the caller.

#### Scenario: Public facade does not import darwin runtime packages

- **GIVEN** the public exports of `@opentray/ext-lynx`
- **WHEN** they are inspected
- **THEN** they expose typed Lynx commands and events over tray handles
- **AND** they do not require direct imports from `@opentray/ext-lynx-darwin-*`.

### Requirement: First-stage Lynx support SHALL be macOS-first and explicit

The first official Lynx extension release SHALL target macOS first. Unsupported platforms or missing runtime capabilities SHALL fail explicitly. The project SHALL NOT claim Linux or Windows visible Lynx support until those runtime paths are actually implemented and proven.

#### Scenario: Unsupported platform does not fake a window

- **GIVEN** a client tries to use Lynx on a platform without an implemented runtime package
- **WHEN** the daemon cannot resolve or the extension cannot launch
- **THEN** the command fails with a typed extension loading or capability error
- **AND** the project does not claim a visible Lynx window appeared.

### Requirement: Lynx host app source ownership SHALL belong to OpenTray

The macOS Lynx runtime sidecar SHALL be built from OpenTray-maintained host-app sources stored in this repository. OpenTray MAY reuse upstream Lynx shared libraries, resource bundles, and embedder APIs, but it SHALL NOT treat upstream `LynxExplorer.app` sources as the long-term product carrier.

#### Scenario: Host bridge source of truth is repo-owned

- **GIVEN** maintainers inspect the repository for the Lynx runtime host app source
- **WHEN** they review the source-of-truth implementation for window bridge, app delegate, bundle metadata, and resource packaging
- **THEN** those files live under an OpenTray-owned source root in this repository
- **AND** they are not represented only as patches against upstream Explorer app files.

### Requirement: Lynx public capability behavior SHALL survive the carrier migration

Changing the macOS runtime carrier from a borrowed Explorer shell to an OpenTray-owned host app SHALL NOT regress the public Lynx capability surface already accepted in OpenTray, including window-controller APIs, fit-content defaulting, tray-scoped lifecycle, and typed unsupported errors.

#### Scenario: Runtime carrier refactor preserves visible behavior

- **GIVEN** a developer runs the Lynx smoke flow after the carrier migration
- **WHEN** the runtime host app launches
- **THEN** `navigator.window` and `navigator.opentrayWindow` continue to work when enabled
- **AND** fit-content default behavior still avoids obvious dead margin
- **AND** explicit fixed-size mode still works
- **AND** unsupported style features still fail explicitly.

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
