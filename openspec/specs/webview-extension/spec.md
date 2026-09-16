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

The webview extension SHALL associate each window session with its owning App/Tray/Session identity — the owner tuple `(appId, trayId, sessionId)` — plus the owning lease. Every window session, webview, layout document, and message channel created by the extension SHALL be tagged with this owner tuple in protocol frames and native state, and cleanup SHALL be keyed by it: a session-close callback SHALL destroy exactly the webviews, layouts, and channels whose owner tuple matches that session, and SHALL NOT touch state owned by any other live session. A tray scope SHALL own at most one active WebView window session per extension instance: creating a second window session for the same tray SHALL fail at creation with the typed error `tray_session_active` before any window state exists. A window session SHALL host one or more webview instances as sibling native views inside the window, addressed by webview id unique within the window session; the session SHALL remain valid as webviews are created and destroyed within it. Lease cleanup SHALL hide or destroy all webview state owned by the disconnected client without affecting webview state owned by other leases.

`hide` SHALL make the tray-scoped window session invisible without destroying its page runtimes. Re-showing the same tray with a compatible session SHALL reuse that session instead of replacing it. Explicit destroy, lease cleanup, or extension deinitialization SHALL destroy the owned session together with every webview instance it hosts and their page runtimes cleanly.

Compatibility SHALL be defined by the bootstrap-immutable portion of the session contract, not by mutable shell state. Size, position, title, icon, and supported live style fields MAY update on a reused session. Bootstrap-level navigator injection, global binding, source-policy, sync-policy, and equivalent page-bridge settings SHALL NOT be silently changed under an existing page runtime.

#### Scenario: Re-show preserves the existing tray session

- **GIVEN** a client has already shown a WebView window for its tray
- **AND** that window has been hidden instead of destroyed
- **WHEN** the same tray receives another compatible `show`
- **THEN** the extension reuses the existing session
- **AND** the page runtimes remain available instead of being replaced.

#### Scenario: Destroy removes the owned tray session

- **GIVEN** a tray has an active WebView session
- **WHEN** the client sends the explicit destroy command
- **THEN** the extension destroys the native slot and every hosted webview's page runtime for that tray
- **AND** a subsequent `show(...)` creates a new session from scratch.

#### Scenario: A second session for the same tray is a typed rejection

- **GIVEN** a tray with an active WebView window session
- **WHEN** a caller creates another window session for that same tray
- **THEN** creation SHALL fail with the typed error `tray_session_active`
- **AND** the existing session, its webviews, and its layout SHALL remain untouched

#### Scenario: Session cleanup is scoped to the closing session only

- **GIVEN** two live sessions of the same app on distinct trays share a broker, each hosting a multi-webview window
- **WHEN** one session closes
- **THEN** only that session's window, its webviews, its layout, and its message channels SHALL be destroyed
- **AND** the other session's windows, webviews, and channels SHALL remain alive and observable

#### Scenario: Lease cleanup closes owned popup

- **GIVEN** a client shows a webview popup for its tray
- **WHEN** that client disconnects
- **THEN** the kernel closes or invalidates the webview session owned by that lease
- **AND** other clients' webview sessions remain unaffected.

### Requirement: Webview facade SHALL be typed and platform-neutral

The facade SHALL remain platform-neutral while also exporting host-side placement helpers. These helpers SHALL depend only on public `opentray` and `@opentray/spec` contracts plus WebView facade types.

#### Scenario: Placement helper stays outside the core

- **GIVEN** a developer imports `WebviewPlacementKit`
- **WHEN** the package is evaluated
- **THEN** it does not import native platform packages
- **AND** it does not add WebView placement logic to `opentray-core`.

### Requirement: Webview SHALL expose navigator-owned window controls

The WebView extension SHALL expose native window controls to page JavaScript through `navigator.window` and `navigator.opentrayWindow` when the feature is enabled for the shown WebView. Both properties SHALL reference the same capability object. `navigator.window` SHALL be the promoted public surface, while `navigator.opentrayWindow` SHALL remain the OpenTray-prefixed fallback for future standards conflict.

The capability object SHALL expose a Tauri-consistent scoped facade with asynchronous `invoke`, `listen`, and `once` methods. High-level asynchronous methods for `close`, `move`, `moveTo`, `resize`, `resizeTo`, `minimize`, `maximize`, `restore`, `getWindowState`, `isMaximized`, `isMinimized`, `getStyle`, `setStyle`, `getCapabilities`, `getTitle`, `setTitle`, `getIcon`, and `setIcon` SHALL be implemented as wrappers over `invoke`. DOM-style `addEventListener` and `removeEventListener` MAY be provided as compatibility wrappers over `listen`, but SHALL NOT be the only event API.

Change events SHALL be subscription-driven. The extension SHALL NOT push page callbacks for `stylechange`, `titlechange`, `iconchange`, `windowstatechange`, geometry, or similar native state changes unless the page has registered a relevant listener. When a change event has a corresponding query method, the event payload SHALL align with the query result shape.

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

#### Scenario: Window metadata methods stay inside the same navigator family

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `await navigator.window.setTitle("OpenTray Status")`
- **THEN** the change uses the same extension-owned window capability object and private bridge family
- **AND** the page does not need a second metadata-specific API surface.

#### Scenario: Event subscription follows Tauri-style listen

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `await navigator.window.listen("resized", handler)`
- **THEN** the injected API registers the handler as a callback id
- **AND** it sends a scoped native listen request
- **AND** it resolves to an unlisten function.

#### Scenario: State-change event payload matches the query method

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page listens to `windowstatechange`
- **AND** the native runtime emits a state change
- **THEN** the event payload matches the `getWindowState()` payload shape
- **AND** no callback is pushed when there is no listener for the event.

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

Window operations exposed through `navigator.window` SHALL return promises. The native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported move, resize, shell, material, corner, opacity, or override behavior SHALL reject with a typed unsupported or rejected error instead of faking success.

The common window shell state SHALL be limited to traits with stable cross-platform meaning, including frameless intent, transparent backing intent through the background atom, keep-on-top intent, and whole-window opacity. Platform-specific material families, backdrop families, and detailed corner families SHALL be expressed through the platform-specific capability namespaces rather than the common `style` bag.

#### Scenario: Unsupported platform-specific appearance remains explicit

- **GIVEN** a page or host requests a platform-specific appearance family for a substrate the current runtime does not support
- **WHEN** the extension validates that request
- **THEN** the returned promise rejects with a typed unsupported error
- **AND** the runtime does not silently ignore the platform-specific style family.

#### Scenario: Capability metadata distinguishes common shell support from platform substrate support

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states which common shell traits are supported
- **AND** it separately states which platform-specific appearance families are available for the current runtime
- **AND** the page can choose a portable or substrate-specific path intentionally.

#### Scenario: Opacity capability is reported separately from background capability

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds from a runtime that supports whole-window alpha
- **THEN** the result reports opacity support as a common shell capability
- **AND** background/material support remains reported through the existing background and platform capability fields.

### Requirement: Webview global window overrides SHALL be opt-in

The WebView extension MAY bind selected standard-like globals such as `window.close`, `window.resizeTo`, `window.moveTo`, and `window.getScreenDetails` to extension-owned capability objects, but only when the WebView command explicitly enables the relevant global override mode. Global overrides SHALL be disabled by default.

When enabled, overrides SHALL delegate to the same private navigator capability family and SHALL NOT create a second native-control protocol.

#### Scenario: Global overrides are disabled by default

- **GIVEN** a WebView is shown with native window API enabled
- **AND** global override mode is not enabled
- **WHEN** the page inspects `window.close`, `window.resizeTo`, and `window.getScreenDetails`
- **THEN** OpenTray has not replaced those functions.

#### Scenario: Global overrides delegate to navigator families

- **GIVEN** a WebView is shown with global override mode enabled for window and screen bindings
- **WHEN** the page calls `window.close()` and `await window.getScreenDetails()`
- **THEN** the calls delegate to `navigator.window.close()` and `navigator.screen.getScreenDetails()`
- **AND** the native side receives those requests through the same extension-owned capability families as the navigator paths.

### Requirement: WebView platform dylib SHALL own the public WebView protocol end-to-end

The official WebView native library SHALL parse `show`, `hide`, explicit destroy, explicit content replacement, `navigate`, `evaluate`, and `postMessage` commands itself and SHALL emit the resulting scoped extension events itself. `opentray` SHALL forward these commands through the generic extension host law and SHALL NOT keep a daemon-side shadow parser or shadow event builder for WebView payloads.

The same dylib SHALL also decide session-compatibility checks and the rejection path for implicit reload attempts on existing sessions. `opentray` SHALL NOT keep a daemon-side shadow implementation for those session semantics.

#### Scenario: The platform library owns WebView lifecycle parsing

- **GIVEN** the `@opentray/ext-webview` facade sends a lifecycle-shaped `ext-command`
- **WHEN** the daemon dispatches that command to the platform library
- **THEN** the platform library validates and interprets the WebView lifecycle payload
- **AND** the daemon does not keep a second implementation of the same session law outside the extension artifact.

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

Unsupported truth SHALL remain classified rather than vague. Runtime absence, platform-family mismatch, and declarative gate failures SHALL remain distinguishable in runtime behavior and official guidance. When the capability family already defines an availability result shape, missing authoritative session data SHALL be reported through that availability result rather than by pretending the whole capability is unsupported.

#### Scenario: Unsupported native WebView does not fake success

- **GIVEN** a platform lacks the required native WebView capability at runtime
- **WHEN** the client sends `show`
- **THEN** the WebView extension returns a typed unsupported/capability error
- **AND** the demo prints that failure as acceptance evidence rather than pretending the window appeared.

#### Scenario: Wrong platform family does not fake portable support

- **GIVEN** the macOS runtime receives a real `platform.windows` window-style request
- **WHEN** the extension validates that request
- **THEN** it rejects the request as a platform-family mismatch
- **AND** it does not silently treat the Windows family as a portable style field.

#### Scenario: Missing tray anchor does not impersonate runtime failure

- **GIVEN** a tray-scoped WebView page requests tray bounds
- **AND** the session currently has no authoritative tray anchor data
- **WHEN** the extension resolves the request
- **THEN** it returns the tray availability result with an unavailable kind/source
- **AND** it does not claim that tray bounds are unsupported on the whole runtime.

### Requirement: Webview macOS runtime SHALL keep internal capability families modular

As the WebView extension grows window metadata, screen, style, sync, and policy responsibilities, the macOS runtime SHALL keep those capability families in separate internal modules rather than a single monolithic source file. This modularity requirement exists to preserve extension-atom ownership without turning one file into a second untyped platform layer.

