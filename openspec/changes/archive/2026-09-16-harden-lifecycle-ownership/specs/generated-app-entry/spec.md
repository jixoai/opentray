# generated-app-entry delta

## MODIFIED Requirements

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
