## MODIFIED Requirements

### Requirement: Interactive Terminal Preview

The WebUI SHALL render the preview command through a real terminal emulator
(ghostty-web, xterm.js-compatible API) instead of a plain-text console, and
SHALL attach the command to a pseudo-terminal so interactive stdin works
(keystrokes, prompts, TUI output). The pseudo-terminal runtime SHALL be a
prebuilt per-platform distribution (`@lydell/node-pty`) so a normal
package-manager install needs no compilation toolchain. Terminal output SHALL be
transported as raw bytes without any server-side decoding or analysis: the
backend SHALL frame PTY output bytes base64-encoded onto the event stream and
the frontend SHALL decode them to bytes before writing into the terminal, so
even malformed byte sequences reach the renderer unchanged. Terminal input SHALL
take the reverse path (bytes from the terminal's data event, base64 to the
session-guarded input endpoint). The terminal panel SHALL appear
immediately when the user triggers Run, before any process output or state
event arrives, and terminal resize SHALL propagate to the pseudo-terminal.
When the native PTY dependency is unavailable, the wizard SHALL degrade to
non-interactive pipe mode with a visible notice instead of failing.

#### Scenario: Raw bytes pass through unmodified

- **GIVEN** a PTY-attached command emitting bytes that are not valid UTF-8
- **WHEN** the output streams to the WebUI
- **THEN** the backend SHALL transport those bytes base64-encoded without replacement or decoding, and the terminal SHALL receive them verbatim for rendering

#### Scenario: Terminal panel appears instantly on Run

- **GIVEN** the wizard page with a command entered
- **WHEN** the user clicks Run
- **THEN** the terminal panel SHALL be visible immediately without waiting for process output or a state event

#### Scenario: Interactive input reaches the command

- **GIVEN** a PTY-attached preview command reading stdin
- **WHEN** the user types into the terminal and the input is posted to the input endpoint
- **THEN** the command SHALL receive the exact keystroke bytes and its response SHALL stream back to the terminal

#### Scenario: PTY unavailability degrades without breaking the wizard

- **GIVEN** the native PTY dependency failed to load or install
- **WHEN** a command is submitted
- **THEN** the wizard SHALL run it in pipe mode, stream output with a non-interactive notice, and keep discovery/scrape/materialize fully functional

#### Scenario: Resize propagates to the pseudo-terminal

- **GIVEN** a PTY-attached preview command
- **WHEN** the terminal is resized and the new dimensions are posted
- **THEN** the pseudo-terminal SHALL adopt the new columns and rows

#### Scenario: Output is buffered while the renderer loads

- **GIVEN** a preview command producing output while the ghostty renderer is still initializing
- **WHEN** output chunks arrive before the terminal instance is ready
- **THEN** the chunks SHALL be buffered and flushed in order once ready; no byte SHALL be dropped due to renderer startup

#### Scenario: Bun runtime attaches through the built-in Terminal API

- **GIVEN** the wizard running under Bun with `Bun.Terminal` available (Bun ≥ 1.2.19)
- **WHEN** a preview command starts
- **THEN** the terminal SHALL attach through `Bun.Terminal` + `Bun.spawn({ terminal })` with full interactivity, and SHALL NOT load the node-pty optional dependency

#### Scenario: Missing PTY backends degrade to read-only pipes with a notice

- **GIVEN** a runtime with neither `Bun.Terminal` nor a loadable node-pty
- **WHEN** a preview command starts
- **THEN** the wizard SHALL fall back to pipe transport with a visible notice instead of a silent empty terminal

#### Scenario: Tray icon defaults to the app icon choice

- **GIVEN** the identity form
- **WHEN** an app icon is scraped, selected, or uploaded
- **THEN** the tray icon SHALL default to the same choice, remain independently selectable in the advanced panel, and the generated project SHALL receive a platform-suitable tray icon asset

#### Scenario: Advanced panel offers solid-color tray candidates

- **GIVEN** scraped icon candidates
- **WHEN** the advanced tray picker renders
- **THEN** it SHALL also offer solid-color conversions of the candidates, deduplicated among themselves, and clicking any candidate SHALL select it as the tray icon

#### Scenario: Show-startup-terminal opens a dedicated terminal window

- **GIVEN** the advanced option enabled for a generated app
- **WHEN** the app starts
- **THEN** it SHALL open a SEPARATE window dedicated to the terminal, reusing the wizard's terminal-page components (command bar + status bar including listened ports), streaming the command's PTY output interactively

#### Scenario: Show-address-bar wraps service windows with an address bar