The module split does not change the public protocol, but it SHALL keep bootstrap script concerns, style projection, metadata projection, and screen projection in explicit internal boundaries that future platform work can extend safely.

#### Scenario: macOS runtime keeps capability families separate

- **GIVEN** the macOS WebView runtime handles style, metadata, screen, and bootstrap concerns
- **WHEN** a maintainer reads the native extension source
- **THEN** those concerns live in separate internal modules or files
- **AND** adding a new capability family does not require growing one giant catch-all runtime file further.

### Requirement: Webview window overlay SHALL be extension-owned and standard-like

The WebView extension SHALL expose a titlebar overlay capability through `navigator.opentrayWindow.overlay` when native window API and overlay support are enabled for the shown page. The overlay surface SHALL use the `windowControlsOverlay` mental model, but it SHALL NOT claim to polyfill CSS `env(titlebar-area-*)` values unless the runtime can actually provide those environment variables.

The overlay capability SHALL expose `visible`, `getTitlebarAreaRect()`, and event subscription for geometry changes. The returned rect SHALL be page-viewport-relative, so page code can position custom titlebar content without native coordinate conversion.

#### Scenario: Page reads titlebar overlay geometry

- **GIVEN** a WebView is shown with native window API and overlay enabled
- **WHEN** page code calls `await navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **THEN** the extension resolves a viewport-relative rect for custom titlebar content
- **AND** the rect avoids the native window control cluster when native controls are visible.

#### Scenario: Overlay does not claim CSS env support

- **GIVEN** a WebView page uses the OpenTray overlay API
- **WHEN** the runtime cannot inject `env(titlebar-area-*)`
- **THEN** the public contract remains `navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **AND** the extension does not document or expose a fake CSS environment variable polyfill.

### Requirement: Webview custom app region drag SHALL use native tracking

The WebView extension SHALL expose `startAppRegionDrag(...)` and `stopAppRegionDrag()` on the navigator window capability object. These methods SHALL represent the narrow app-region drag action, not generic window movement. Implementations MUST use native drag tracking when available and MUST reject with a typed unsupported error rather than silently falling back to repeated `moveTo` calls.

The native runtime SHALL automatically stop drag tracking when the mouse button is released, the tracking monitor is removed, or the owning WebView slot is closed.

#### Scenario: Custom titlebar starts native drag tracking

- **GIVEN** a page renders a custom titlebar over the WebView
- **WHEN** a pointer-down handler calls `await navigator.opentrayWindow.startAppRegionDrag()`
- **THEN** the native runtime starts platform drag tracking for the window
- **AND** the window follows the pointer with native titlebar-like behavior.

#### Scenario: Drag tracking stops automatically

- **GIVEN** app-region drag tracking is active
- **WHEN** the user releases the mouse button or the page calls `stopAppRegionDrag()`
- **THEN** the extension stops native tracking
- **AND** later mouse movement no longer moves the window.

### Requirement: Webview window state controls SHALL include commands and state query

The WebView extension SHALL expose `minimize()`, `maximize()`, and `restore()` as high-level asynchronous methods on the navigator window capability object. These methods SHALL delegate to the same scoped private invoke path as existing window controls and SHALL stay outside the overlay object.

The same capability object SHALL expose `getWindowState()`, `isMaximized()`, and `isMinimized()` so custom chrome can render stable button state without guessing from the last command it sent. `minimize()`, `maximize()`, `restore()`, and `windowstatechange` SHALL use the same window-state payload shape as `getWindowState()`.

#### Scenario: Page controls native window state

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `navigator.opentrayWindow.minimize()`, `maximize()`, or `restore()`
- **THEN** the native runtime applies the requested window state
- **AND** the request travels through the extension-owned `opentray.window` channel.

#### Scenario: Page reads native window state

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `await navigator.opentrayWindow.getWindowState()`
- **THEN** the result states whether the window is `normal`, `minimized`, or `maximized`
- **AND** `isMaximized()` and `isMinimized()` resolve booleans from the same native state.

### Requirement: Overlay and drag capability SHALL stay inside ext-webview

The overlay geometry, custom app-region drag, and window-state controls SHALL be parsed and handled inside `crates/opentray-ext-webview`. `opentray-core`, `opentray-bin`, and the generic extension host SHALL NOT grow WebView-specific branches for these capabilities.

#### Scenario: Core remains unaware of overlay and drag

- **GIVEN** the page uses overlay and drag capabilities
- **WHEN** native requests are inspected
- **THEN** `crates/opentray-ext-webview` handles the request
- **AND** the core broker remains a generic extension-command forwarder.

### Requirement: Webview style SHALL support adjustable corner radius

The WebView extension SHALL include `cornerRadius` in the durable window style state. `cornerRadius` SHALL be a numeric logical radius measured in CSS-like pixels. Omitted or `null` radius SHALL preserve the platform's default shell behavior. A numeric radius SHALL be validated, clamped to a safe non-negative range, reported by `getStyle()`, and projected into native window/content clipping when the platform supports it.

On macOS, the runtime MAY implement rounded corners with a layer-backed content view and `CALayer` clipping. Unsupported platforms MUST reject or report lack of support explicitly rather than claiming a rounded shell that does not exist.

#### Scenario: Page sets rounded corners

- **GIVEN** a WebView window is shown with native window API enabled
- **WHEN** the page calls `navigator.window.setStyle({ cornerRadius: 18 })`
- **THEN** the native runtime clips the window content to the requested radius when supported
- **AND** `navigator.window.getStyle()` reports `cornerRadius: 18`.

#### Scenario: Unset corner radius preserves system behavior

- **GIVEN** a WebView window is shown without a corner-radius style
- **WHEN** the window is created
- **THEN** the extension preserves the platform default corner behavior
- **AND** it does not force a hard-coded radius.

### Requirement: Webview material background SHALL use real native visual effects

The WebView extension SHALL use native platform visual effects for background material or blur. On macOS, supported `backgroundEffect` values SHALL be implemented with the existing AppKit/Wry window plus `window-vibrancy` path. The runtime MUST NOT implement a fake page-level blur to claim that the native window background is blurred.

The material path SHALL keep the WebView and NSWindow backgrounds clear when a material is active, so the native visual effect can blur content behind the window.

#### Scenario: Material blur sees behind the window

- **GIVEN** a WebView window has a supported background material enabled
- **WHEN** the page content leaves a transparent area
- **THEN** the native material layer can blur content behind the native window
- **AND** the page is not merely rendering a CSS-only blur.

### Requirement: Borderless transparent shell SHALL remain a style projection

The WebView extension SHALL project borderless, transparent, material, and rounded-corner state through `getStyle()` / `setStyle()` and declarative `show(...).style`. These shell concerns SHALL remain inside the WebView extension atom and SHALL NOT add WebView-specific behavior to the core broker or daemon.

#### Scenario: Borderless shell is controlled by style state

- **GIVEN** a WebView window is shown with `style.frameless`, `style.transparent`, `style.backgroundEffect`, and `style.cornerRadius`
- **WHEN** the native macOS runtime creates the window
- **THEN** it applies those values as native window style projection
- **AND** the daemon does not parse or apply those WebView-specific fields.

### Requirement: Webview SHALL project tray bounds into navigator.opentray.tray

The WebView extension SHALL expose tray placement to page JavaScript through `navigator.opentray.tray`, still as the page projection of the tray-owned capability family. The page API SHALL remain tray-scoped rather than host- or space-scoped, because the measured anchor is the current tray contribution.

This change SHALL allow the tray placement result to carry provenance instead of collapsing everything to `Rect | null`. The resolved result SHALL expose at least `kind`, `source`, and `rect`.

#### Scenario: Page sees provenance-bearing tray placement

- **GIVEN** a WebView page calls the tray placement API
- **WHEN** the extension resolves a result
- **THEN** the result says whether placement is authoritative or unavailable through `kind`
- **AND** it exposes the source explanation
- **AND** page code reads the rectangle through `result.rect` instead of assuming the entire result is a bare `Rect`.

#### Scenario: Tray capability stays under the tray namespace

- **GIVEN** the page bridge exposes tray placement
- **WHEN** a developer inspects the navigator surface
- **THEN** the capability lives under `navigator.opentray.tray`
- **AND** the extension does not rename the measured atom as `host` or `space`.

### Requirement: Webview tray capability SHALL follow declarative source policy

Tray-bounds projection into the page SHALL follow the same declarative capability-policy mindset as window and screen projection. The WebView `show(...)` contract SHALL be able to gate tray capability independently from window and screen capability. Remote content SHALL NOT receive tray bounds by accident.

The page bridge MAY use a dedicated tray capability family such as `tray` in the existing policy structure. The tray capability SHALL not be implicitly granted merely because `nativeWindowApi` or `nativeScreenApi` is enabled.

#### Scenario: Remote page does not receive tray bounds by accident

- **GIVEN** a WebView is shown with remote URL content
- **AND** no tray capability policy explicitly allows that source
- **WHEN** the page loads
- **THEN** `navigator.opentray.tray` is absent or denies tray-bounds access
- **AND** the extension does not widen the page bridge accidentally.

#### Scenario: Tray capability can diverge from window and screen

- **GIVEN** a WebView is shown with a declarative native capability policy
- **WHEN** the policy allows tray capability for the current source but denies screen capability
- **THEN** the page may call `navigator.opentray.tray.getBounds()`
- **AND** it still does not receive `navigator.screen`.

### Requirement: Webview window session architecture SHALL stay extension-owned

The WebView extension SHALL own a tray-scoped window session law inside the extension atom itself. `opentray-core` and `opentray-bin` SHALL continue to forward generic extension traffic and SHALL NOT become the place where repeated `show`, `hide`, destroy, or content-replacement semantics are interpreted.

The WebView session law SHALL remain distinct from the Lynx runtime law. The Lynx extension MAY replace a short-lived child process on repeated `show`, but the WebView extension SHALL treat page runtime continuity as a first-class concern and SHALL define its own explicit session semantics instead of inheriting the Lynx behavior by analogy.

#### Scenario: Architecture law stays visible

- **GIVEN** the WebView extension needs to distinguish visibility, session destruction, and content replacement
- **WHEN** the lifecycle contract is implemented
- **THEN** that distinction is owned by `@opentray/ext-webview` and `crates/opentray-ext-webview`
- **AND** the kernel and daemon do not grow WebView-specific lifecycle branches.

### Requirement: Webview window session data shape SHALL separate session, shell, and page runtime

The WebView extension SHALL preserve three durable state domains instead of collapsing them into one ambiguous “window” concept:

- `WindowSessionIdentity`: tray scope, bootstrap-immutable capability settings, and current content descriptor
- `WindowShellState`: visibility, size, position, title, icon, and native style
- `PageRuntimeState`: the live JS/DOM context, including transient UI state such as scroll, form input, and in-page caches

