## ADDED Requirements

### Requirement: Darwin Shell membership SHALL aggregate live app-mode windows

The Darwin runtime SHALL project a process with at least one live app-mode WebView window as a regular application (`NSApplication` activation policy `.regular`). When no live app-mode WebView window remains, the runtime SHALL return to accessory policy (`.accessory`) while preserving tray-only windows. The aggregation key SHALL be the owning `(appId, sessionId, windowId)` state, not a local boolean in one window handler.

The Darwin carrier SHALL own the process identity and activation-policy transition. `ext-badge` and other extensions MAY consume the carrier, but they SHALL not implement a private competing `.app` lifecycle for the same runtime. A mixed runtime SHALL keep its tray icon and tray-only windows alive while any app-mode window is visible or retained according to the documented policy.

#### Scenario: First visible app-mode window promotes the process

- **GIVEN** a Darwin runtime is accessory-only with no live app-mode window
- **WHEN** an app-mode WebView is successfully shown
- **THEN** the carrier promotes `NSApplication` to regular policy
- **AND** the window is activated and visible to normal application switching.

#### Scenario: Closing one of multiple app-mode windows does not demote the process

- **GIVEN** two app-mode windows are live in one app/session
- **WHEN** one window is closed
- **THEN** its Shell projection is removed
- **AND** the process remains regular because another app-mode window is live.

#### Scenario: Last app-mode window returns the process to accessory policy

- **GIVEN** no app-mode window remains live after a close or destroy
- **WHEN** the carrier recomputes the aggregate projection
- **THEN** the process returns to accessory policy
- **AND** tray-only state remains owned by the caller until its session closes.

#### Scenario: Darwin carrier is reused instead of duplicated

- **GIVEN** `ext-badge` or another extension needs a regular Darwin application carrier
- **WHEN** it is packaged and launched
- **THEN** it uses the shared carrier contract
- **AND** it does not introduce a second extension-specific `.app` lifecycle law.

### Requirement: Platform capability reporting SHALL distinguish app-mode support

The WebView capabilities DTO SHALL report common `appMode` support separately from platform-specific appearance and geometry capabilities. A platform SHALL report `appMode: true` only when its native adapter can project the requested Shell membership and lifecycle transitions. Capability serialization SHALL be symmetric across TypeScript, protocol DTOs, Windows, macOS, and any platform adapter that claims support.

#### Scenario: macOS reports app-mode support when carrier is available

- **GIVEN** the Darwin carrier can switch activation policy and project an app identity
- **WHEN** a caller requests WebView capabilities
- **THEN** the macOS capability namespace reports app-mode support
- **AND** it does not expose the old Windows-only `showInSwitchers` field.

#### Scenario: Capability truth prevents unsupported app mode

- **GIVEN** a platform adapter cannot project normal Shell membership
- **WHEN** a caller requests WebView capabilities
- **THEN** app-mode support is reported as unavailable
- **AND** an app-mode request cannot resolve as a successful native operation.

### Requirement: Platform App identity projection SHALL distinguish grouping from artwork

Windows Shell grouping SHALL use the stable App identity (`appId` / AppUserModelID) independently from the selected App icon artwork. A change to App artwork SHALL not silently create a new grouping identity. Native adapters MAY project the updated artwork to currently visible windows and runtime surfaces, but SHALL report or reject any platform operation that would require updating a packaged shortcut, installed bundle metadata, or another immutable deployment artifact.

#### Scenario: App icon changes without taskbar regrouping

- **GIVEN** an app-mode Windows window is grouped by a stable `appId`
- **WHEN** the caller explicitly updates the App icon through the Core App handle
- **THEN** the current supported native artwork projection is updated
- **AND** the window remains in the same AppUserModelID group.

#### Scenario: Runtime title mutation does not rewrite deployment metadata

- **GIVEN** the caller updates the logical App name at runtime
- **WHEN** the platform adapter applies the projection
- **THEN** supported runtime/tray labels update
- **AND** the adapter does not claim to rewrite the Windows shortcut or macOS bundle display name.

### Requirement: Native close and reveal SHALL use one lifecycle transaction

Every supported platform SHALL route native close, host `close()`, tray `toVisible()`, and `visibleChange` through one extension-owned lifecycle projection. Native close SHALL not wait for a second unrelated event before updating visibility. Reveal SHALL activate the existing native session and apply the current App identity/Shell projection before reporting success.

#### Scenario: Native close reports promptly

- **GIVEN** an app-mode window is visible
- **WHEN** the native close button sends its platform close message
- **THEN** the window is hidden and operational visibility is updated in the same native lifecycle transaction
- **AND** one `visibleChange(false)` event is emitted.

#### Scenario: Reveal restores Shell membership

- **GIVEN** an app-mode session is hidden but retained
- **WHEN** the tray primary action calls `toVisible()`
- **THEN** the existing native window is shown and activated
- **AND** the platform Shell projection is present before the promise resolves.
