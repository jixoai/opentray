## ADDED Requirements

### Requirement: Webview SHALL expose navigator-owned window controls

The WebView extension SHALL expose native window controls to page JavaScript through `navigator.window` and `navigator.opentrayWindow` when the feature is enabled for the shown WebView. Both properties SHALL reference the same capability object. `navigator.window` SHALL be the promoted public surface, while `navigator.opentrayWindow` SHALL remain the OpenTray-prefixed fallback for future standards conflict.

The capability object SHALL expose a Tauri-consistent scoped facade with asynchronous `invoke`, `listen`, and `once` methods. High-level asynchronous methods for `close`, `move`, `moveTo`, `resize`, `resizeTo`, `getStyle`, `setStyle`, and `getCapabilities` SHALL be implemented as wrappers over `invoke`. DOM-style `addEventListener` and `removeEventListener` MAY be provided as compatibility wrappers over `listen`, but SHALL NOT be the only event API.

The scoped `invoke` method SHALL accept only WebView window capability commands owned by this extension. It SHALL NOT expose a generic daemon RPC surface. The capability object SHALL NOT expose raw native handles, Wry internals, or the private channel object.

#### Scenario: Page uses navigator window controls

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page reads `navigator.window` and `navigator.opentrayWindow`
- **THEN** both properties exist
- **AND** both properties reference the same capability object
- **AND** the page can call `invoke`, `listen`, and async window-control wrapper methods without importing OpenTray facade code.

#### Scenario: High-level methods delegate to scoped invoke

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `navigator.window.resizeTo(480, 320)`
- **THEN** the injected API sends the same scoped native request as `navigator.window.invoke("resizeTo", { "width": 480, "height": 320 })`
- **AND** it resolves or rejects the returned promise through the same callback-id response path.

#### Scenario: Event subscription follows Tauri-style listen

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `await navigator.window.listen("resized", handler)`
- **THEN** the injected API registers the handler as a callback id
- **AND** it sends a scoped native listen request
- **AND** it resolves to an unlisten function.

#### Scenario: Navigator API is not injected by accident

- **GIVEN** a WebView is shown without native window API enablement
- **WHEN** the page loads
- **THEN** the extension does not install `navigator.window`
- **AND** it does not install `navigator.opentrayWindow`.

### Requirement: Webview navigator protocol SHALL use an isolated private channel

The WebView extension SHALL route navigator window-control requests through isolated private internals owned by the injected capability object. The bottom transport SHALL be message-shaped, but it SHALL NOT use `window.postMessage`, SHALL NOT listen to the global `message` event, and SHALL NOT expose Wry's `window.ipc.postMessage` as OpenTray's public API.

The durable invoke shape SHALL include namespace `opentray.window`, command, success callback id, error callback id, payload, and optional request options. The injected internals SHALL maintain a callback table, provide unregister-once behavior for request callbacks, and provide a private `runCallback`-style entrypoint for native response and event delivery. The durable error payload SHALL be a typed error object.

The extension MAY implement native-to-JavaScript callback delivery with the underlying WebView engine's script evaluation primitive when no cleaner native event channel exists. If it does, that mechanism SHALL remain private to the internals boundary; public page code SHALL only see promises and listener callbacks.

#### Scenario: Page message traffic stays separate

- **GIVEN** page code uses `window.postMessage` for its own application messages
- **WHEN** OpenTray navigator window controls send native requests
- **THEN** OpenTray does not emit those requests through `window.postMessage`
- **AND** OpenTray does not consume page-owned global `message` events.

#### Scenario: Native channel remains hidden

- **GIVEN** a page inspects `navigator.window`
- **WHEN** it enumerates public properties
- **THEN** it sees only the supported `invoke`, `listen`, `once`, high-level capability methods, and optional compatibility event methods
- **AND** it cannot call a raw OpenTray channel directly.

#### Scenario: Invoke response uses callback ids

- **GIVEN** a page calls `navigator.window.invoke("getCapabilities")`
- **WHEN** the native extension returns success
- **THEN** the injected internals resolve the success callback id exactly once
- **AND** the error callback id is unregistered.

#### Scenario: Native event delivery uses registered listener callbacks

- **GIVEN** a page has called `await navigator.window.listen("moved", handler)`
- **WHEN** the native extension emits the `moved` event
- **THEN** the injected internals run the registered handler callback with event data
- **AND** no global `message` event is emitted or consumed.

### Requirement: Webview window operations SHALL be capability-gated and asynchronous

Window operations exposed through `navigator.window` SHALL return promises. The native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported transparency, blur, move, resize, or override behavior SHALL reject with a typed unsupported error instead of faking success.

Style state SHALL include the frameless and visual-effect concepts needed for future platform work, including transparency and background effect support. Blur, acrylic, vibrancy, and Windows transparency behavior SHALL remain best-effort capabilities and MUST NOT be forced when the platform implementation would be slow or unstable.

#### Scenario: Unsupported visual effect is explicit

- **GIVEN** a page calls `navigator.window.setStyle({ backgroundEffect: "blur" })`
- **AND** the current platform does not support blur cleanly
- **WHEN** the extension handles the request
- **THEN** the returned promise rejects with a typed unsupported error
- **AND** the native runtime does not enable a slow fake blur path.

#### Scenario: Capability metadata describes available operations

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states whether close, move, resize, transparency, background effects, and global overrides are supported
- **AND** the page can decide whether to render frameless custom chrome.

### Requirement: Webview global window overrides SHALL be opt-in

The WebView extension MAY bind selected standard-like globals such as `window.close`, `window.resizeTo`, and `window.moveTo` to the navigator capability object, but only when the WebView command explicitly enables global override mode. Global overrides SHALL be disabled by default.

When enabled, overrides SHALL delegate to the same private navigator channel and SHALL NOT create a second native-control protocol.

#### Scenario: Global overrides are disabled by default

- **GIVEN** a WebView is shown with native window API enabled
- **AND** global override mode is not enabled
- **WHEN** the page inspects `window.close` and `window.resizeTo`
- **THEN** OpenTray has not replaced those functions.

#### Scenario: Global overrides delegate to navigator window

- **GIVEN** a WebView is shown with global override mode enabled
- **WHEN** the page calls `window.close()`
- **THEN** the call delegates to `navigator.window.close()`
- **AND** the native side receives the same `opentray.window` method request as the navigator path.
