<!--
Orthogonal intents (maintained 2026-07-22; original user request: implement the
npm create-opentray initializer that turns a start command into an OpenTray-hosted
app through a WebUI wizard):
1. Guard the wizard loopback surface and preview-process lifecycle.
2. Discover HTTP services by port diffing and derive scrape-based defaults.
3. Freeze the form at confirmation and materialize through sanctioned OpenTray atoms.
4. End with an open-app action and platform-truthful pinning hint.
-->

## ADDED Requirements

### Requirement: Wizard Entry And Loopback WebUI

The `create-opentray` bin SHALL start a wizard HTTP server bound to `127.0.0.1`
on a free port unless `--port` selects one, serve the wizard page at a URL
containing a random session token, and open the default browser at that URL
unless `--no-open` is passed. The server SHALL reject every mutating request
whose bearer token does not match the session token or whose `Host` header is
not loopback, leaving wizard state unchanged. The wizard SHALL print the
tokened URL to stdout.

#### Scenario: Launch without a browser

- **GIVEN** `create-opentray --no-open`
- **WHEN** the wizard server binds
- **THEN** stdout SHALL show the tokened loopback URL and no browser process SHALL spawn

#### Scenario: Cross-origin mutation is rejected

- **GIVEN** a POST without the session token or with a non-loopback `Host`
- **WHEN** it reaches a mutating endpoint
- **THEN** the server SHALL respond 401 or 403 and wizard state SHALL remain unchanged

### Requirement: Run Command Once With Live Shell Output

The wizard SHALL spawn the submitted command locally without a shell on POSIX,
using `cmd /c` on Windows only when shell metacharacters require it, and SHALL
stream stdout/stderr chunks to the WebUI as server-sent events while bounding
retained output. The wizard SHALL terminate the spawned process tree on
shutdown, on stop, and before materialization, using recursive child
termination on POSIX and `taskkill /T` on Windows. A command that fails to
spawn or exits non-zero before any service appears SHALL return the wizard to
an editable state with the exit code and stderr visible.

#### Scenario: Immediate failure is observable and retryable

- **GIVEN** a command that cannot spawn or exits non-zero before any service appears
- **WHEN** it is submitted
- **THEN** the WebUI SHALL receive the exit code and stderr and the wizard SHALL accept a corrected command again

#### Scenario: Live output streams without session restart

- **GIVEN** a running command writing to stdout/stderr
- **WHEN** chunks arrive
- **THEN** the WebUI SHALL append each chunk as a log event over the event stream

### Requirement: Interactive Terminal Preview

The WebUI SHALL render the preview command through a real terminal emulator
(ghostty-web, xterm.js-compatible API) instead of a plain-text console, and
SHALL attach the command to a pseudo-terminal so interactive stdin works
(keystrokes, prompts, TUI output). The pseudo-terminal runtime SHALL be a
prebuilt per-platform distribution (`@lydell/node-pty`) so a normal
package-manager install needs no compilation toolchain. Terminal output SHALL
be transported as raw bytes without any server-side decoding or analysis: the
backend SHALL frame PTY output bytes base64-encoded onto the event stream and
the frontend SHALL decode them to bytes before writing into the terminal, so
even malformed byte sequences reach the renderer unchanged. Terminal input
SHALL take the reverse path (bytes from the terminal's data event, base64 to
the session-guarded input endpoint). The terminal panel SHALL appear
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

- **GIVEN** the advanced option enabled for a generated app
- **WHEN** a listened port opens its own dedicated window
- **THEN** the window SHALL render an address-bar wrapper page (bar on top, service in an iframe) whose navigation state is managed through the Web Navigation API (`window.navigation`), degrading gracefully where unavailable; with the option off, port windows open the service URL directly

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

### Requirement: Usable Form Without Running The Command

The identity form SHALL be visible and editable from the idle state, before
any command is run. Running the command SHALL be optional: it exists to
preview the command, validate it, and scrape default values. The wizard SHALL
derive placeholder defaults (appId from the pre-option command segment,
target directory from the appId) from the submitted command text without
spawning it. The form SHALL include an optional manual service-port input so
materialization can proceed without any discovered service; discovery results
SHALL prefill that input when present. Confirmation SHALL succeed using the
manual port when no service was discovered, and SHALL fail with a clear
message only when neither a discovered service nor a manual port exists.

#### Scenario: Idle form is fully usable

- **GIVEN** the wizard page in the idle state
- **WHEN** the user fills every identity field without ever pressing Run
- **THEN** confirmation and materialization SHALL proceed normally

#### Scenario: Defaults derive without spawning

- **GIVEN** an idle form and a command typed into the command bar
- **WHEN** the command text is primed (debounced input or blur)
- **THEN** the appId and target-dir placeholders SHALL reflect the derivation without any process being spawned

#### Scenario: Manual port substitutes for discovery

