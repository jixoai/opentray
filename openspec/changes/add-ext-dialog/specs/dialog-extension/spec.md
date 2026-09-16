## ADDED Requirements

### Requirement: The dialog extension SHALL expose a session-scoped native dialog capability

`@opentray/ext-dialog` SHALL attach through the tray/session contract as `attachDialog(tray, options?)`, returning a capability whose methods dispatch broker commands scoped to `(appId, trayId, sessionId)`. The capability SHALL expose `messageDialog`, the `alert`/`confirm` sugars, `pickFile`, `pickDirectory`, and `pickSavePath`, plus a read-only `backend` capabilities snapshot (sound feedback belongs to `@opentray/ext-sound`, a separate capability atom). Every show command SHALL be asynchronous: the broker SHALL register a pending response identified by `(session, dialogToken)` and SHALL deliver the command response exactly when the dialog is dismissed, never holding the transport thread. Linux targets SHALL be rejected by the facade with a typed `dialog_platform_unsupported` error before any broker connection.

#### Scenario: Session close withdraws a pending dialog with cancellation semantics

- **GIVEN** a shown dialog whose owning session is still open
- **WHEN** the session closes while the dialog is pending
- **THEN** extension cleanup SHALL withdraw the native dialog, and the pending promise SHALL resolve with cancellation semantics (`messageDialog` → the `cancelId` branch, pickers → `null`), indistinguishable from user cancellation

#### Scenario: Linux invocation is rejected before broker dispatch

- **GIVEN** the facade running on a `linux-*` target
- **WHEN** any capability method is called
- **THEN** the call SHALL reject with typed `dialog_platform_unsupported` without connecting to or dispatching through the broker

### Requirement: Message dialogs SHALL resolve force-dismissal through the cancel button

`messageDialog` SHALL accept `message`, `detail`, `buttons`, `defaultId`, `cancelId`, `severity`, and `suppressionLabel`. Close, escape, and any system dismissal SHALL resolve to `cancelId` when defined, otherwise to button index `0`; implementations SHALL guarantee this mapping natively (macOS escape keyEquivalent on the cancel button; win32 `TDF_ALLOW_CANCELLATION` defaulting on with `cancelId`). When `suppressionLabel` is present the dialog SHALL show the suppression checkbox and the result SHALL report its final state as `suppressed`; the extension SHALL NOT persist that state. `alert` SHALL be the `["OK"]` button set and `confirm` SHALL be `["OK","Cancel"]` with `defaultId: 0` and `cancelId: 1` returning `response === 0`.

#### Scenario: Forced close maps to the cancel branch

- **GIVEN** a message dialog with buttons `["Save","Cancel","Discard"]` and `cancelId: 1`
- **WHEN** the user closes the dialog via the title bar or escape
- **THEN** the promise SHALL resolve with `response: 1`

#### Scenario: Suppression state is reported, not remembered

- **GIVEN** a message dialog with `suppressionLabel` and a checked suppression checkbox at dismissal
- **WHEN** the same dialog is shown again later in the same process
- **THEN** the result of the first call SHALL report `suppressed: true` and the second showing SHALL start unchecked — persistence is the application's own state

### Requirement: Pickers SHALL return absolute paths or a typed cancellation

`pickFile`, `pickDirectory`, and `pickSavePath` SHALL resolve `null` on user cancellation and absolute canonical paths (`~` expanded) on confirmation; `pickSavePath` results SHALL NOT be guaranteed to exist. `filters` SHALL be extension-based (dot-free, case-insensitive), mapped to `UTType(filenameExtension:)` on darwin and `COMDLG_FILTERSPEC` on win32; omitted or empty filters SHALL mean all files. `multiple: true` SHALL return at least one path on confirmation.

#### Scenario: Cancellation is null, never an empty selection

- **GIVEN** a multi-select file picker opened with two files checked
- **WHEN** the user presses cancel
- **THEN** the promise SHALL resolve `null`, not an empty array

### Requirement: Platform namespaces SHALL be strictly validated typed surfaces

