# webview-extension Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Webview SHALL be an extension atom

The webview capability SHALL live outside the kernel as `@opentray/ext-webview` and an equivalent native extension implementation. It SHALL expose typed commands for showing, hiding, navigating, evaluating JavaScript, and exchanging messages with web content. It SHALL not own surface lifecycle, tray lifecycle, lease cleanup, or backend selection.

The official native runtime SHALL now be owned by the WebView platform dylib itself. The daemon SHALL only forward WebView extension traffic through the generic extension host boundary and SHALL NOT be the place where released WebView runtime behavior is implemented.

#### Scenario: Webview command is routed through extension host

- **GIVEN** a client calls the webview facade for an existing tray
- **WHEN** the facade sends a `show` command
- **THEN** the Node client emits an `ext-command` frame with `ext` set to `webview`
- **AND** the kernel dispatches it through the registered webview extension instance.

### Requirement: Webview positioning SHALL depend on backend capabilities

The webview extension SHALL position a popup relative to the physical surface rect when rect capability is available. If rect capability is unavailable, it SHALL use a documented fallback such as cursor position or platform default anchoring. The fallback SHALL be visible in capability metadata or structured logs.

#### Scenario: Missing rect capability uses fallback

- **GIVEN** the Linux backend cannot provide a reliable physical tray rect
- **WHEN** the webview extension is asked to show a popup
- **THEN** it does not assume a fake rect
- **AND** it uses the configured fallback positioning strategy.

### Requirement: Webview lifecycle SHALL be scoped to surface tray and lease

The webview extension SHALL associate each popup instance with a surface/tray scope and the owning lease. Lease cleanup SHALL hide or destroy webview state owned by the disconnected client without affecting webview state owned by other leases.

#### Scenario: Lease cleanup closes owned popup

- **GIVEN** a client shows a webview popup for its tray
- **WHEN** that client disconnects
- **THEN** the kernel closes or invalidates the webview instance owned by that lease
- **AND** other clients' webview instances remain unaffected.

### Requirement: Webview facade SHALL be typed and platform-neutral

The TypeScript `@opentray/ext-webview` facade SHALL depend only on `opentray` public contracts and `@opentray/spec` types. It MUST NOT import platform binary packages, Rust backend implementation details, or private kernel protocol internals.

The facade SHALL remain a platform-neutral contract layer even after the native runtime moves fully into `@opentray/ext-webview-<os>-<arch>` dynamic libraries. It SHALL not rely on daemon-side WebView parsers or hidden daemon-owned WebView runtime behavior.

#### Scenario: Webview package stays platform neutral

- **GIVEN** `@opentray/ext-webview` is installed in a project
- **WHEN** its public exports are inspected
- **THEN** they expose typed webview commands and events
- **AND** they do not require importing any `@opentray/<platform>` binary package directly.

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

### Requirement: WebView platform dylib SHALL own the public WebView protocol end-to-end

The official WebView native library SHALL parse `show`, `hide`, `navigate`, `evaluate`, and `postMessage` commands itself and SHALL emit the resulting scoped extension events itself. `opentray` SHALL forward these commands through the generic extension host law and SHALL NOT keep a daemon-side shadow parser or shadow event builder for WebView payloads.

#### Scenario: The platform library owns WebView command parsing

- **GIVEN** the `@opentray/ext-webview` facade sends an `ext-command`
- **WHEN** the daemon dispatches that command to the platform library
- **THEN** the platform library validates and interprets the WebView command payload
- **AND** the daemon does not keep a second implementation of the same WebView protocol outside the extension artifact.

### Requirement: WebView native runtime SHALL behave like a standalone binary packaged as a dylib

The official WebView native implementation SHALL own its default HTML, native window lifecycle, platform runtime dependencies, and runtime state inside `@opentray/ext-webview-<os>-<arch>`. Packaging it as a dynamic library SHALL NOT move that ownership back into the daemon binary.

#### Scenario: Missing library does not fall back to daemon-owned WebView runtime

- **GIVEN** no discoverable WebView platform library exists
- **WHEN** a client requests `load-ext webview`
- **THEN** the daemon returns a structured extension loading error
- **AND** it does not create a daemon-internal WebView runtime as a fallback.

### Requirement: WebView native extension provider SHALL ship as platform dynamic libraries

The official WebView native extension provider SHALL be distributed through `@opentray/ext-webview-<os>-<arch>` platform packages. `@opentray/ext-webview` SHALL remain a platform-neutral TypeScript facade and SHALL NOT include all platform libraries in one package.

The platform packages SHALL contain the native dynamic library artifact at a documented package-adjacent path. The facade MAY declare platform packages as optional dependencies only if doing so does not force platform imports into the public facade API.

#### Scenario: WebView facade stays platform-neutral

- **GIVEN** `@opentray/ext-webview` is imported by an application
- **WHEN** its public exports are evaluated
- **THEN** it exposes only typed WebView commands/events over OpenTray public contracts
- **AND** it does not import `@opentray/ext-webview-<os>-<arch>` directly from public API code.

#### Scenario: WebView platform library is package-adjacent

- **GIVEN** the current platform WebView package is installed
- **WHEN** the daemon resolves extension `webview`
- **THEN** it can locate the package-adjacent dynamic library path
- **AND** it loads the library through the generic dynamic extension host boundary.

### Requirement: WebView command behavior SHALL remain visually testable after dynamic split

The dynamically loaded WebView extension SHALL support `show`, `hide`, `navigate`, `evaluate`, and `postMessage` commands with the same public facade semantics as the current internal adapter. `show`, `postMessage`, and `evaluate` SHALL remain human-visible in the first-stage demo.

The dynamic library SHALL be the required WebView extension registration path. The daemon MAY own the native event-loop/window capability as a host capability, but it SHALL NOT register a daemon-internal WebView extension fallback when the dynamic library is missing.

#### Scenario: Dynamic WebView extension preserves visual demo

- **GIVEN** the daemon loaded the WebView dynamic library
- **WHEN** the npm-installed demo sends WebView commands
- **THEN** `Show HTML` opens a native WebView window
- **AND** `Post Message` and `Evaluate JS` visibly update the window
- **AND** terminal logs show extension-host command/event traffic.

#### Scenario: Missing dynamic library does not register internal WebView

- **GIVEN** no WebView dynamic library is discoverable
- **WHEN** a client requests `load-ext webview`
- **THEN** the daemon returns a structured extension loading error
- **AND** it does not register an internal WebView provider as a fallback.

### Requirement: WebView unsupported capability SHALL be explicit

If a platform package exists but the native WebView runtime cannot create a visible window on that host, the extension SHALL return a structured unsupported or capability error. It SHALL NOT report success for a fake invisible WebView.

#### Scenario: Unsupported native WebView does not fake success

- **GIVEN** a platform lacks the required native WebView capability at runtime
- **WHEN** the client sends `show`
- **THEN** the WebView extension returns a typed unsupported/capability error
- **AND** the demo prints that failure as acceptance evidence rather than pretending the window appeared.
