# generated-app-entry Specification

## Purpose
TBD - created by archiving change create-no-first-launch-force-terminal. Update Purpose after archive.

## Requirements

### Requirement: The entry SHALL run the command through a PTY unconditionally

Every generated application SHALL depend on a prebuilt native PTY package and SHALL spawn the recorded command through a pseudo-terminal regardless of shell options, matching the wizard preview's TTY environment. A PTY-module load failure SHALL degrade to pipe transport, SHALL log the degradation to `app.log`, and SHALL NOT fail the entry. The shell host (static UI + PTY ring + port state) SHALL be scaffolded unconditionally.

#### Scenario: Plain-mode command sees a TTY

- **GIVEN** a generated app with no shell options enabled
- **WHEN** the entry spawns the recorded command
- **THEN** the command SHALL observe a pseudo-terminal on stdio
- **AND** its output SHALL be captured into the PTY ring and `app.log`

#### Scenario: PTY dependency unavailable

- **GIVEN** the native PTY module fails to load
- **WHEN** the entry starts
- **THEN** the command SHALL run through pipes with a degradation notice in `app.log`

### Requirement: Service discovery SHALL be continuous with no time limit

The entry SHALL NOT block startup on service discovery. A single adaptive monitor SHALL sniff the command's owned listening ports for the entry's whole lifetime, SHALL accept dynamic and multiple ports, and SHALL open one window per HTTP-verified port. The polling interval SHALL be cost-bounded: near 1s when state is changing, backing off to at most 5s when quiet or when system load is high, returning to the fast cadence on any state change. The monitor SHALL NOT create hidden high-frequency (>=2Hz) polling.

#### Scenario: Slow command eventually serves

- **GIVEN** a command whose service appears minutes after start
- **WHEN** the entry keeps running
- **THEN** the monitor SHALL keep sniffing without failing the entry
- **AND** the service window SHALL open when the port verifies

#### Scenario: Random port is adopted

- **GIVEN** a command that listens on an ephemeral port (port 0)
- **WHEN** the monitor verifies the owned listener over HTTP
- **THEN** the window SHALL target that exact port
- **AND** a second verified port SHALL get its own window

#### Scenario: Quiet system backs off

- **GIVEN** no port-state changes for multiple consecutive monitor ticks
- **WHEN** the monitor schedules its next tick
- **THEN** the interval SHALL back off toward 5s
- **AND** any observed state change SHALL return it to the fast cadence

### Requirement: Abnormal command exit SHALL force-reveal the terminal window

The terminal window SHALL be a first-class component of every generated app. The `showTerminal` option SHALL control only its initial visibility. The command's exit SHALL be treated as abnormal when the exit code is non-zero OR the command exits before any service has been verified. On abnormal exit the entry SHALL reveal the terminal window regardless of configuration — creating and showing it on demand, or making an existing one visible and focusing it — and the terminal surface SHALL replay the retained PTY output plus the exit status. Normal exit after at least one verified service SHALL NOT force the window.

#### Scenario: Hidden terminal pops on crash

- **GIVEN** a generated app with `showTerminal: false` whose command exits with code 1
- **WHEN** the exit is observed
- **THEN** the terminal window SHALL appear focused
- **AND** it SHALL show the command output history and the exit code

#### Scenario: Exit before any service

- **GIVEN** a command that exits with code 0 before any verified service appeared
- **WHEN** the exit is observed
- **THEN** the terminal window SHALL be force-revealed as abnormal

#### Scenario: Graceful exit after service stays quiet

- **GIVEN** a command that exits with code 0 after at least one service was verified
- **WHEN** the exit is observed
- **THEN** the terminal window SHALL NOT be force-revealed

### Requirement: Command teardown SHALL sweep the whole process tree

Killing the command (quit path or teardown) SHALL terminate the entire descendant tree, not only the direct child: POSIX pipe fallbacks SHALL spawn into an owned process group and signal the group; PTY paths SHALL kill the pty child and sweep descendants by parent-PID walk. The sweep SHALL escalate from SIGTERM through a bounded grace period to SIGKILL. Wizard-side preview teardown SHALL apply the same tree-sweep rigor so no preview survivor can hold a service port.

#### Scenario: Quit leaves no descendants