`hide()` SHALL affect `WindowShellState` visibility only. Explicit content replacement SHALL replace `PageRuntimeState` and update the current content descriptor. Explicit destroy SHALL invalidate the whole session.

#### Scenario: Data law stays visible

- **GIVEN** a WebView session has live page state
- **WHEN** the host hides and later re-shows the same tray window
- **THEN** only shell visibility changes
- **AND** the page runtime state remains intact.

### Requirement: Webview content replacement SHALL be explicit

The WebView extension SHALL NOT treat repeated `show(...)` as an implicit page reload path for an already-active compatible session. `show(...)` is the visibility and session-bootstrap verb. Content replacement SHALL use an explicit command surface.

The public command family SHALL include an explicit content-replacement command that can replace either host HTML or URL content. `navigate(url)` MAY remain as a URL-focused alias, but it SHALL be semantically equivalent to an explicit content replacement request rather than a second hidden lifecycle path.

If a caller sends `show(...)` against an existing compatible session and also supplies content that would differ from the active content descriptor, the extension SHALL reject that request explicitly and direct the caller toward the content-replacement or destroy path. It SHALL NOT silently reload the page runtime behind a visibility verb.

#### Scenario: Re-show preserves page runtime

- **GIVEN** a tray already has a compatible hidden WebView session with local HTML content
- **WHEN** the host calls `show(...)` again for that tray
- **THEN** the extension makes the existing window visible
- **AND** it preserves the existing page runtime instead of reloading the HTML.

#### Scenario: Show rejects implicit content replacement

- **GIVEN** a tray already has an active WebView session
- **WHEN** the host calls `show(...)` with a different HTML payload or URL for that same session
- **THEN** the extension rejects the request with an explicit typed error
- **AND** it tells the caller to use the content-replacement or destroy path instead of silently reloading.

### Requirement: Webview cross-platform window contract SHALL separate common and platform-specific capability families

The WebView extension SHALL keep the common page/window contract limited to capabilities with stable cross-platform meaning: lifecycle, title/icon metadata, frameless shell intent, transparent shell intent, keep-on-top intent, overlay, drag, geometry, window-state controls, screen details, tray placement access, and capability-policy gating.

Platform-native appearance substrate and desktop-standard-specific behavior SHALL live under explicit platform families instead of the common `style` bag. The durable family names for this change SHALL be `platform.macos`, `platform.windows`, and `platform.linux`, nested under the owning host option group and the owning page capability object.

Capability metadata SHALL describe both the common contract and the current platform family surface so callers can reason about truthful support without guessing from the OS name alone.

#### Scenario: Common and platform APIs stop collapsing into one style bag

- **GIVEN** a developer configures a WebView window for a specific desktop platform
- **WHEN** they inspect the host options or page capability object
- **THEN** common shell traits live in the common contract
- **AND** macOS-, Windows-, and Linux-specific material or corner controls live under the matching `platform.<family>` namespace
- **AND** the extension does not present platform-private nouns as universal style fields.

### Requirement: Webview official guidance SHALL teach the nested platform-family contract truthfully

The official `@opentray/ext-webview` README, CLI example docs, and repo skills SHALL teach material, corner, and tray-placement usage through the same nested platform-family contract that the public TypeScript surface exports.

The examples SHALL show provenance-bearing tray placement results and SHALL avoid reviving retired flat fields such as a top-level `backgroundEffect` or `cornerRadius` on the common style object.

#### Scenario: Docs and examples use the same contract the runtime exports

- **GIVEN** a developer follows the official docs or examples
- **WHEN** they configure a glass tray panel or read tray placement
- **THEN** they use `style.platform.macos.*` for macOS substrate controls
- **AND** they use `trayBounds.rect` from the provenance-bearing result when a fallback rect is required
- **AND** the docs do not teach the retired flat style shape.

### Requirement: Webview capability truth SHALL distinguish runtime absence, family mismatch, declarative gate, and context unavailability

The WebView extension SHALL keep four different support meanings distinct across runtime behavior, official docs, and skills:

- runtime absence: the current platform package or runtime cannot provide a visible WebView capability on this host
- family mismatch: a caller requested a platform-specific family on the wrong substrate
- declarative gate: the runtime could provide the capability, but the current WebView session did not enable it
- context unavailability: the capability exists, but the current session has no authoritative data for this request

The extension SHALL NOT collapse these meanings into one vague `unsupported` story in public guidance. Runtime absence and family mismatch MAY reject with typed unsupported errors. Declarative gate failures MAY reject with typed unsupported or rejected errors, but they SHALL remain distinguishable from runtime absence in message text and docs. Context unavailability SHALL prefer a structured availability result when the capability family already defines one.

#### Scenario: Runtime absence stays separate from family mismatch

- **GIVEN** a Linux runtime path has not yet landed a visible WebView implementation
- **WHEN** the caller asks the extension to show a WebView window
- **THEN** the extension returns a typed runtime-absence unsupported error
- **AND** that result is documented differently from requesting `platform.windows.*` on the macOS runtime.

#### Scenario: Declarative gate stays separate from runtime absence

