## ADDED Requirements

### Requirement: App identity SHALL own the application icon

The app-facing runtime configuration SHALL accept optional `appIcon?: Icon` alongside `appId` and `appName`. `appIcon` SHALL describe process-level Dock/taskbar identity and SHALL NOT be a WebView window metadata field. A WebView title, favicon, or `window.setIcon()` call SHALL NOT mutate the App identity icon.

The runtime SHALL resolve one immutable App identity snapshot at initialization. Resolution order SHALL be:

```text
explicit appIcon
  > first tray icon at app initialization
  > packaged Darwin carrier or platform runtime icon
```

The resolved value SHALL be reused by all app-mode windows in that runtime. Later tray icon updates and later WebView icon updates SHALL not change the App identity snapshot. An explicit `appIcon` that is not native-capable SHALL reject with a typed validation error; the runtime SHALL not silently substitute a page URL or a tray-only text template.

#### Scenario: Explicit app icon wins

- **GIVEN** runtime options provide `appIcon`
- **AND** the first tray also provides an icon
- **WHEN** the App identity is initialized
- **THEN** the explicit app icon is selected
- **AND** the tray icon remains only the tray projection.

#### Scenario: App icon inherits the first tray icon once

- **GIVEN** runtime options omit `appIcon`
- **AND** the first tray created during initialization provides a native-capable icon
- **WHEN** the App identity is initialized
- **THEN** the first tray icon becomes the immutable App identity snapshot
- **AND** a later tray icon update does not change it.

#### Scenario: Window icon changes do not change App identity

- **GIVEN** an App identity has been initialized
- **WHEN** a WebView calls `setIcon()` or navigates to a page with a favicon
- **THEN** only the WebView/page metadata changes
- **AND** the Dock/taskbar App identity icon remains unchanged.

#### Scenario: Invalid explicit app icon is rejected

- **GIVEN** runtime options provide an `appIcon` that is remote, tray-only text, or otherwise not native-capable
- **WHEN** App identity initialization validates it
- **THEN** initialization rejects with a typed validation error
- **AND** it does not silently fall back to a page or tray representation.

### Requirement: App identity SHALL remain caller-owned and session-isolated

The App identity snapshot SHALL be created from the caller-owned runtime seam used by `createTray(...)`. `createWebviewWindow(...)` SHALL not be able to create, replace, or globally mutate App identity. A runtime host SHALL associate the resolved App identity with its one owning caller session and SHALL clear native projections when that session closes.

#### Scenario: Window creation cannot replace App identity

- **GIVEN** a runtime already has a resolved App identity
- **WHEN** a WebView window is created with a different window icon
- **THEN** the App identity remains unchanged
- **AND** the window icon is scoped to that window session.

#### Scenario: Session close clears App projections

- **GIVEN** a runtime session owns an App identity and one or more app-mode windows
- **WHEN** the owning caller disconnects or destroys its session
- **THEN** all app-mode windows and their Shell projections are removed
- **AND** no retained App identity remains visible without a live owning session.
