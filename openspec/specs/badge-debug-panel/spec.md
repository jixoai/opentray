# badge-debug-panel Specification

## Purpose
TBD - created by archiving change implement-ext-badge-status-surface. Update Purpose after archive.
## Requirements
### Requirement: macOS badge debug panel SHALL be a WebView proof surface

The repository SHALL provide a macOS-visible badge debug panel that exercises `@opentray/ext-badge` through the existing `@opentray/ext-webview` IPC and navigator bridge law. The panel SHALL exist as a proof surface for development and testing, not as a new source of badge ontology.

The panel SHALL not bypass the badge extension contract. It SHALL call the same capability-gated badge operations that a real client would use, and it SHALL display the returned capability metadata and typed unsupported results.

#### Scenario: Debug panel drives the real badge contract

- **GIVEN** the macOS debug panel is open
- **WHEN** the operator toggles badge, progress, overlay, or attention controls
- **THEN** the panel sends the corresponding badge extension command through WebView IPC
- **AND** the rendered result reflects the extension response, not a mocked local state machine.

### Requirement: Debug panel SHALL make platform truth visible

The debug panel SHALL show the current platform, the badge capability matrix, and the latest operation result. It SHALL make reduced or unsupported Linux-like behavior obvious when the runtime cannot project a family truthfully.

#### Scenario: Debug panel shows unsupported results explicitly

- **GIVEN** the panel requests a badge family the runtime cannot project
- **WHEN** the extension rejects the command
- **THEN** the panel displays the typed unsupported result
- **AND** it does not paint the request as successful.

### Requirement: Debug panel SHALL remain repo-local and operator-oriented

The badge debug panel SHALL stay inside the repository examples, docs, or acceptance tooling. It SHALL not become part of the public npm surface of `@opentray/ext-badge`.

#### Scenario: Public package stays focused

- **GIVEN** a consumer installs `@opentray/ext-badge`
- **WHEN** they inspect the public package exports
- **THEN** they see the badge capability contract
- **AND** they do not need to import the debug panel to use the extension.