- **GIVEN** a WebView session did not enable overlay support
- **WHEN** page code calls `navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **THEN** the extension reports that overlay is not enabled for this WebView
- **AND** it does not claim that the whole platform lacks overlay capability.

#### Scenario: Context unavailability stays a structured availability result

- **GIVEN** a page calls `navigator.opentray.tray.getBounds()`
- **AND** the current WebView session has no authoritative tray anchor data
- **WHEN** the extension resolves the request
- **THEN** the result uses the tray availability shape such as `kind`, `source`, and `rect`
- **AND** it does not collapse the request into a generic unsupported error.

### Requirement: Webview official guidance SHALL publish maturity truth together with capability truth

The official `@opentray/ext-webview` README, published CLI README, platform package READMEs, and repo skills SHALL describe capability maturity and platform truth together. When a capability is stable on macOS and Windows while Linux remains unsupported for WebView, the guidance SHALL say so directly.

This maturity guidance SHALL use the same public vocabulary as the runtime and spec surface. It SHALL avoid implying that a published platform package automatically means a stable visible runtime on that platform.

#### Scenario: Guidance teaches stable platform support without overstating Linux

- **GIVEN** a developer reads the official WebView docs and skills
- **WHEN** they inspect platform support for glass windows, overlay, screen details, or tray panels
- **THEN** the guidance states that macOS and Windows are current human-visual acceptance paths
- **AND** it states that Linux is unsupported for `@opentray/ext-webview` until a real native runtime atom lands
- **AND** it does not imply that Linux already has stable visible UI behavior.

### Requirement: Webview SHALL mount as a tray extension capability

The official `@opentray/ext-webview` facade SHALL export `WebviewExt` as a tray extension atom. A developer SHALL be able to mount it with `tray.extend(WebviewExt, options)` and receive a tray handle that exposes `createWebviewWindow(...)`.

`createWebviewWindow(...)` SHALL return a window handle with explicit lifecycle verbs such as `show`, `hide`, `destroy`, `setContent`, `navigate`, `evaluate`, and `postMessage`. The WebView package SHALL own those verbs and payloads; `opentray-core` SHALL not parse WebView commands.

#### Scenario: Developer mounts WebView on a tray

- **GIVEN** a developer holds a tray handle
- **WHEN** they call `tray.extend(WebviewExt).createWebviewWindow({ width: 360, height: 240 })`
- **THEN** the returned window handle can issue WebView commands
- **AND** the core SDK has not gained a WebView-specific branch.

### Requirement: Webview mount SHALL auto-load before first command

The WebView mount SHALL lazily ensure its native extension instance is loaded before sending the first `show`, `setContent`, `navigate`, `evaluate`, `postMessage`, `hide`, or `destroy` command for that mount. The load SHALL use the generic `load-ext` path with `name: "webview"`, the WebView package path, and the mount id selected by `tray.extend(...)`.

The load operation SHALL be idempotent for a WebView mount. Once loading succeeds, later commands from the same mount SHALL reuse the existing load promise and SHALL NOT issue duplicate `load-ext` requests.

#### Scenario: First WebView command auto-loads the mount

- **GIVEN** a developer mounted `WebviewExt` on a tray
- **WHEN** they call `window.show()` without manually sending `load-ext`
- **THEN** the facade first sends `load-ext` through the generic host law
- **AND** it then sends the WebView command to the mount id.

#### Scenario: Later commands reuse the loaded mount

- **GIVEN** the WebView mount has loaded successfully
- **WHEN** the developer calls `navigate(...)` or `hide()`
- **THEN** the facade sends only the command
- **AND** it does not repeat `load-ext` for every command.

### Requirement: Webview mount SHALL fail with an actionable load error

If automatic loading fails because the platform library is missing, package-adjacent resolution fails, or the extension host rejects the load, the initiating WebView command SHALL reject with a structured error that identifies the WebView extension and mount id.

The error path SHALL stay truthful. The facade SHALL NOT swallow a failed load and retry the WebView command as if the extension existed.

#### Scenario: Missing platform package surfaces a WebView load error

- **GIVEN** no discoverable WebView platform library exists
- **WHEN** the developer calls the first WebView command
- **THEN** the command rejects with an error code that identifies WebView extension loading
- **AND** the message points at the missing platform package or extension path.

### Requirement: Webview compatibility facade SHALL remain synchronous

`attachWebview(tray)` SHALL remain available as a synchronous compatibility adapter. It SHALL use the same automatic load law as `WebviewExt`, but it MAY default to the legacy `webview` mount id so existing raw `commandExtension("webview", ...)` and manual `load-ext webview` paths stay understandable during migration.

#### Scenario: Legacy facade remains usable

- **GIVEN** a developer still calls `attachWebview(tray)`
- **WHEN** they call `show(...)`
- **THEN** the command path auto-loads the WebView extension before dispatch
- **AND** the developer does not have to manually send `load-ext`.

### Requirement: Webview official guidance SHALL teach extension mounting

The official `@opentray/ext-webview` README and repo WebView examples SHALL teach the standard WebView path as `tray.extend(WebviewExt).createWebviewWindow(...)`. Guidance MAY mention `attachWebview(tray)` as a compatibility adapter, but ordinary consumers SHALL NOT be instructed to hand-author `load-ext` before using WebView.

#### Scenario: Docs show the ordinary consumer path

- **GIVEN** a developer reads the public WebView guidance
- **WHEN** they look for the standard usage pattern
- **THEN** the guidance starts from `tray.extend(WebviewExt)`
- **AND** it does not require a manual `load-ext` pre-step.

### Requirement: Webview host window handles SHALL expose geometry commands

`@opentray/ext-webview` host-side `WebviewWindowHandle` SHALL expose `moveTo(x, y)` and `resizeTo(width, height)`. These methods SHALL use the same extension command path as other WebView window verbs and SHALL remain owned by the WebView extension atom.

#### Scenario: Host code moves a WebView window

- **GIVEN** host code owns a `WebviewWindowHandle`
- **WHEN** it calls `moveTo` or `resizeTo`
- **THEN** the facade sends the corresponding WebView command through `TrayHandle.commandExtension`
- **AND** `opentray-core` does not parse WebView-specific geometry commands.

#### Scenario: Host code reads truthy bounds and constrains size

- **GIVEN** host code owns a `WebviewWindowHandle`
- **WHEN** it calls `getBounds()`, `setMinimumSize(...)`, or `setMaximumSize(...)`
- **THEN** the extension returns the native window bounds or applies native size constraints
- **AND** omitted size fields remain unchanged while `null` clears that constraint.

### Requirement: Webview page navigator SHALL expose reversible visibility commands

`navigator.opentrayWindow` and the optional `navigator.window` binding SHALL expose `show()` and `hide()` as reversible visibility controls on macOS and Windows. These commands SHALL NOT be aliases for content replacement or permanent close/destroy.

#### Scenario: Page hides and shows the same native window session

- **GIVEN** a page has the native window API enabled
- **WHEN** it calls `hide()` and later `show()`
- **THEN** the runtime updates native visibility for the same window session
- **AND** the command returns the current window state.

### Requirement: Webview extension SHALL provide a composable placement kit

`@opentray/ext-webview` SHALL export a placement utility class that can resolve and continuously apply common desktop placements without becoming a special tray-panel API. The utility SHALL accept injected authorities such as tray bounds, screen details, and cursor position.

Supported placements SHALL include `tray`, `cursor`, `screen-center`, `screen-top`, `screen-right`, `screen-bottom`, `screen-left`, `screen-top-left`, `screen-top-right`, `screen-bottom-left`, `screen-bottom-right`, `edge`, `edge-x`, `edge-y`, `edge-top`, `edge-right`, `edge-bottom`, and `edge-left`, plus `placementMargin`.

The extension SHALL expose a shared host-side geometry helper that treats public window, screen, and tray rectangles as desktop logical pixels. Placement and responsive helpers SHALL use this helper for normalization, screen selection, clamping, comparison, and native window application instead of applying browser DPR or platform-specific scaling in TypeScript helper code.

For `placement: "tray"`, the utility SHALL treat tray bounds as usable only when the rect has positive dimensions and, when screen details are available, the rect center belongs to a known screen frame or visible frame. A transient unusable tray rect SHALL NOT override a previous usable tray anchor in the same placement kit instance. If a previous usable tray anchor exists, the utility SHALL resolve from that last-good tray anchor and mark the result provenance with `last-good`; otherwise it SHALL use the normal portable fallback path with provenance.

#### Scenario: Developer places a lightweight panel from tray geometry

- **GIVEN** a developer has a tray handle and a WebView window handle
- **WHEN** they call `watch()` with `placement: "tray"`
- **THEN** it resolves the tray bounds through the injected tray authority
- **AND** it applies the computed size and position with WebView geometry commands
- **AND** it recomputes when subscribed placement dependencies or target bounds invalidate.

#### Scenario: One-shot placement remains explicit

- **GIVEN** a developer intentionally wants a single placement calculation
- **WHEN** they call `applyOnce()` or `once()`
- **THEN** it performs one calculation and does not keep a watch alive
- **AND** it rejects when a watch is already active for that target.

#### Scenario: Edge placement snaps from window bounds to a viewport edge

- **GIVEN** a target window has current bounds and screen details are available
- **WHEN** the developer watches `edge`, `edge-x`, or `edge-y`
- **THEN** the algorithm selects the nearest eligible viewport edge before resolving the final anchor.

#### Scenario: High-DPI placement uses one logical coordinate system

- **GIVEN** screen details include a high-DPI `scaleFactor`
- **AND** the target window bounds are already public OpenTray `Rect` values
- **WHEN** the placement kit resolves a screen-relative placement
- **THEN** the algorithm uses the logical `width`, `height`, `x`, and `y` values directly
- **AND** it does not multiply or divide by `devicePixelRatio` or the screen `scaleFactor`.

#### Scenario: Transient invalid tray bounds reuse the last good anchor

- **GIVEN** a placement kit previously resolved a valid tray anchor
- **AND** a later tray-bounds query returns a zero-size or off-screen rect
- **WHEN** the placement kit resolves `placement: "tray"`
- **THEN** it ignores the unusable rect
- **AND** it resolves from the previous usable tray anchor with `last-good` provenance.

#### Scenario: Portable placement falls back with provenance

- **GIVEN** a portable placement source is unavailable
- **WHEN** the placement kit resolves a position
- **THEN** it returns a documented fallback/provenance value instead of pretending the missing authority was native data.

### Requirement: Windows explicit resize SHALL refresh the host composition surface

The Windows WebView runtime SHALL refresh the native host surface after explicit resize commands using the same host-surface cleanup path that prevents transparent white-block artifacts. It SHALL NOT hide/show, maximize, or rebuild the WebView to clear resize residue.

#### Scenario: Page or host code resizes a Windows WebView window

- **GIVEN** a Windows WebView window is active
- **WHEN** host code or page code calls `resizeTo`
- **THEN** the runtime synchronously reapplies WebView client bounds
- **AND** it refreshes the attached host surface in place.

### Requirement: Webview extension SHALL expose responsive window helpers

`@opentray/ext-webview` SHALL export backend-only `styleKit` and `mediaQueryKit` helpers for responsive native window composition. `styleKit` SHALL compose initial size constraints, background material selection, and platform style patches. `mediaQueryKit` SHALL watch native window bounds and run callbacks on media-query state changes without mutating user HTML.

#### Scenario: A lightweight panel grows after crossing a width threshold

- **GIVEN** host code applies a compact panel recipe with `styleKit`
- **WHEN** the window width crosses a configured media-query threshold
- **THEN** `mediaQueryKit` can raise the minimum height or otherwise adjust native window style
- **AND** the page content remains owned by the app, not by injected DOM/CSS.

### Requirement: Webview window style SHALL expose whole-window opacity as common shell state

The WebView extension SHALL include `opacity` in the common durable window style state. `opacity` SHALL represent whole native-window shell alpha, not page CSS opacity and not background backing or material choice. The value SHALL be a finite number from `0` through `1`, defaulting to `1`.

`opacity` SHALL be accepted in declarative `show(...).style`, live `setStyle(...)`, host-side `WebviewWindowHandle.setStyle(...)`, and page-side `navigator.window.setStyle(...)`. `getStyle()` and `stylechange` payloads SHALL report the normalized `opacity` value using the same shape as the host/page TypeScript facade.

The runtime SHALL keep `opacity` orthogonal to `style.background`: requesting opacity MUST NOT imply `background: "transparent"`, semantic blur, or any platform material; requesting a transparent/material background MUST NOT imply a non-opaque window alpha.

#### Scenario: Opacity composes with material background

- **GIVEN** a WebView window is shown with `style.opacity: 0.72`
- **AND** `style.background` requests a platform material or semantic blur
- **WHEN** the native runtime creates or updates the window
- **THEN** the native shell alpha is projected as `0.72`
- **AND** the requested background material remains the source of backing/material behavior.

#### Scenario: Opacity does not mutate background ontology

- **GIVEN** a WebView window is shown with `style.opacity: 0.5`
- **AND** no `style.background` is supplied
- **WHEN** page or host code reads `getStyle()`
- **THEN** the result reports `opacity: 0.5`
- **AND** the result still reports the default opaque background.

#### Scenario: Invalid opacity is rejected

- **GIVEN** page or host code calls `setStyle({ opacity: 1.5 })`
- **WHEN** the WebView extension validates the request
- **THEN** the request rejects with a typed rejected error
- **AND** the current native window style is not changed.

### Requirement: Webview opacity projection SHALL remain inside the WebView extension atom

The WebView extension native runtime SHALL own the parsing, validation, state storage, native projection, and event payload for `style.opacity`. `opentray-core` and the broker daemon SHALL continue to forward extension traffic generically and SHALL NOT parse, normalize, or apply WebView opacity fields.

The extension SHALL use platform-native whole-window alpha APIs for supported runtime families. It MUST NOT inject or mutate user HTML/CSS to fake whole-window opacity.

#### Scenario: Core stays generic

- **GIVEN** host code sends a WebView `setStyle` command with `opacity`
- **WHEN** the command crosses the OpenTray extension host boundary
- **THEN** core and broker code forward it as extension data
- **AND** only the WebView extension runtime validates and applies the opacity field.

### Requirement: Webview SHALL support standard HTML download semantics

The WebView extension SHALL install native download handlers on the underlying webview engine so that standard HTML download triggers produce a real local file. A download trigger is any of: an `<a download="filename">` activation, a navigation to a `blob:` URL with a download disposition, or a response with a non-displayable MIME type that the engine routes to download. The extension SHALL NOT silently cancel download-triggered navigations the way an unconfigured webview engine does by default.

When the download capability is enabled for a shown WebView (the default), the extension SHALL route every triggered download through the operating system's standard Downloads directory (`~/Downloads` on macOS, `%USERPROFILE%\Downloads` on Windows) unless an opt-in saveAs policy is active. The extension SHALL deduplicate filename collisions by appending a numeric suffix, matching browser behavior.

The download capability SHALL be controlled by a top-level `download` option on the `show(...)` command. The option SHALL default to `{ enabled: true, saveAs: false }` so that trivial page code (e.g. `const a = document.createElement('a'); a.download = 'x.json'; a.click();`) works with zero additional configuration.

The extension SHALL report a typed unsupported error on platforms where the WebView runtime itself is unsupported, rather than faking a successful download. On Linux the download capability follows the overall `@opentray/ext-webview` Linux stance: unsupported by design.

#### Scenario: Anchor download attribute produces a local file

- **GIVEN** a WebView is shown with local HTML content and the default `download` option
- **WHEN** page code creates `<a download="report.json">` pointing at a `blob:` URL and clicks it
- **THEN** a file named `report.json` appears in the operating system's standard Downloads directory
- **AND** the page receives no unhandled navigation error.

#### Scenario: Filename collision does not overwrite

- **GIVEN** a file named `report.json` already exists in the Downloads directory
- **AND** a WebView is shown with the default `download` option
- **WHEN** page code triggers another download with `download="report.json"`
- **THEN** the new file is written as `report (1).json` (or the platform-equivalent deduplicated name)
- **AND** the pre-existing `report.json` is not overwritten.

#### Scenario: Download defaults to enabled with zero configuration

- **GIVEN** a WebView is shown with local HTML content and no explicit `download` option
- **WHEN** the page triggers a standard HTML download
- **THEN** the download proceeds to the Downloads directory
- **AND** the page did not have to call any extension-specific API to enable downloading.

#### Scenario: Disabled download option suppresses downloads

- **GIVEN** a WebView is shown with `download: { enabled: false }`
- **WHEN** the page triggers a standard HTML download
- **THEN** no file is written
- **AND** the extension does not crash or leave the webview in a broken navigation state.

#### Scenario: Unsupported platform does not fake download success

- **GIVEN** the host platform lacks a supported WebView runtime (e.g. Linux)
- **WHEN** a caller shows a WebView with the default `download` option
- **THEN** the extension reports a typed unsupported/capability error
- **AND** it does not claim a download succeeded.

### Requirement: Webview download SHALL be governed by the multipleDownloads permission family

The extension SHALL consult the existing `multipleDownloads` browser permission family before allowing a download to proceed. The permission decision SHALL follow the same `allow` / `deny` / `prompt` ontology already defined for other browser permission families, and the same per-origin source rule model.

Local page sources SHALL be allowed to download by default. Remote page sources SHALL be denied by default unless an explicit policy rule allows them. Until the carrier-owned native permission prompt substrate exists, a resolved `prompt` decision SHALL fail closed for downloads: the extension SHALL block the download and SHALL NOT introduce a parallel download-specific prompt UI.

The `multipleDownloads` permission family already exists in the TypeScript facade permission store and in the native permission policy parser; this requirement makes the platform webview builder actually consume it for download gating, removing the prior dead-code state where the family was parsed but never enforced.

#### Scenario: Local page download is allowed by default

- **GIVEN** a WebView is shown with local HTML content and no explicit `browserPermissionPolicy` for `multipleDownloads`
- **WHEN** the page triggers a standard HTML download
- **THEN** the download proceeds to the Downloads directory.

#### Scenario: Remote page download is denied by default

- **GIVEN** a WebView is shown with remote URL content and no explicit allow rule for `multipleDownloads`
- **WHEN** the page triggers a standard HTML download
- **THEN** the download is blocked
- **AND** no file is written to the Downloads directory.

#### Scenario: Explicit allow rule permits a remote download

- **GIVEN** a WebView is shown with remote URL content from `https://tools.example`
- **AND** the caller supplied `browserPermissionPolicy: { multipleDownloads: { sources: ["'https://tools.example'"], decision: "allow" } }`
- **WHEN** the page triggers a standard HTML download
- **THEN** the download proceeds to the Downloads directory.

