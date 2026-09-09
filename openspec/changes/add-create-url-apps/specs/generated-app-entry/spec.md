## ADDED Requirements

### Requirement: A URL application entry SHALL open its address directly

The generated entry of a URL application SHALL own the tray session and one application-mode WebView window whose URL is the frozen `url` field, with window size from the v1 window options and `titleSync`/`iconSync` page metadata sync enabled as in address-bar-less command windows. It SHALL NOT load a PTY, spawn any child process, run the shell host, or run a port monitor — a URL application supervises nothing. Teardown SHALL destroy the window and tray session and exit; there is no child process tree to sweep. Startup failures SHALL still persist to `app.log` before exit.

#### Scenario: Generated entry opens the address with no supervision

- **GIVEN** a URL application payload generated from `https://example.com`
- **WHEN** its `main.mjs` source is rendered
- **THEN** it SHALL create one WebView window targeting exactly that URL
- **AND** the source SHALL contain no PTY import, no `spawn` of the recorded (nonexistent) command, and no port-discovery loop

#### Scenario: Quit exits cleanly without child processes

- **GIVEN** a running URL application
- **WHEN** the tray Quit item is activated
- **THEN** the window and tray session SHALL be destroyed and the process SHALL exit
- **AND** teardown SHALL not attempt process-tree sweeps or signals against children

## ADDED Requirements

### Requirement: A URL application SHALL offer toolbar mode, always-reachable reload, and the durable window sync defaults

Toolbar mode (`window.toolbar`) SHALL host the shared address-bar wrapper page (`browse.html?url=<encoded target>`) instead of the direct address, include the shell server and shell UI assets in the payload while remaining free of the PTY dependency, and set neither `titleSync` nor `iconSync` (the wrapper document's metadata is not the target page's — same law as command-mode address-bar windows). Non-toolbar windows SHALL project the config sync defaults: title follows the document one-way; icon following is opt-in.

Every URL application's tray menu SHALL offer a `Reload` item that reloads the page through the WebView evaluate channel (`location.reload()`) without restarting the app. Toolbar-mode wrapper pages SHALL bind back/forward/reload/address-focus keyboard shortcuts (⌘/Ctrl+←→, ⌘/Ctrl+[ ], ⌘/Ctrl+R, F5, ⌘/Ctrl+L) to their existing navigation model; the documented limitation SHALL state that keystrokes with focus inside a cross-origin embedded page are not observable by the wrapper.

#### Scenario: Toolbar wraps the address without the PTY

- **GIVEN** a URL application generated with `toolbar: true`
- **WHEN** its payload is written
- **THEN** the window target SHALL be the wrapper page carrying the encoded address
- **AND** the payload SHALL contain `app-shell-server.mjs` and `app-shell/` but no `@lydell/node-pty` dependency
- **AND** the entry SHALL set neither titleSync nor iconSync on that window

#### Scenario: Tray reload is always reachable

- **GIVEN** any running URL application
- **WHEN** the tray Reload item is activated
- **THEN** the page SHALL reload without the app process restarting

#### Scenario: Sync defaults project into the direct window

- **GIVEN** a non-toolbar URL application with default sync options
- **WHEN** its entry is generated
- **THEN** the window SHALL carry one-way document→window title sync
- **AND** it SHALL NOT carry favicon→window icon sync
