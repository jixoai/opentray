## ADDED Requirements

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

### Requirement: Official WebView guidance SHALL teach extension mounting

The official `@opentray/ext-webview` README and repo WebView examples SHALL teach the standard WebView path as `tray.extend(WebviewExt).createWebviewWindow(...)`. Guidance MAY mention `attachWebview(tray)` as a compatibility adapter, but ordinary consumers SHALL NOT be instructed to hand-author `load-ext` before using WebView.

#### Scenario: Docs show the ordinary consumer path

- **GIVEN** a developer reads the public WebView guidance
- **WHEN** they look for the standard usage pattern
- **THEN** the guidance starts from `tray.extend(WebviewExt)`
- **AND** it does not require a manual `load-ext` pre-step.
