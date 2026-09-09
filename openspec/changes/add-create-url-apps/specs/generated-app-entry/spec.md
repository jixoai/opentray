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
