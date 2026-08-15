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
SHOULD attach the command to a pseudo-terminal so interactive stdin works
(keystrokes, prompts, TUI output). The terminal panel SHALL appear immediately
when the user triggers Run, before any process output or state event arrives.
Terminal output SHALL stream to the page over the event stream, terminal input
SHALL be forwarded through a session-guarded input endpoint, and terminal
resize SHALL propagate to the pseudo-terminal. When the native PTY dependency
is unavailable, the wizard SHALL degrade to non-interactive pipe mode, render
output through the same terminal surface with a visible notice, and reject
input endpoints clearly instead of failing the wizard.

#### Scenario: Terminal panel appears instantly on Run

- **GIVEN** the wizard page with a command entered
- **WHEN** the user clicks Run
- **THEN** the terminal panel SHALL be visible immediately without waiting for process output or a state event

#### Scenario: Interactive input reaches the command

- **GIVEN** a PTY-attached preview command reading stdin
- **WHEN** the user types into the terminal and the input is posted to the input endpoint
- **THEN** the command SHALL receive the keystrokes and its response SHALL stream back to the terminal

#### Scenario: PTY unavailability degrades without breaking the wizard

- **GIVEN** the native PTY dependency failed to load or install
- **WHEN** a command is submitted
- **THEN** the wizard SHALL run it in pipe mode, stream output to the terminal with a non-interactive notice, and keep discovery/scrape/materialize fully functional

#### Scenario: Resize propagates to the pseudo-terminal

- **GIVEN** a PTY-attached preview command
- **WHEN** the terminal is resized and the new dimensions are posted
- **THEN** the pseudo-terminal SHALL adopt the new columns and rows

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