- **GIVEN** a generated command application with `window.toolbar: true` (the unified navigation-toolbar option; the legacy `showAddressBar` advanced input no longer exists)
- **WHEN** a listened port opens its own dedicated window
- **THEN** the window SHALL host the navigation-toolbar carrier — one toolbar webview at a fixed top strip and one content webview loading the verified service URL directly, composed by the WebView extension's declarative layered layout; with the option off, port windows open the service URL directly
- **AND** no generated window SHALL wrap the service in an iframe browse page

#### Scenario: Every listened port opens its own window

- **GIVEN** a running generated app
- **WHEN** multiple owned ports are listening
- **THEN** each SHALL have its own dedicated window opened automatically

#### Scenario: The service port is never hard-bound

- **GIVEN** any generated app (with or without shell options)
- **WHEN** it needs the service address
- **THEN** the port SHALL come exclusively from runtime sniffing (owned-listener scan plus HTTP verification); a recorded preview port is informational only and MUST NOT be addressed without verification
- **AND** the wizard form SHALL NOT offer a manual service-port input
- **AND** with no sniffed port at confirm time the app SHALL still materialize and sniff when it runs the command itself

#### Scenario: The target directory needs no form field

- **GIVEN** the wizard form
- **THEN** it SHALL NOT expose a target-directory input; the CLI positional argument and the derived default own that decision

#### Scenario: Detached ports mark the window title

- **GIVEN** an open service tab whose port stops listening
- **WHEN** the detach is detected
- **THEN** the window title SHALL read `XXXX (detached)` until the port listens again

#### Scenario: Tabs sit above the context toolbar

- **GIVEN** the tabs panel
- **WHEN** it renders
- **THEN** the tab strip SHALL appear above the context toolbar (command on the terminal tab, URL bar on service tabs)

#### Scenario: Service tabs are kept alive across switches

- **GIVEN** an open service tab whose page has loaded
- **WHEN** the user switches to another tab and back
- **THEN** the service page SHALL NOT reload; its state SHALL persist

#### Scenario: A newly sniffed service opens and focuses its tab

- **GIVEN** the terminal tab active and a new owned HTTP service confirmed
- **WHEN** the service tab is created
- **THEN** the panel SHALL switch to it automatically

#### Scenario: Icon candidates are ranked, deduplicated, and clickable

- **GIVEN** a service whose HTML declares multiple icons (SVG, apple-touch-icon, sized PNGs)
- **WHEN** the page is scraped
- **THEN** every decodable candidate SHALL be collected with its true pixel dimensions, ranked by clarity descending, near-duplicate images SHALL be hidden, and each candidate SHALL be shown as a clickable thumbnail that fills the app icon on click
- **AND** the icon input SHALL be a square file picker (with local upload) occupying its own full row, not a text placeholder

#### Scenario: SVG favicons are scraped

- **GIVEN** a page declaring `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- **WHEN** scraped
- **THEN** the SVG SHALL be collected as a candidate (never silently skipped) and remain usable for icon generation

#### Scenario: Run button reflects process lifecycle

- **GIVEN** a preview command running
- **WHEN** the command is alive
- **THEN** the run control SHALL present an Interrupt action; when the process exits or is killed externally, the run control SHALL return to Run and the command input SHALL become editable again

#### Scenario: Plain click-and-type works and survives tab switches

- **GIVEN** a PTY-attached preview command and the wizard tabs panel
- **WHEN** the user clicks the terminal surface with the mouse and types, including after switching to a service tab and back
- **THEN** the keystrokes SHALL reach the command; the terminal instance SHALL NOT be destroyed by tab switches

## ADDED Requirements

### Requirement: The wizard SHALL expose the navigation toolbar option

The wizard form SHALL offer an explicit 「导航工具栏」 toggle in the window-options section for both application flows (URL and command), defaulting to off. The toggle SHALL be a desired-state fact: it compiles into the v1 `window.toolbar` field, persists through draft reload, and round-trips through edit/export exactly like the CLI flag. Enabling it SHALL require no embedding knowledge — the wizard SHALL NOT probe, warn about, or condition the toggle on any target-site policy.

Boundary: the wizard's own authoring-time service preview tabs (the stable iframe panel) are a preview-only surface — they SHALL never be the carrier for any materialized application; generated toolbar windows use the multi-webview carrier exclusively.

#### Scenario: The toggle defaults off and commits on enable

- **GIVEN** a wizard session for a URL or command application
- **WHEN** the window options render
- **THEN** the 「导航工具栏」 toggle SHALL be visible and default to off
- **AND** enabling it before confirmation SHALL commit `window.toolbar: true` into the frozen config

#### Scenario: Command applications get the same toggle

- **GIVEN** a wizard session in the command flow with a verified service
- **WHEN** the operator enables the navigation toolbar
- **THEN** the generated application SHALL compose the toolbar over the service window with the same carrier as URL applications — the same toolbar page assets and the same entry composition path, not a preview reuse
