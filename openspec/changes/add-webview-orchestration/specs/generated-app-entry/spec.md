## MODIFIED Requirements

### Requirement: A URL application SHALL offer toolbar mode, always-reachable reload, and the durable window sync defaults

Toolbar mode (`window.toolbar`) SHALL be carried by the multi-webview orchestration of the WebView extension: one navigation-toolbar webview (shell-served toolbar page at a fixed top strip) and one content webview loading the recorded address directly as a top-level browsing context, composed by the declarative layered layout. The payload SHALL include the shell server and toolbar UI assets while remaining free of the PTY dependency. The toolbar page SHALL command the entry's navigation surface (navigate, back/forward, reload, urlChange state) through an extension message channel whose schema is private to the create package; the shell server SHALL serve static assets only and expose no HTTP navigation API. The address bar SHALL treat the content webview's `urlChange` events as its source of truth. Embedding policy (X-Frame-Options / CSP frame-ancestors) is not consulted: a top-level content webview is not an embedded context. Command-mode address-bar windows SHALL use the same carrier and the same toolbar page.

Non-toolbar windows SHALL project the config sync defaults: title follows the document one-way; icon following is opt-in. Toolbar windows SHALL project the same defaults onto the content webview, whose document is the real target page.

Every URL application's tray menu SHALL offer a `Reload` item that reloads the content webview without restarting the app. Toolbar pages SHALL bind back/forward/reload/address-focus keyboard shortcuts (⌘/Ctrl+←→, ⌘/Ctrl+[ ], ⌘/Ctrl+R, F5, ⌘/Ctrl+L); the documented limitation SHALL state that keystrokes land in whichever webview holds native focus, so the toolbar receives its shortcuts only while it holds focus.

#### Scenario: Embedding-hostile addresses render in toolbar mode

- **GIVEN** `--toolbar` against an address whose response carries `X-Frame-Options: DENY`
- **WHEN** the toolbar application runs
- **THEN** the content webview SHALL load the address as a top-level browsing context and render it
- **AND** creation SHALL NOT probe, warn about, or strip the toolbar request for embedding-policy reasons

#### Scenario: Toolbar composes native webviews without the PTY

- **GIVEN** a URL application generated with `toolbar: true`
- **WHEN** its payload is written and the entry runs
- **THEN** one window SHALL host the toolbar webview above the content webview through the layered layout
- **AND** the payload SHALL contain the shell server and toolbar assets but no `@lydell/node-pty` dependency
- **AND** the shell server SHALL expose no navigation HTTP endpoint

#### Scenario: The address bar follows page truth

- **GIVEN** a running toolbar application whose content webview shows a page with internal links
- **WHEN** the operator activates an in-page link
- **THEN** the address bar SHALL update from the content webview's `urlChange` event
- **AND** back/forward SHALL drive the content webview's native history through the entry's channel

#### Scenario: Tray reload is always reachable

- **GIVEN** any running URL application
- **WHEN** the tray Reload item is activated
- **THEN** the target page SHALL reload without the app process restarting

#### Scenario: Sync defaults project into both window forms

- **GIVEN** a URL application with default sync options, generated with or without toolbar
- **WHEN** its entry runs
- **THEN** the window title SHALL follow the real target document one-way (the content webview in toolbar mode)
- **AND** it SHALL NOT carry favicon→window icon sync unless explicitly opted in