- **GIVEN** no discovered service and a manual port entered in the form
- **WHEN** the user confirms and generates
- **THEN** materialization SHALL use the manual port and the app SHALL point at that service URL

#### Scenario: Missing port fails clearly

- **GIVEN** neither a discovered service nor a manual port
- **WHEN** the user tries to confirm
- **THEN** the wizard SHALL reject with a clear message instead of materializing

### Requirement: Chrome-style Tabs Panel With Context Navigation

The WebUI SHALL present the terminal and service previews inside one
Chrome-style tabs panel (built with react-shadcn components) instead of
separate panels. The panel SHALL provide one terminal tab plus one iframe tab
per discovered service. A navigation bar above the content SHALL be
context-sensitive: on the terminal tab it SHALL display the running command;
on an iframe tab it SHALL display the service URL in an editable input with
back, forward, and reload controls backed by a per-tab navigation history.
An iframe tab SHALL be created automatically only after a discovered port has
been confirmed to answer an HTTP request; multiple confirmed ports SHALL open
multiple tabs. The terminal tab SHALL carry a bottom status bar showing at
least the cursor position and selection range read from the terminal buffer,
plus the discovered HTTP services as clickable entries that jump to the
matching iframe tab by URL hostname. Service previews are auxiliary: their
absence SHALL never block the core app-creation flow.

#### Scenario: Terminal tab shows the command in the navigation bar

- **GIVEN** a running preview command on the terminal tab
- **WHEN** the terminal tab is active
- **THEN** the navigation bar SHALL display the command the user submitted

#### Scenario: Iframe tab supports editing, back, and forward

- **GIVEN** an open iframe tab for a confirmed service
- **WHEN** the user edits the URL and navigates, then presses back and forward
- **THEN** the iframe SHALL follow the per-tab history entries

#### Scenario: Confirmed services auto-open tabs; unconfirmed do not

- **GIVEN** the preview command listens on two ports and one answers HTTP
- **WHEN** discovery polls
- **THEN** the confirmed port SHALL have an iframe tab and the unconfirmed port SHALL NOT

#### Scenario: Status bar links jump to the matching iframe tab

- **GIVEN** discovered services with open iframe tabs
- **WHEN** the user clicks a service entry in the terminal status bar
- **THEN** the tabs panel SHALL activate the iframe tab whose URL hostname matches

#### Scenario: No services does not block app creation

- **GIVEN** a running command with no confirmed HTTP service
- **WHEN** the user proceeds
- **THEN** the form SHALL remain completable with placeholder defaults and materialization SHALL stay available

### Requirement: Placeholder Defaults And Icon Input

The wizard form SHALL present auto-derived defaults as input placeholders
(appId derivation, scraped title as appName) rather than filled values: an
empty input SHALL mean "use the default" and confirmation SHALL resolve empty
fields to their placeholder defaults. The form SHALL include a dedicated icon
input with its own placeholder describing the fallback behavior (custom icon
path or scraped favicon; first-letter glyph when neither is available).

#### Scenario: Empty fields resolve to placeholder defaults

- **GIVEN** a submitted command with scraped title and derived appId shown as placeholders
- **WHEN** the user confirms without editing
- **THEN** the frozen identity SHALL use the placeholder default values

#### Scenario: Icon input carries a placeholder

- **GIVEN** the form is rendered
- **THEN** the icon input SHALL display a placeholder describing the icon source fallback chain

### Requirement: HTTP Service Discovery From Port Diffing

