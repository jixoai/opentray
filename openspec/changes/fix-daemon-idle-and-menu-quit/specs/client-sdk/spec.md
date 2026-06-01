## MODIFIED Requirements

### Requirement: Human-visible daemon tray example SHALL validate the mainline path

The workspace SHALL provide a human-facing example runnable as `pnpm --filter opentray example:daemon-tray`. The example SHALL auto-start or reuse the same-version daemon, connect through the daemon endpoint, create a surface and tray through the public TypeScript SDK, print broker-created identities, and print routed tray/menu events. The example SHALL make its quit action unambiguous and SHALL exit when its quit menu item is routed back as a `menuClick` event. The example SHALL also cover the first-stage `@opentray/ext-webview` package command surface by invoking WebView facade actions through the public tray handle. On macOS, selecting `Show HTML` SHALL open a real native WebView window through the daemon runtime.

#### Scenario: Human can visually accept daemon tray

- **GIVEN** the developer runs `pnpm --filter opentray example:daemon-tray`
- **WHEN** the example connects to the local broker
- **THEN** a real tray item appears on supported desktop platforms
- **AND** the daemon is started automatically if no same-version daemon was already running
- **AND** selecting a menu item prints the routed event in the example output.

#### Scenario: Automated smoke can exit without human click

- **GIVEN** `OPENTRAY_EXAMPLE_EXIT_AFTER_MS` is set
- **WHEN** the daemon tray example runs
- **THEN** it exits after the configured duration
- **AND** it closes its broker connection so the lease cleanup path is exercised.

#### Scenario: Example demonstrates supported menu atoms

- **GIVEN** the daemon tray example creates its menu
- **WHEN** the menu is opened on a supported desktop platform
- **THEN** it includes item, disabled item, check, radio, separator, submenu, and quit actions
- **AND** click-capable items route events through the broker path.

#### Scenario: Quit item visibly exits the demo

- **GIVEN** the daemon tray example is running
- **WHEN** the user selects the quit menu item
- **THEN** the example prints the routed menu click
- **AND** the example closes its broker connection
- **AND** the example process exits without requiring a manual daemon stop.

#### Scenario: Example includes ext-webview command surface

- **GIVEN** the daemon tray example has created a tray handle
- **WHEN** the user selects WebView menu actions
- **THEN** the example calls `@opentray/ext-webview` facade methods such as `show`, `navigate`, `postMessage`, `evaluate`, and `hide`
- **AND** the extension commands travel through the public `TrayHandle.commandExtension` path
- **AND** the example prints the broker response or extension event output.

#### Scenario: WebView show action opens a real native window

- **GIVEN** the daemon tray example is running on macOS
- **WHEN** the user selects `WebView Commands -> Show HTML`
- **THEN** a real native WebView window appears with the demo HTML
- **AND** the terminal prints the routed menu click and accepted WebView command
- **AND** the implementation keeps `wry` out of `opentray-core`.