#### Scenario: Prompt decision fails closed until the carrier prompt substrate exists

- **GIVEN** a WebView is shown with a `multipleDownloads` policy of `decision: "prompt"`
- **WHEN** the page triggers a standard HTML download
- **THEN** the extension blocks the download
- **AND** this change does not render its own download-specific prompt UI.

### Requirement: Webview saveAs SHALL be an explicit opt-in over the default silent download

The extension SHALL provide a `saveAs` flag on the `download` option, defaulting to `false`. When `saveAs` is `false`, downloads SHALL be written silently to the standard Downloads directory with filename deduplication, requiring no user interaction.

When `saveAs` is `true`, the extension SHALL present the operating system's native save-location dialog before writing the file. On macOS this SHALL be `NSSavePanel`, presented from inside the wry download-started handler so that the chosen path is written back to the download destination before the engine commits the file. On Windows this SHALL be the WebView2 native Save As behavior exposed through the `DownloadStarting` event.

If the user cancels the native save-location dialog, the extension SHALL NOT write any file, SHALL NOT treat the cancellation as a failure, and SHALL emit a `downloadcanceled` event to the page (see the download-events requirement).

#### Scenario: Default silent download writes without a dialog

- **GIVEN** a WebView is shown with the default `download` option (`saveAs: false`)
- **WHEN** the page triggers a standard HTML download
- **THEN** no save-location dialog is shown
- **AND** the file is written directly to the Downloads directory.

#### Scenario: saveAs true presents a native save dialog on macOS

- **GIVEN** a WebView is shown on macOS with `download: { saveAs: true }`
- **WHEN** the page triggers a download with suggested filename `backup.json`
- **THEN** an `NSSavePanel` is presented with `backup.json` as the suggested name
- **AND** when the user confirms a location, the file is written to that location.

#### Scenario: saveAs true presents native Save As on Windows

- **GIVEN** a WebView is shown on Windows with `download: { saveAs: true }`
- **WHEN** the page triggers a download
- **THEN** the WebView2 native Save As behavior is used
- **AND** no custom dialog implementation is rendered by this extension.

#### Scenario: User canceling saveAs does not write a file

- **GIVEN** a WebView is shown with `download: { saveAs: true }`
- **WHEN** the page triggers a download
- **AND** the user dismisses the native save-location dialog without choosing a path
- **THEN** no file is written
- **AND** the page receives a `downloadcanceled` event (not a `downloadfailed` event).

### Requirement: Webview SHALL expose download lifecycle events on the navigator window bus

The extension SHALL expose download lifecycle events through the existing `navigator.opentrayWindow` / `navigator.window` event bus (the same `listen` / `once` mechanism used by `windowstatechange`, `stylechange`, and similar native state changes). This change SHALL NOT introduce a separate download event namespace.

The download event set SHALL be exactly: `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled`. Event names SHALL NOT carry a `download:` prefix; they follow the same unprefixed naming convention as `moved`, `resized`, and `closed`.

Download events SHALL be subscription-driven: the extension SHALL NOT push download events to a page that has not registered a listener for that specific event. The `downloadcompleted` payload SHALL be uniform across platforms and SHALL NOT include the final filesystem path, because the underlying macOS engine limitation prevents reliably reporting the saved path; payloads SHALL carry `{ url, filename, suggestedFilename, success }` instead. The `downloadprogress` payload SHALL carry `{ url, filename, suggestedFilename, receivedBytes, totalBytes }` and leave percentage computation to the page. The `downloadstarted`, `downloadfailed`, and `downloadcanceled` payloads SHALL carry `{ url, filename, suggestedFilename }`.

On macOS the extension SHALL observe `WKDownload` progress via key-value observing so that `downloadprogress` is reliable; it SHALL NOT degrade macOS progress to a best-effort or absent signal. On macOS the extension SHALL preserve `WKDownloadDelegate`'s `suggestedFilename` separately from the final deduped basename. On Windows the extension SHALL preserve a distinct suggested filename only when the WebView2 substrate exposes one; it SHALL emit `suggestedFilename: null` rather than inventing a false source fact. On Windows the extension SHALL use the WebView2 `DownloadOperation` bytes-received state changes, which are natively reliable.

#### Scenario: Page listens for download lifecycle events

- **GIVEN** a WebView is shown with native window API enabled and the default `download` option
- **WHEN** the page registers `navigator.opentrayWindow.listen("downloadstarted", handler)`
- **AND** the page then triggers a download
- **THEN** the handler fires with a payload containing `url`, `filename`, and `suggestedFilename`
- **AND** the same listener registration path is used as for `windowstatechange`.

#### Scenario: Progress events are reliable on macOS

- **GIVEN** a WebView is shown on macOS with native window API enabled
- **WHEN** the page registers a `downloadprogress` listener and triggers a multi-byte download
- **THEN** the handler fires one or more times with increasing `receivedBytes`
- **AND** `totalBytes` reflects the response content length when available
- **AND** the progress is sourced from a `WKDownload` KVO observer, not from polling.

#### Scenario: Completed event omits the saved path on all platforms

- **GIVEN** a WebView is shown on either macOS or Windows
- **WHEN** a registered `downloadcompleted` listener receives an event
- **THEN** the payload contains `{ url, filename, suggestedFilename, success }`
- **AND** the payload does not contain a `path` field, regardless of platform.

#### Scenario: No listener means no event delivery

- **GIVEN** a WebView is shown with the default `download` option
- **WHEN** the page triggers a download but has registered no download event listener
- **THEN** the extension does not push any download event payload to the page
- **AND** the download still proceeds normally to the Downloads directory.

#### Scenario: Canceled saveAs emits the canceled event

- **GIVEN** a WebView is shown with `download: { saveAs: true }`
- **AND** the page has registered a `downloadcanceled` listener
- **WHEN** the user dismisses the save-location dialog
- **THEN** the listener fires with a payload containing `url`, `filename`, and `suggestedFilename`
- **AND** the event name is `downloadcanceled`, not `downloadfailed`.

### Requirement: Webview download events SHALL be human-verifiable

The repository SHALL ship a runnable example that demonstrates the full download lifecycle a human can observe. The example SHALL exercise at minimum: a standard `<a download>` trigger against a `blob:` URL, a registered set of download event listeners rendering lifecycle state, and the default silent-download behavior. The example SHALL follow the same naming and staging pattern as `example:webview-control`, `example:placement`, and `example:mediaQuery`.

#### Scenario: Maintainer runs the download example

- **GIVEN** the repository is built and the native WebView library is staged
- **WHEN** a maintainer runs `pnpm --filter opentray example:download`
- **THEN** a WebView window opens
- **AND** clicking the demonstrated download trigger writes a real file to the Downloads directory
- **AND** the example's UI reflects `downloadstarted` → `downloadprogress` → `downloadcompleted` transitions.

### Requirement: Download event payload SHALL preserve suggested filename separately from filename

The WebView extension SHALL preserve source-truth filename suggestion separately from the existing `filename` projection in every download lifecycle payload. Each `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled` payload SHALL include `suggestedFilename`, whose value is either:

- the pre-deduped substrate filename suggestion when the native engine exposes one, or
- `null` when the native engine does not expose a distinct suggested filename.

The extension SHALL NOT overwrite `suggestedFilename` with the deduped or final saved filename. The extension SHALL keep `filename` as the existing field so current consumers do not break.

#### Scenario: Suggested filename survives collision dedupe

- **GIVEN** a WebView download trigger whose substrate suggestion is `backup.json`
- **AND** the final saved file is deduplicated to `backup (6).json`
- **WHEN** any download lifecycle event payload is emitted
- **THEN** the payload contains `suggestedFilename: "backup.json"`
- **AND** the payload keeps `filename` as the existing event field rather than rewriting it to match `suggestedFilename`.

#### Scenario: Missing substrate suggestion stays honest

- **GIVEN** a platform download substrate does not expose a distinct suggested filename
- **WHEN** any download lifecycle event payload is emitted
- **THEN** the payload contains `suggestedFilename: null`
- **AND** the extension does not fabricate a separate suggestion by pretending the current `filename` projection is source truth.

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