Platform-specific options SHALL be expressed only through the structured `options.darwin` / `options.win32` namespaces (design-reference §2), never as unnamespaced platform fields in the common options. A namespace that does not match the current platform SHALL reject with typed `dialog_platform_namespace_mismatch` carrying the offending namespace and current platform; unknown fields in any namespace or common option SHALL reject with typed `dialog_invalid_options`; a namespace-specific feature whose backend capability is unavailable (e.g. `commandLink` without TaskDialog support) SHALL reject with typed `dialog_capability_unavailable`. Silent ignore and silent downgrade SHALL NOT occur.

#### Scenario: A win32 namespace on darwin is rejected, not ignored

- **GIVEN** the facade running on darwin
- **WHEN** `messageDialog` is called with `win32: { buttonStyle: "commandLink" }`
- **THEN** the call SHALL reject with typed `dialog_platform_namespace_mismatch` naming the `win32` namespace and the `darwin` platform

#### Scenario: Command-link hints require command-link style

- **GIVEN** the facade running on win32 with TaskDialog support
- **WHEN** `buttonHints` is supplied while `buttonStyle` is `"standard"`
- **THEN** the call SHALL reject with typed `dialog_invalid_options`

### Requirement: Every platform build SHALL serialize the DialogBackendCapabilities DTO

The native extension SHALL embed and report a `DialogBackendCapabilities` DTO (platform, taskDialog, commandLinks, expander, suppression, packageSemantics, mixedFileDirectorySelection, addToRecentControl). A capability field added to the TypeScript surface SHALL be serialized by every platform's DTO and constructor; cross-compilation of the darwin target SHALL fail if the win32 projection is missing (the WebView `WindowCapabilities` compile-gate rule applied to dialogs).

#### Scenario: Runtime truth overrides static expectation

- **GIVEN** a win32 environment where the comctl32 v6 context is unavailable and dialogs fall back to MessageBox
- **WHEN** the facade reads `backend`
- **THEN** `taskDialog` and `commandLinks` SHALL report `false`, and a `commandLink`-styled call SHALL reject with `dialog_capability_unavailable` rather than silently rendering standard buttons

### Requirement: A modal dialog SHALL NOT stall tray event delivery

While any dialog is open, the broker SHALL keep dispatching tray events for other trays of the same app and for other apps' sessions. On macOS the dialog SHALL run through a modal-session stepping integration with the winit event loop (a bare `runModal` from command dispatch is prohibited); on win32 the dialog SHALL run on the GUI STA thread whose modal pump keeps dispatching window messages. At most one dialog SHALL be active per `(appId, trayId, sessionId)`; a second concurrent show in the same session SHALL reject with typed `dialog_session_busy` before native presentation. Cross-session concurrency SHALL remain legal.

#### Scenario: Another tray stays alive while a dialog is open

- **GIVEN** one app with two trays, one showing a modal message dialog
- **WHEN** the user opens and clicks the other tray's menu
- **THEN** the menu interaction SHALL be dispatched and its handler resolved while the dialog remains open

#### Scenario: Same-session second dialog is a typed rejection

- **GIVEN** a session with an open directory picker
- **WHEN** the same session calls `pickFile`
- **THEN** the call SHALL reject with typed `dialog_session_busy` and no second native dialog SHALL appear

### Requirement: The facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-dialog` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` through a new SDK `kind: "embedded"` native artifact (per-target `libraryPath` relative to the facade package root, identity resolved from the facade version plus `contract.json`, accessibility and missing-target failures typed identically to the existing package kind). The workspace pack-size audit SHALL measure the npm-pack compressed size of every package embedding platform binaries, warn at ≥ 2 MB (an explicit Owner split decision is required before the next embedded release), and fail beyond 3 MB (the package must be split into `@opentray/<name>-<os>-<arch>` per-platform packages). Already-published per-platform packages are not retroactively affected.

#### Scenario: Embedded artifact resolves one library per target from the facade package

- **GIVEN** the installed `@opentray/ext-dialog` facade on `darwin-arm64`
- **WHEN** the SDK resolves the dialog extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_dialog.dylib` with expected identity `{ extensionName: "dialog", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-dialog-contract-1" }`

#### Scenario: The size gate fails an oversized embedded package

- **GIVEN** a package embedding platform binaries whose npm-pack compressed size is 3.5 MB
- **WHEN** the pack-size audit runs in CI
- **THEN** the audit SHALL fail with the measured size, requiring a split into per-platform packages
