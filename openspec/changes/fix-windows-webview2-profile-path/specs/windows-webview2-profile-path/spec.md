# Windows WebView2 Profile Path

### Requirement: WebView2 profile storage SHALL be executable-path independent

The Windows WebView host SHALL create WebView2 with an explicit 'WebContext' data directory. It SHALL NOT rely on Wry's default executable-relative profile location.

#### Scenario: Temporary package installation

- **GIVEN** a caller starts OpenTray from a temporary or deeply nested package path such as 'pnpx'
- **WHEN** the first WebView window is created
- **THEN** WebView2 uses the explicit user-writable profile path
- **AND** startup does not depend on the broker executable path depth

### Requirement: Default profile paths SHALL be isolated and bounded

When 'OPENTRAY_WEBVIEW_DATA_DIR' is not set, the host SHALL resolve:

    <home>/.opentray/webview/<package-version>/<caller-label>

'<home>' SHALL come from 'OPENTRAY_DAEMON_HOME' when supplied, with the Windows user profile as fallback. Version and caller components SHALL be sanitized before they are appended as path components.

#### Scenario: Two callers

- **WHEN** two callers use the same OpenTray package version
- **AND** their caller labels differ
- **THEN** their WebView2 profile directories differ

#### Scenario: Two package versions

- **WHEN** one caller upgrades OpenTray
- **THEN** the new version uses a separate profile directory

### Requirement: Profile ownership SHALL cover WebView lifetime

The native slot SHALL retain the 'WebContext' for at least as long as the 'WebView' created from it.

#### Scenario: WebView operations after construction

- **WHEN** a retained window navigates, changes bounds, or opens devtools
- **THEN** the context backing the WebView remains alive and valid

### Requirement: Diagnostics SHALL identify the profile

- **WHEN** WebView2 creation fails
- **THEN** the returned native error SHALL include the resolved profile path