### Requirement: WebView application mode SHALL be explicit

The WebView extension SHALL expose normal application Shell membership as the common `style.appMode` field. The durable fact SHALL mean participation in the platform's normal application switchers, including the Windows taskbar/Alt+Tab and macOS Dock/application switcher. It SHALL default to `false` so tray-owned WebViews behave as utility windows. Setting it to `true` SHALL opt a window into application membership without coupling that policy to title, icon metadata, frameless state, material hosting, or internal comparator topology.

When false, every Windows host topology SHALL project `WS_EX_TOOLWINDOW` and remove `WS_EX_APPWINDOW`. When true, every topology SHALL project `WS_EX_APPWINDOW` and remove `WS_EX_TOOLWINDOW`.

#### Scenario: Comparator tray window stays out of switchers by default

- **GIVEN** a Windows WebView uses comparator topology without `appMode`
- **WHEN** its native extended style is projected
- **THEN** it does not appear in the taskbar or Alt+Tab
- **AND** comparator geometry and material behavior remain unchanged.

#### Scenario: An application explicitly opts into switchers

- **GIVEN** a WebView sets `style.appMode: true`
- **WHEN** either production or comparator topology projects the native style
- **THEN** the window participates in the normal Windows task switchers.

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

### Requirement: WebView visibility SHALL be an operational state projection

`@opentray/ext-webview` SHALL define `visible` as `!closed && !minimized` for an existing native WebView window session. `closed` SHALL mean that the session native window is hidden/not projected, not that `destroy()` has torn down the session. Raw platform visibility alone SHALL NOT be exposed as this public `visible` projection.

The host `WebviewWindowHandle` and the page `navigator.opentrayWindow` / enabled `navigator.window` facade SHALL expose `isClosed(): Promise<boolean>`, `isVisible(): Promise<boolean>`, and `toVisible(): Promise<void>`. `toVisible()` SHALL show a closed/hidden session, restore a minimized session, and be idempotent when the session is already visible. It SHALL NOT replace content, recreate the session, or act as a general boolean setter.

`WebviewWindowState.visible` SHALL use this same operational projection. The extension SHALL expose a typed `visibleChange` event with payload `{ visible: boolean }`; it SHALL emit only when that projection changes.

#### Scenario: A tray host restores a minimized window without branching on native state

- **GIVEN** a tray host owns an existing `WebviewWindowHandle`
- **AND** its native window is minimized
- **WHEN** the host calls `isVisible()` and then `toVisible()`
- **THEN** `isVisible()` resolves `false`
- **AND** the native session is restored without recreation
- **AND** a `visibleChange` event reports `{ visible: true }`.

#### Scenario: A page reveals a hidden window idempotently

- **GIVEN** a page has the native window API enabled
- **AND** its native window is hidden by `close()` or `hide()`
- **WHEN** it calls `toVisible()` twice
- **THEN** the first call shows the existing session
- **AND** the second call does not introduce another state transition
- **AND** exactly one `visibleChange` event reports `{ visible: true }`.

### Requirement: Visibility capability SHALL remain extension-owned and platform-aligned

Visibility commands, state projection, and page bridge injection SHALL remain inside the WebView extension atom. The Rust command parser, Windows projection, macOS projection, TypeScript facade, and browser-global typing SHALL accept the same `isClosed`, `isVisible`, and `toVisible` contract. `opentray-core` and the generic broker SHALL NOT branch on WebView visibility commands.

#### Scenario: Host and page use one extension contract

- **GIVEN** a consumer uses either `WebviewWindowHandle` or `navigator.opentrayWindow`
- **WHEN** it queries or restores operational visibility
- **THEN** each path reaches the same extension-owned command family
- **AND** no generic tray/runtime API is introduced for WebView window visibility.

### Requirement: Windows frameless projection SHALL own every non-client calculation

For a Windows WebView whose effective style is frameless, every `WM_NCCALCSIZE` path SHALL expose the full host rectangle as client area. The result SHALL NOT depend on the message `wParam` form. Frameless style projection SHALL continue to remove `WS_THICKFRAME` and disable DWM non-client rendering.

The host SHALL apply its DWM non-client policy and DWM client-surface attributes before its final `SetWindowPos(..., SWP_FRAMECHANGED, ...)` recalculation. That recalculation SHALL preserve z-order, position, size, and shell visibility state. The host SHALL NOT depend on a synthetic resize, minimize, restore, hide/show, or window rebuild to remove native titlebar pixels.

#### Scenario: A frameless window survives a non-client recalculation

- **GIVEN** a Windows WebView window has `style.frameless: true`
- **WHEN** Win32 recalculates non-client geometry during style, resize, minimize, or restore handling
- **THEN** the native titlebar/frame is not reintroduced into the client projection
- **AND** the page still reaches the host outer edges.

#### Scenario: A frameless style change repaints native chrome without a shell-state reset

- **GIVEN** a Windows WebView transitions to `style.frameless: true`
- **WHEN** the host applies the native window style
- **THEN** DWM non-client rendering is disabled before the final frame recalculation
- **AND** no minimize, restore, hide/show, synthetic resize, or host rebuild occurs
- **AND** residual native titlebar pixels are not visible after the transition.

### Requirement: Windows frameless soft resize SHALL not change shell state

For `style.frameless: true` with `style.resizable: true`, application-level soft resize SHALL retain pointer capture until the pointer interaction ends or is canceled. During that interaction, the runtime MAY synchronously apply WebView bounds and repaint host surfaces, but it SHALL NOT call `ShowWindow`, minimize, restore, hide/show, rebuild the host window, or invoke the shell-state transparent white-block clear path.

Transparent white-block cleanup remains available for ordinary native resize and explicit resize paths where it does not run inside the frameless soft-resize capture lifecycle.

#### Scenario: A continuous frameless resize does not flicker or terminate after one pixel

- **GIVEN** a Windows WebView has `frameless: true`, `resizable: true`, and a translucent background
- **WHEN** the operator drags a soft-resize edge across multiple pixels
- **THEN** the native window continuously follows the pointer until mouse release
- **AND** the resize interaction retains capture
- **AND** no minimize/restore shell transition occurs during the drag.

#### Scenario: Minimizing a frameless resizable window keeps it minimized

- **GIVEN** a Windows WebView has `frameless: true` and `resizable: true`
- **WHEN** the operator or page minimizes the window
- **THEN** it remains minimized until an explicit restore or `toVisible()`
- **AND** no native titlebar residue is projected.

### Requirement: WebView tray-primary examples SHALL project operational visibility

Every runnable CLI example that owns a retained `WebviewWindowHandle` SHALL declare one `primaryEvent` menu item. The item SHALL read `Show Example` while the retained session is not operationally visible and `Hide Example` while it is visible. Its handler SHALL use `show()` only to bootstrap the first native session, `toVisible()` to reveal an existing hidden or minimized session, and `close()` to hide the retained session. The example SHALL subscribe to `visibleChange` and update the menu from that event so page/native visibility changes cannot leave a stale action label. It SHALL register that listener only after the first successful `show()` creates the native session, and it SHALL stop the listener before closing its tray/runtime connection.

#### Scenario: A primary tray action reveals and hides one retained example window

- **GIVEN** a source WebView example has created its window handle but has not shown it yet
- **WHEN** the operator activates `Show Example`
- **THEN** the example bootstraps the window once and the primary item changes to `Hide Example`
- **WHEN** the operator activates `Hide Example`
- **THEN** the example closes the native projection without destroying the session
- **AND** the primary item changes to `Show Example`
- **WHEN** the operator activates `Show Example` again
- **THEN** the example calls `toVisible()` on the retained session instead of recreating content or replaying bootstrap options.

#### Scenario: An example listener does not outlive its native session

- **GIVEN** a WebView example has constructed a retained handle but has not shown it yet
- **WHEN** it performs the first successful `show()`
- **THEN** it registers `visibleChange` and any other native window listener after that native session exists
- **AND** it stops every returned listener, destroys the native session, and then closes the runtime
- **AND** no extension command is sent before the native session exists or after the connection ends.

### Requirement: Windows frameless artifact clear SHALL occur after safe terminal transitions

When Windows auto artifact clearing is enabled, a visible non-maximized frameless WebView SHALL run the existing rendering-artifact clear after it has been projected frameless and after a completed application-level soft-resize releases pointer capture. The cleanup applies regardless of opaque versus translucent background because native chrome residue is independent of the WebView backing family.

The host SHALL NOT run the shell-state artifact clear while a frameless soft-resize interaction owns pointer capture, during a minimized state, or while maximized. It SHALL continue to use the existing background-gated behavior for framed windows.

#### Scenario: Frameless entry clears opaque native-chrome residue

- **GIVEN** a visible normal Windows WebView is changed to `style.frameless: true`
- **AND** its background is opaque
- **WHEN** the native style projection completes
- **THEN** the runtime runs the rendering-artifact clear
- **AND** the window remains operationally visible with no native titlebar residue.

#### Scenario: Frameless soft resize clears only after capture ends

- **GIVEN** a visible non-maximized frameless Windows WebView with `resizable: true`
- **WHEN** the operator completes a soft-resize drag
- **THEN** pointer capture is released before artifact cleanup begins
- **AND** the runtime clears the rendering artifact after the interaction
- **AND** no shell-state repair runs during the drag.

### Requirement: Windows operational visibility SHALL follow native state completion

The Windows host SHALL maintain one authoritative operational-visibility projection for command paths and native state messages. It SHALL update that projection after a native `WM_SIZE` transition so minimize/restore initiated by a page control, system command, or shell path emits exactly one `visibleChange` after the Win32 state is observable. A command-side check MAY emit earlier when the state is already observable, but it SHALL update the same projection and SHALL NOT duplicate a native completion event.

#### Scenario: A page minimizes a retained window

- **GIVEN** a runnable source WebView example has a visible retained session and a `visibleChange` listener
- **WHEN** the page calls `minimize()`
- **THEN** the native `WM_SIZE` completion projects `visible: false`
- **AND** the primary tray item changes to `Show Example`
- **AND** no second false visibility transition is emitted.

### Requirement: Windows frameless reveal cleanup SHALL wait for post-reveal composition

When `show()` or `toVisible()` reveals a normal frameless Windows window, the runtime SHALL enqueue at most one private HWND cleanup message instead of invoking the shell-state artifact repair inside the `ShowWindow` call stack. When that message is handled, it SHALL clear the pending marker before checking the current artifact predicate. It SHALL skip repair when the window is hidden/minimized, maximized, or an application-level soft-resize capture remains active.

#### Scenario: Restoring a frameless material window clears residue without user resize

