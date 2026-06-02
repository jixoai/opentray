## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Webview SHALL be an extension atom

The webview capability SHALL live outside the kernel as `@opentray/ext-webview` and an equivalent native extension implementation. It SHALL expose typed commands for showing, hiding, navigating, evaluating JavaScript, and exchanging messages with web content. It SHALL not own surface lifecycle, tray lifecycle, lease cleanup, or backend selection.

The official native runtime SHALL now be owned by the WebView platform dylib itself. The daemon SHALL only forward WebView extension traffic through the generic extension host boundary and SHALL NOT be the place where released WebView runtime behavior is implemented.

#### Scenario: Webview command is routed through extension host

- **GIVEN** a client calls the webview facade for an existing tray
- **WHEN** the facade sends a `show` command
- **THEN** the Node client emits an `ext-command` frame with `ext` set to `webview`
- **AND** the kernel dispatches it through the registered webview extension instance.

### Requirement: Webview facade SHALL be typed and platform-neutral

The TypeScript `@opentray/ext-webview` facade SHALL depend only on `opentray` public contracts and `@opentray/spec` types. It MUST NOT import platform binary packages, Rust backend implementation details, or private kernel protocol internals.

The facade SHALL remain a platform-neutral contract layer even after the native runtime moves fully into `@opentray/ext-webview-<os>-<arch>` dynamic libraries. It SHALL not rely on daemon-side WebView parsers or hidden daemon-owned WebView runtime behavior.

#### Scenario: Webview package stays platform neutral

- **GIVEN** `@opentray/ext-webview` is installed in a project
- **WHEN** its public exports are inspected
- **THEN** they expose typed webview commands and events
- **AND** they do not require importing any `@opentray/<platform>` binary package directly.