- **GIVEN** a running command that spawned a server child
- **WHEN** the user quits the generated app
- **THEN** no descendant of the command SHALL remain alive

#### Scenario: Preview kill releases the port

- **GIVEN** a wizard preview whose command tree holds a service port
- **WHEN** generation stops the preview
- **THEN** the whole preview command tree SHALL be terminated before generation proceeds

### Requirement: Entry startup failures SHALL persist to app.log

The entry SHALL wrap its whole startup in a top-level error boundary. Any startup failure (including tray/session creation errors) SHALL append the error message and stack to `app.log` before exiting non-zero. No startup failure SHALL be silent.

The entry SHALL NOT swallow window/bootstrap errors and continue as if the session existed: a failed `show()`, failed webview creation, failed layout commit, or failed channel open SHALL abort the carrier bootstrap with the error persisted to `app.log`. The toolbar carrier SHALL append one structured step record per bootstrap milestone (shell listen, tray create, window show, toolbar webview, content webview, layout, channel open) to `app.log`, so any later failure is attributable to a specific step without on-site archaeology.

#### Scenario: SDK failure leaves a trace

- **GIVEN** a generated app whose tray creation throws
- **WHEN** the entry exits
- **THEN** `app.log` SHALL contain the error message and stack
- **AND** the process exit code SHALL be non-zero.

#### Scenario: Bootstrap failure is not swallowed

- **GIVEN** the initial `show()` or any carrier bootstrap step fails
- **WHEN** the entry handles the error
- **THEN** the carrier does not continue attaching child webviews against a non-existent session
- **AND** `app.log` records which milestone failed.

#### Scenario: Healthy startup writes a readable narrative

- **GIVEN** a toolbar-mode app starts successfully
- **WHEN** bootstrap completes
- **THEN** `app.log` contains one record per milestone in order
- **AND** an operator can determine session health from `app.log` alone.

### Requirement: A URL application SHALL offer toolbar mode, always-reachable reload, and the durable window sync defaults

Toolbar mode (`window.toolbar`) SHALL be carried by the multi-webview orchestration of the WebView extension: one navigation-toolbar webview (shell-served toolbar page at a fixed top strip) and one content webview loading the recorded address directly as a top-level browsing context, composed by the declarative layered layout. The payload SHALL include the shell server and toolbar UI assets while remaining free of the PTY dependency. The toolbar page SHALL command the entry's navigation surface (navigate, back/forward, reload, urlChange state) through an extension message channel whose schema is private to the create package; the shell server's toolbar navigation surface SHALL expose no navigation HTTP API — navigation commands, state queries, and state events flow exclusively over the channel, while the command-application terminal endpoints (PTY byte stream, event stream, terminal input) are terminal supervision, not navigation, and keep their existing laws and lifecycle. The address bar SHALL treat the content webview's `urlChange` events as its source of truth. The toolbar page SHALL render a loading progress affordance from the content webview's `loadState` events (indeterminate while `progress` is unknown) and SHALL display the current origin's favicon beside the address bar (client-side fetch of the origin's `/favicon.ico`, falling back to a letter glyph). New-window navigation intents from the content page (link targets, `window.open`, middle-click, context menu) SHALL open as auxiliary popup windows by default — no opt-in. Embedding policy (X-Frame-Options / CSP frame-ancestors) is not consulted: a top-level content webview is not an embedded context. Command-mode address-bar windows SHALL use the same carrier and the same toolbar page.

Non-toolbar windows SHALL project the config sync defaults: title follows the document one-way; icon following is opt-in. Toolbar windows SHALL project the same defaults onto the content webview, whose document is the real target page.

Every URL application's tray menu SHALL offer a `Reload` item that reloads the content webview without restarting the app. Toolbar pages SHALL bind back/forward/reload/address-focus keyboard shortcuts (⌘/Ctrl+←→, ⌘/Ctrl+[ ], ⌘/Ctrl+R, F5, ⌘/Ctrl+L); the documented limitation SHALL state that keystrokes land in whichever webview holds native focus, so the toolbar receives its shortcuts only while it holds focus.

#### Scenario: Embedding-hostile targets degrade to the direct window