- **GIVEN** a retained frameless Windows WebView with a material background is minimized
- **WHEN** the tray calls `toVisible()`
- **THEN** the runtime restores the same native session
- **AND** one queued post-reveal cleanup runs only after the next HWND message turn
- **AND** the material is visible without requiring the user to resize the window.

### Requirement: Windows native resize recovery SHALL be terminal-only

The Windows host SHALL treat continuous `WM_SIZE` as geometry/surface work, not as authority to run the shell-state artifact repair. During a native `WM_ENTERSIZEMOVE` interaction it SHALL only record whether a size change occurred. After `WM_EXITSIZEMOVE`, one observed resize MAY queue one artifact repair through the existing post-transition boundary. A pure native move SHALL queue no repair.

This rule applies to ordinary framed and material-backed windows as well as the existing frameless soft-resize exclusion. The host SHALL NOT run `SW_SHOWMINNOACTIVE -> SW_RESTORE` on a recurring timer or throttle while the operator is continuously resizing.

#### Scenario: A material-backed native resize does not repeatedly refresh the shell

- **GIVEN** a visible normal WebView has a material or transparent background
- **WHEN** the operator drags a native resize edge across many `WM_SIZE` messages
- **THEN** each message updates geometry and native surfaces without a shell-state reset
- **AND** one repair is queued only after `WM_EXITSIZEMOVE` when the interaction observed a resize
- **AND** the operator does not see recurring minimize/restore refreshes during the drag.

#### Scenario: A native move does not request terminal repair

- **GIVEN** a visible normal WebView begins and ends a native move interaction without resizing
- **WHEN** the host receives `WM_ENTERSIZEMOVE` and then `WM_EXITSIZEMOVE`
- **THEN** it does not queue an artifact repair.

### Requirement: Tray WebView auto-hide SHALL be a common native style policy

`WebviewWindowStyle` SHALL expose common boolean `autoHide`, with an effective default of `true`. When a visible retained WebView loses native focus, the platform runtime SHALL hide that same native projection when and only when `autoHide` is true and `keepOnTop` is false. The transition SHALL preserve the session, page state, content, and geometry, and SHALL emit operational `visibleChange` with `{ visible: false }`.

`keepOnTop: true` SHALL suppress native auto-hide even when `autoHide` remains true. `autoHide: false` SHALL explicitly suppress focus-loss dismissal. Runtime style patches SHALL take effect for subsequent native focus transitions without recreating the session. The capability DTO SHALL report support for the common `autoHide` style.

#### Scenario: Default tray surface hides after focus loss

- **GIVEN** a visible retained WebView uses the default style with `keepOnTop: false`
- **WHEN** the native window loses focus
- **THEN** the native projection is hidden without destroying the session
- **AND** operational visibility changes to false exactly once.

#### Scenario: A pinned surface stays visible

- **GIVEN** a visible retained WebView has `keepOnTop: true`
- **WHEN** the native window loses focus
- **THEN** the window remains operationally visible
- **AND** no auto-hide visibility transition is emitted.

#### Scenario: An application opts out of auto-hide

- **GIVEN** a visible retained WebView has `autoHide: false` and `keepOnTop: false`
- **WHEN** the native window loses focus
- **THEN** the window remains visible for application-owned dismissal.

### Requirement: Diagnostic WebView examples SHALL opt out of native auto-hide

Runnable control/comparator examples that require interaction with DevTools or another native window SHALL explicitly set `autoHide: false`. This is an example policy override, not a different runtime default.

#### Scenario: DevTools interaction does not dismiss a comparator

- **GIVEN** `example:webview-control` or `example:win32-bug` is running
- **WHEN** focus moves to DevTools or another observation surface
- **THEN** the example window remains visible until its explicit retained-session action hides it.

### Requirement: A window session SHALL orchestrate multiple webviews as sibling native views

The webview facade SHALL expose `createWebview` (parent window session, unique webview id, url or html content, optional per-webview bridge policy), `destroyWebview`, and `listWebviews` on the window handle, and a per-webview `focus()` command raising that webview to native focus within its window. The wire command tags are frozen in `@opentray/spec` and the Rust protocol crate with fixtures under `fixtures/frames/` (kebab-case family — `create-webview`, `destroy-webview`, `list-webviews`, `navigate-webview`, `back-webview`, `forward-webview`, `focus-webview`, `get-webview-url`, `get-webview-title`, `set-webview-layout`, `update-webview-layout`, `subscribe-webview-events`, and their result/ack frames) — deliberately distinct from the legacy single-webview command tags; renaming any tag after this change is a breaking protocol change. A webview created inside a window SHALL be a sibling native child view (macOS: NSView subview; Windows: child HWND) — never a separate OS window. Webview ids SHALL be unique within their window session. The page bridge SHALL expose the owning webview's id as a read-only property.

Per-webview bridge policy: `createWebview` SHALL accept an optional declarative bridge policy whose DTO is frozen as the boolean field set `{ webviewId, messageChannels, navigatorWindow, navigatorScreen, nativeApi }` — every field defaults to false, and omitting the policy entirely means all fields false (no bridge). A child webview without an explicit policy never exposes the bridge to its pages — the arbitrary-content webview is bridgeless by default, and trusted webviews (such as a toolbar) opt in explicitly (for the toolbar carrier: `{ webviewId: true, messageChannels: true }`). The policy is bootstrap-immutable for that webview's lifetime, mirroring the session compatibility law.

Style exclusivity is one rule with one error: a window in a translucency-affecting style (frameless or material today) SHALL NOT host multi-webview composition. The guard fires with the typed error `multiwebview_unsupported_style` at three checkpoints, before any state changes: (1) creating a second webview in such a window, and (2) applying a frameless or material style mutation to a window that already hosts more than one webview, are both reachable v1 paths and carry their scenarios below; checkpoint (3), layout commit, is **reserved as a forward-compatibility guard** — v1 defines no per-view transparency-affecting style input (window-level styles are the only v1 translucency source and are excluded by (1) and (2)), so no v1 scenario exercises (3); it activates only when a per-view transparency style field enters both platforms' capability DTOs, at which point it gains its own scenario. Opaque stacking of webviews across layers of a framed window SHALL be supported. Every capability field introduced by this requirement (webview id, bridge policy, focus command, typed error) SHALL be serialized by both platforms' capability DTOs — Darwin release-grade builds are the cross-platform compiler gate.

#### Scenario: Two webviews compose one window

- **GIVEN** a framed webview window session
- **WHEN** the caller creates webviews `toolbar` (bridge policy on) and `content` (no policy) and applies a two-row layout
- **THEN** both SHALL render as sibling views inside the same OS window
- **AND** destroying `toolbar` SHALL leave `content` and its page runtime alive in the same session

#### Scenario: The bridge is opt-in per child webview

- **GIVEN** webview `content` created without a bridge policy, showing an arbitrary cross-origin site
- **WHEN** its page probes for the webview id property or channel APIs
- **THEN** none SHALL be exposed (every bridge field defaults to false)
- **AND** webview `toolbar` created with `{ webviewId: true, messageChannels: true }` in the same window SHALL expose exactly those bridge surfaces

#### Scenario: Translucency-affecting styles and multi-webview are mutually exclusive at the v1 checkpoints

- **GIVEN** a framed window hosting webviews `a` and `b`
- **WHEN** the host applies a material or frameless style mutation to the window
- **THEN** the mutation SHALL fail with the typed error `multiwebview_unsupported_style` and the framed style SHALL remain
- **WHEN** instead a second webview is created inside an already-material or frameless window
- **THEN** creation SHALL fail with the same typed error before any child state exists
- **AND** opaque cross-layer overlap in a framed window SHALL commit and render normally
- **AND** no v1 input can reach the layout-commit checkpoint (3); it activates only when a per-view transparency style field enters both platforms' capability DTOs

#### Scenario: Per-webview focus raises one view without touching siblings

- **GIVEN** webviews `toolbar` and `content` in one window with `content` holding native focus
- **WHEN** the host calls `focus()` on the `toolbar` webview handle
- **THEN** `toolbar` SHALL become the keyboard-focused view inside that window
- **AND** `content`'s page runtime and geometry SHALL be unaffected

#### Scenario: The page bridge knows its own webview id

- **GIVEN** a webview whose page bridge is enabled by its explicit bridge policy
- **WHEN** page code reads the webview id property
- **THEN** it SHALL observe the same opaque id the host facade uses to address this webview

### Requirement: Webview navigation SHALL be per-view with push URL and title events

Each webview SHALL expose `navigate` (explicit content replacement for that webview only, consistent with the content-replacement law), plus `back` and `forward` over the webview's native session history. URL and title changes SHALL be delivered to the host facade as push events (`urlChange`, `titleChange`), and focus transitions as `focused` edge events, for that webview.

Event wire contract: the unified per-view event family is `kind ∈ { urlChange, titleChange, focused, geometryChange, loadState, navigationAction, faviconChange }` (geometryChange carries the overlay safe-area projection and is specified with the overlay requirement; loadState carries the per-view navigation lifecycle; `navigationAction` and `faviconChange` are specified with the webview-navigation and webview-favicon capabilities). Every event frame SHALL carry `{ owner: {appId, trayId, sessionId}, windowId, webviewId, kind, seq, payload }` — the owner tuple rides the frame so session-scoped ids never collide across sessions; `seq` is a per-view monotonically increasing sequence number. Payload DTOs are frozen field-level: `{ url: string }` for `urlChange`, `{ title: string }` for `titleChange`, `{ focused: boolean }` for `focused` (edge semantics: gained or lost), for `geometryChange` `{ rect: { x: number, y: number, width: number, height: number } | null }`, and for `loadState` `{ phase: "started" | "finished" | "failed", url: string, errorCode?: number, progress?: number }` (progress ∈ [0,1], omitted when the platform cannot report it — consumers render an indeterminate affordance) — view-local logical pixels, `null` meaning no intersection with the overlay region; this rect is field-isomorphic to the page-bridge `overlay.geometrychange` payload (same fields, same null rule, same units — the two surfaces serialize the same projection value in their respective envelopes). Subscription follows the facade handle's listeners, materialized as explicit wire subscribe/unsubscribe frames (fixture-frozen in the codec tests). Events are pure push with no replay: current values are read through the facade query commands `getUrl()`, `getTitle()` and — for webviews with favicon observation enabled — `getFavicon()`, which return `(value, seq)`; consumers subscribe first, then query, and discard events whose `seq` is not greater than the queried `seq`. `focused`, `geometryChange`, and `loadState` have no query — consumers track edges and projection updates. The native implementation SHALL push these events from native page-load, title, focus, and layout-projection callbacks directly onto the event channel — reusing the 16 ms window-event drain polling loop as the observation mechanism for these events is prohibited. On broker disconnect, pending event delivery stops and listeners observe the disconnect through the existing connection lifecycle, not through synthetic events.

