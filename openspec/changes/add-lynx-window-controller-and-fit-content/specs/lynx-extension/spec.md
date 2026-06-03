## ADDED Requirements

### Requirement: Lynx SHALL expose navigator-owned window controls through the Lynx host bridge

The Lynx extension SHALL expose native window controls to page JavaScript through `navigator.window` and `navigator.opentrayWindow` when the feature is enabled for the shown Lynx window. Both properties SHALL reference the same capability object. `navigator.window` SHALL be the promoted public surface, while `navigator.opentrayWindow` SHALL remain the OpenTray-prefixed fallback for future standards conflict.

The capability object SHALL expose a Tauri-consistent scoped facade with asynchronous `invoke`, `listen`, and `once` methods. High-level asynchronous methods for `close`, `move`, `moveTo`, `resize`, `resizeTo`, `getStyle`, `setStyle`, and `getCapabilities` SHALL be implemented as wrappers over `invoke`. DOM-style `addEventListener` and `removeEventListener` MAY be provided as compatibility wrappers over `listen`, but SHALL NOT be the only event API.

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

### Requirement: Lynx window operations SHALL be capability-gated and extension-owned

Window operations exposed through `navigator.window` SHALL return promises. The Lynx native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported move, resize, style, transparency, blur, or global override behavior SHALL reject with a typed unsupported error instead of faking success.

Style state SHALL include the frameless and visual-effect concepts needed for future platform work, including transparency and background effect support. Blur, acrylic, vibrancy, and Windows transparency behavior SHALL remain best-effort capabilities and MUST NOT be forced when the platform implementation would be slow or unstable.

#### Scenario: Capability metadata describes available operations

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states whether close, move, resize, transparency, background effects, and global overrides are supported
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
- **WHEN** the page inspects `window.close` and `window.resizeTo`
- **THEN** OpenTray has not replaced those functions.

### Requirement: Lynx standalone windows SHALL default to fit-content sizing with explicit opt-out

For OpenTray standalone Lynx windows, the extension SHALL treat content-fitting as a host sizing policy rather than a DOM/body trick. The default behavior for `show` SHALL enable `fitContentSize` unless the caller explicitly disables it. Explicit `width` and `height` inputs SHALL override content-fit for the corresponding axis. The extension SHALL support sizing bounds such as `minWidth`, `minHeight`, `maxWidth`, and `maxHeight`.

The extension MAY throttle or coalesce repeated content-driven frame updates, but it SHALL NOT leave an obviously oversized fixed shell around a small Lynx page when default fit-content mode is active.

#### Scenario: Default Lynx window fits content

- **GIVEN** a caller shows a Lynx bundle without explicit fixed size
- **WHEN** the first visible layout stabilizes
- **THEN** the extension sizes the native window according to fit-content policy
- **AND** the user does not see a large arbitrary dead margin around the page by default.

#### Scenario: Caller can disable fit-content

- **GIVEN** a caller shows a Lynx bundle with `fitContentSize: false`
- **WHEN** the extension launches the window
- **THEN** the extension uses the caller's fixed or fallback host size strategy
- **AND** it does not keep applying content-fit updates.

#### Scenario: Explicit width and height win over default fit-content

- **GIVEN** a caller shows a Lynx bundle with `fitContentSize` enabled and explicit `width` and `height`
- **WHEN** the extension launches the window
- **THEN** the native window starts from the explicit size
- **AND** the content-fit policy does not override those explicit dimensions unless a future command requests it.

#### Scenario: Fit-content respects bounds

- **GIVEN** a caller shows a Lynx bundle with `fitContentSize` enabled and min/max size bounds
- **WHEN** the content-driven size is computed
- **THEN** the final native window frame is clamped to the configured bounds
- **AND** the extension emits frame-change events using the clamped size.