- **GIVEN** `--toolbar` against an address whose response carries `X-Frame-Options: DENY`
- **WHEN** the toolbar application runs
- **THEN** the content webview SHALL load the address as a top-level browsing context and render it
- **AND** creation SHALL NOT probe, warn about, or strip the toolbar request for embedding-policy reasons

#### Scenario: Toolbar wraps the address without the PTY

- **GIVEN** a URL application generated with `toolbar: true`
- **WHEN** its payload is written and the entry runs
- **THEN** one window SHALL host the toolbar webview above the content webview through the layered layout
- **AND** the payload SHALL contain the shell server and toolbar assets but no `@lydell/node-pty` dependency
- **AND** the shell server SHALL expose no navigation HTTP endpoint (terminal-supervision endpoints of command applications are not navigation endpoints)

#### Scenario: The address bar follows page truth

- **GIVEN** a running toolbar application whose content webview shows a page with internal links
- **WHEN** the operator activates an in-page link
- **THEN** the address bar SHALL update from the content webview's `urlChange` event
- **AND** back/forward SHALL drive the content webview's native history through the entry's channel

#### Scenario: Tray reload is always reachable

- **GIVEN** any running URL application
- **WHEN** the tray Reload item is activated
- **THEN** the target page SHALL reload without the app process restarting

#### Scenario: Sync defaults project into the direct window

- **GIVEN** a URL application with default sync options, generated with or without toolbar
- **WHEN** its entry runs
- **THEN** the window title SHALL follow the real target document one-way (the content webview in toolbar mode)
- **AND** it SHALL NOT carry favicon→window icon sync unless explicitly opted in

### Requirement: A command application SHALL offer the same native toolbar carrier over its service window

A command application with `window.toolbar` enabled SHALL host the same navigation-toolbar carrier over each dedicated service window: one toolbar webview (shell-served toolbar page at a fixed top strip, created with the explicit bridge policy `{ webviewId: true, messageChannels: true }`) and one content webview (loading the verified service URL directly, created with no bridge policy and therefore bridgeless), composed by the declarative layered layout, driven by the same create-package channel navigation interface as URL applications. The behavior closure is the same as URL applications: the address bar treats the content webview's `urlChange` as truth, back/forward drive the content webview's native history, reload re-targets the content webview, and the window sync defaults project onto the content webview's real document (title one-way by default, icon following opt-in). The URL-application toolbar carrier follows the same two bridge policies for its toolbar and content webviews.

`window.toolbar` is the only canonical toolbar field: the legacy `showAddressBar` input (wizard advanced option, config shell field) is removed — its intent maps onto `window.toolbar`; stale `showAddressBar` occurrences in frozen legacy configs are ignored by loose parsing, and `show-startup-terminal` is unaffected. No generated payload of this change or later SHALL ship an iframe-wrapped service window. PTY supervision, port sniffing, startup-terminal, and teardown laws are unchanged: the toolbar composes the service window; it does not alter command supervision.

#### Scenario: Command toolbar composes the service window natively

- **GIVEN** a command application generated with `window.toolbar: true`
- **WHEN** a listened port opens its dedicated window
- **THEN** the window SHALL host the toolbar webview above a content webview loading the verified service URL
- **AND** the payload SHALL contain no iframe-wrapping browse page for the service window

#### Scenario: The command toolbar closes the behavior loop

- **GIVEN** a running command application with toolbar enabled and its service window open
- **WHEN** the service page navigates internally, and the operator uses back, forward, and reload from the toolbar
- **THEN** the address bar SHALL follow `urlChange` truth and the history actions SHALL drive the content webview's native history
- **AND** the window title SHALL follow the service document one-way by default

#### Scenario: The legacy showAddressBar input is gone and ignored

- **GIVEN** a frozen legacy config still carrying `showAddressBar`
- **WHEN** it is parsed by the current toolchain
- **THEN** the field SHALL be ignored without error and the window form SHALL be governed by `window.toolbar`
- **AND** new configs and exports SHALL never emit `showAddressBar`

#### Scenario: The toolbar never alters command supervision

- **GIVEN** a running command application with toolbar enabled
- **WHEN** the supervised command exits abnormally
- **THEN** the abnormal-exit force-reveal and teardown laws SHALL apply exactly as without the toolbar