#### Scenario: navigate retargets one webview without touching siblings

- **GIVEN** webviews `toolbar` and `content` in one window
- **WHEN** the host calls `navigate(content, "https://example.org")`
- **THEN** only `content` SHALL load the new address
- **AND** `toolbar` SHALL keep its page runtime and position

#### Scenario: urlChange reports in-page navigation truth without polling

- **GIVEN** webview `content` showing a page that links internally
- **WHEN** the operator activates an in-page link
- **THEN** the host SHALL receive one `urlChange` push event carrying the page's actual new URL
- **AND** the delivery path SHALL not depend on any polling interval

#### Scenario: Focus transfer emits both edges with full frame identity

- **GIVEN** webviews `toolbar` and `content` in one window, `content` holding native focus, and the host subscribed to both views' `focused` events
- **WHEN** the host calls `focus()` on the `toolbar` webview handle
- **THEN** `content` SHALL receive `focused: false` and `toolbar` SHALL receive `focused: true`
- **AND** both event frames SHALL carry the correct owner tuple, window id, webview id, and per-view sequence numbers that increased monotonically
- **AND** the delivery path SHALL not depend on any polling interval

#### Scenario: Query plus sequence resolves the subscription race

- **GIVEN** a webview that has already navigated before the host subscribes
- **WHEN** the host subscribes to `urlChange` and then calls `getUrl()`
- **THEN** the query SHALL return the current URL with its sequence number
- **AND** any `urlChange` event whose `seq` is not greater than the queried `seq` SHALL be discardable as stale without missing a real change

#### Scenario: Events stop cleanly at disconnect

- **GIVEN** a host facade subscribed to a webview's `urlChange` events
- **WHEN** the broker connection drops
- **THEN** no further `urlChange` events SHALL be synthesized after the disconnect is observed
- **AND** re-establishing a session SHALL produce fresh subscriptions without replaying stale events

### Requirement: Windows multi-webview SHALL share one WebView2 environment and retained profile

On Windows, all webview controllers of one extension session SHALL share a single WebView2 environment whose user-data profile follows the existing WebView2 Profile Law (the retained `WebContext` beside the WebView; the profile path never derives from the broker executable path). The shared environment and `WebContext` SHALL outlive every child controller; destroying one controller SHALL NOT dispose the environment or affect sibling controllers' profile state. A controller creation failure SHALL include the resolved profile path in its error. Multi-child resize SHALL go through the existing WM_SIZE ordering law (host paint → each controller's bounds → WRY child bounds → parent-position notification) with every controller updated in one resize pass.

#### Scenario: Sibling controllers share profile state and survive each other

- **GIVEN** a Windows window session hosting webviews `toolbar` and `content` on one shared environment
- **WHEN** `toolbar` is destroyed and recreated
- **THEN** `content` SHALL keep its session and profile state
- **AND** the recreated `toolbar` SHALL attach to the same shared environment without a new profile directory

### Requirement: Overlay and titlebar geometry SHALL be projected per webview and updated on layout commits

Window-level overlay facts are unchanged: the `windowControlsOverlay` declaration is a window-level fact, Windows `AppWindowTitleBar.LeftInset`/`RightInset`/`Height` remain the safe-area authority read synchronously on the HWND-owning thread, and the existing overlay initialization-order laws keep holding. On top of those facts, the page-bridge `getTitlebarAreaRect()` SHALL report the safe-area rect in the receiving webview's own viewport coordinates: the intersection of the window overlay region with that webview's current layout rect, translated into view-local space; a webview that does not intersect the overlay region SHALL receive an empty rect. A window whose single webview fills the client area SHALL report exactly the values a full-window webview reports today — existing single-webview windows keep their geometry.

Projection SHALL be recomputed inside the layout commit transaction (after frames are applied) and on overlay metric changes (scale factor, style, or system metric changes). The recomputed projection reaches both consumers from one source: the host facade receives `geometryChange` as a member of the unified per-view event family (same frame schema, sequence numbers, subscription mechanism, and no-polling guarantee as urlChange/titleChange/focused; payload `{ rect }`), and bridged pages keep the existing `navigator.opentrayWindow.overlay.listen("geometrychange")` surface — its payload is frozen as `{ rect: { x, y, width, height } | null }` in view-local logical pixels, `null` meaning no intersection with the overlay region. Recipients are exactly the bridged webviews whose projection changed; the page-bridge event is gated by the same per-webview bridge policy as every bridge surface. Both surfaces derive from the same native projection recompute and are covered by the codec fixtures and projection tests. Custom drag regions SHALL be declared in view-local coordinates and translated into window coordinates through the declaring webview's current layout rect; a layout commit SHALL re-register active regions under the new rects, so no stale translation survives a layout change. Windows non-client hit-testing and drag routing SHALL resolve against whichever child webview actually occupies the titlebar region under the cursor.

#### Scenario: A view outside the titlebar region gets an empty safe area

- **GIVEN** a window with a frameless titlebar overlay and a layout placing webview `content` entirely below the overlay region
- **WHEN** `content`'s page calls `getTitlebarAreaRect()`
- **THEN** it SHALL receive an empty rect and SHALL NOT render titlebar padding

#### Scenario: The titlebar view gets view-local coordinates that track layout changes

- **GIVEN** webview `bar` occupying the top strip intersecting the caption-button region at window coordinates `{x: 0, y: 0, width: 800, height: 44}`
- **WHEN** its page calls `getTitlebarAreaRect()`, the host then commits a layout moving `bar` down by 20 logical pixels
- **THEN** the first call SHALL return the caption-button exclusion translated into `bar`'s local space
- **AND** the layout commit SHALL recompute the projection and push a `geometryChange` event (unified event family) to `bar` with the shifted local rect

#### Scenario: Full-window single webview keeps today's geometry

- **GIVEN** a frameless overlay window whose only webview fills the client area (the default layout)
- **WHEN** its page measures the titlebar area before and after this change's implementation
- **THEN** the reported rect SHALL equal the window-level values a full-window webview reports today

### Requirement: Auxiliary popup windows SHALL open for new-window navigation intents

A webview SHALL route every new-window navigation intent to a native auxiliary popup window: link targets (`a[target]`), `window.open`, middle-click on links, and the native context menu's "open in new window" entry SHALL all open the target URL in a new OS window hosting a single plain webview. On macOS this is the `WKUIDelegate` new-webview callback; on Windows it is `NewWindowRequested` (handled, never delegated to an external browser). Popup windows carry no toolbar and expose no layout surface in v1; window title follows the document one-way.

Popup windows are auxiliary state owned by the creating extension session: they do NOT occupy the tray's window session (the one-session-per-tray law is untouched), any number may be open, and session close or lease cleanup SHALL close every popup owned by that session or lease without touching other owners' popups. The capability is reported through both platforms' capability DTOs (`popup_windows`).

#### Scenario: target=_blank opens a popup owned by the session

- **GIVEN** a running toolbar application whose content webview shows a page with `<a href="https://example.org" target="_blank">`
- **WHEN** the link is activated
- **THEN** a new plain window SHALL load `https://example.org` as a top-level context
- **AND** the original window, its layout, and its toolbar SHALL be unaffected
- **AND** closing the owning session SHALL close the popup

#### Scenario: Middle-click and the context menu route to the same popup path

- **GIVEN** the content webview showing a plain link
- **WHEN** the operator middle-clicks the link, or uses the context menu's "open in new window"
- **THEN** the URL SHALL open in a popup window through the same native path as target=_blank

#### Scenario: Lease cleanup closes owned popups only

- **GIVEN** two sessions each with an open popup
- **WHEN** one session closes
- **THEN** only that session's popup SHALL close

### Requirement: Child webview creation SHALL re-assert window ordering and activation

The session-bootstrap ordering and activation run before any child exists (an empty windowOnly shell); WebKit never re-evaluates new children's visibility against that stale state, so their pages can stay suspended until an app activation. After a child webview is attached and the effective layout is solved, the extension SHALL re-assert `makeKeyAndOrderFront`/`orderFrontRegardless` and application activation so the newly framed views get their visibility evaluated.

#### Scenario: Content page executes immediately after bootstrap

- **GIVEN** a windowOnly session whose content webview was just created and laid out
- **WHEN** the page finishes loading without any Dock interaction
- **THEN** its scripts run and navigation commands take effect immediately.

### Requirement: Host-bound channel events SHALL deliver through the extension EventPort without a command in flight

The v1 flush ruling delivered host-bound channel events only as passengers on the next facade command response. After the D19 drain retirement an idle session never issues that command, so every page-to-host message stalled indefinitely (the "buttons dead until a Dock activation" walkthrough symptom). Page-originated channel commands SHALL push drained host channel events through the instance's EventPort immediately, in the same `channel.message`/`channel.closed` wire shape the response path produced. The authoritative store remains the session host outbox: a record leaves it only when the hub accepted it or the bounded Edge retry queue owns its redelivery; every other outcome (oversized record, retry overflow, revoked or absent port) SHALL retain the record at the front of the host outbox for the unchanged command-response flush, so user data is never dropped and the legacy fallback stays intact.

#### Scenario: A page command reaches an idle host immediately

- **GIVEN** an open host-created channel and a session with no facade command in flight
- **WHEN** the page posts a message through the channel bridge
- **THEN** the host endpoint observes the message without any command response carrying it
- **AND** the session's host outbox is empty afterward (no double delivery through a later response).

#### Scenario: Retained records keep their fallback order

- **GIVEN** a port that cannot guarantee a record (oversized payload, retry overflow, or no attached port)
- **WHEN** the push path returns the record
- **THEN** it is re-queued at the front of the host outbox, oldest first
- **AND** the next command response flush delivers the retained records in FIFO order.

#### Scenario: Platform twins enforce the same delivery contract

- **GIVEN** the macOS and Windows channel dispatchers
- **WHEN** a page-originated postMessage/close/destroy command succeeds or typed-fails
- **THEN** both platforms submit drained host events through the EventPort before returning
- **AND** neither platform expresses a registry borrow across the deliver/submit re-entry.

#### Scenario: A document-navigation close reaches an idle host immediately

- **GIVEN** an open channel whose page endpoint's document reloads (manual reload) with no facade command in flight
- **WHEN** the native navigation hook closes the channel with `document_navigated`
- **THEN** the host-endpoint close observation is pushed through the EventPort in the same `channel.closed` wire shape the response path produced
- **AND** the session's host outbox is empty afterward, so a self-healing host rebuilds its channel without waiting for any command response.