The wizard SHALL snapshot the set of listening TCP ports before spawning the
command, poll the listener set while the command runs, and list every new
listening port owned by the preview command's process tree that answers an
HTTP probe as a discovered service in first-seen order. Ports owned by other
processes (for example a browser's DevTools sockets) SHALL NOT be listed. The
first verified service SHALL be selected by default and the user SHALL be able
to switch selection. While no service appears the wizard SHALL keep polling
and expose manual port entry as a fallback. Listener enumeration SHALL use
`lsof` on macOS/Linux and `netstat` or PowerShell on Windows, with process
ownership from the listener PID columns.

#### Scenario: Multiple services list in first-seen order

- **GIVEN** a command opens ports 19080 then 19081
- **WHEN** both answer HTTP probes
- **THEN** the WebUI SHALL list both services with 19080 selected by default

#### Scenario: Foreign listeners are not adopted as services

- **GIVEN** an unrelated local process (for example a browser DevTools socket) listens on a new port while the preview command runs
- **WHEN** the wizard polls
- **THEN** that port SHALL NOT appear in the service list

#### Scenario: No service yet keeps waiting with fallback

- **GIVEN** a running command that has not opened a new listening port
- **WHEN** the wizard polls
- **THEN** it SHALL continue polling, show a waiting hint, and keep manual port entry available

### Requirement: Favicon Title Scrape And Default Derivation

For the selected service the wizard SHALL poll `http://127.0.0.1:<port>/`,
extract the `<title>` as default `appName`, and select favicon candidates by
declared `sizes` then apple-touch-icon then `/favicon.ico`, downloading the
bytes to a temporary file. Loopback fetches SHALL bypass system proxies. Scrape
results SHALL update only form fields the user has not edited, and switching
the selected service SHALL restart scraping for the new service. The default
`appId` SHALL be the command tokens before the first option-like token,
reversed and dot-joined, and the user SHALL be able to override every derived
value. A failed or empty scrape SHALL leave the form usable with a
first-letter-glyph icon fallback and SHALL NOT block the wizard.

#### Scenario: User edits win over later scrapes

- **GIVEN** the user typed an app name
- **WHEN** a later scrape returns a different title
- **THEN** the form SHALL keep the user's value

#### Scenario: Default appId derivation

- **GIVEN** the command `npx somecommand start --xx`
- **WHEN** defaults are derived
- **THEN** the default appId SHALL be `start.somecommand.npx`

#### Scenario: Scrape failure is non-fatal

- **GIVEN** the service returns no title and no usable favicon
- **WHEN** scraping completes
- **THEN** the form SHALL remain editable with fallback defaults instead of blocking

### Requirement: Form Freeze At Confirmation

When the user confirms creation the wizard SHALL freeze the form values so no
later scrape, service switch, or poll can mutate them, stop scraping, terminate
the preview process tree, and present a read-only dialog of the frozen
identity including appId, appName, icon source, target directory, selected
service, and package manager.

#### Scenario: Frozen values survive in-flight scrapes

- **GIVEN** a scrape was mid-flight when the user confirmed
- **WHEN** the dialog renders
- **THEN** it SHALL display the frozen values and no subsequent scrape result SHALL change them

### Requirement: App Materialization With Progress Log

On generate-confirmation the wizard SHALL stream each materialize step as log
events and SHALL: scaffold the project files (rejecting a non-empty target
directory unless `--force`), generate the strict platform AppIcon catalog from
the chosen icon source through the sanctioned OpenTray icon generator, install
dependencies with the detected or explicit package manager unless skipped, and
first-launch the generated entry with an absolute JavaScript runtime vector
waiting for its ready marker. On macOS success SHALL additionally require the
stable OpenTray app bundle under `~/.opentray/apps/`. Any step failure SHALL
mark the dialog failed with the failing step and allow retry. The scaffold
SHALL contain `package.json` depending on `opentray` and `@opentray/ext-webview`,
`opentray.app.json` with schemaVersion 1 and the frozen identity plus command
vector, service port, and window size, `main.mjs`, an `app-icon/` asset
directory, and a README.

#### Scenario: Scaffold output shape

- **GIVEN** materialize succeeds
- **WHEN** the target directory is inspected
- **THEN** it SHALL contain package.json, opentray.app.json, main.mjs, app-icon/ assets, and README.md

#### Scenario: Generated entry supervises the command and opens an appMode window

- **GIVEN** the generated `main.mjs` runs
- **WHEN** the recorded service port answers
- **THEN** the entry SHALL have spawned the command supervised with output appended to app.log, registered the tray with the frozen appId, appName, and AppIcon plus an explicit absolute appLaunch vector, shown an `appMode: true` WebView window on the service URL, and exposed a tray Quit that tears down the session, window, and command tree

#### Scenario: Non-empty target directory is refused

- **GIVEN** the target directory contains foreign files and `--force` was not passed
- **WHEN** materialize starts
- **THEN** it SHALL fail with a clear message and write nothing into the directory

### Requirement: Success Dialog With Open App And Pinning Hint

On success the dialog SHALL show the project path and, on macOS, the stable
bundle path, an open-app action, and a platform pinning hint describing
Windows taskbar or macOS Dock pining, without claiming persistent Windows
shortcut generation. The open-app action SHALL on macOS open the stable
`.app` bundle (cold launch through the launch descriptor, warm reopen focusing
the retained window) and elsewhere launch the generated entry detached with an
absolute runtime vector.

#### Scenario: Open app reveals the materialized application

- **GIVEN** the dialog shows success on macOS
- **WHEN** the user triggers open-app
- **THEN** the app window SHALL become visible or focused with the generated icon and name in the Dock

### Requirement: Publishable create-opentray Package

The repository SHALL publish `packages/create` as `create-opentray` with a
`create-opentray` bin, inside the fixed changeset release group, with a README
contract and consumer documentation under the public skill tree. Its runtime
dependencies SHALL be limited to Node built-ins and workspace packages, and the
wizard WebUI SHALL ship as static assets inside `dist` so a normal
package-manager execution needs no repository checkout or manual broker steps.

#### Scenario: Normal registry execution is self-sufficient

- **GIVEN** a user runs `npx create-opentray` from the npm registry
- **WHEN** the wizard starts
- **THEN** it SHALL operate end-to-end without source-checkout, staging, or manual daemon commands
