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

### Requirement: Darwin runtime distribution SHALL include the shared App carrier

The published `@opentray/darwin-arm64` and `@opentray/darwin-x64` runtime packages SHALL contain one coherent Darwin runtime artifact set: the OpenTray broker executable and the shared `.app` carrier used to establish process identity, AppKit activation policy, and Dock participation. The carrier SHALL be built and discovered by the OpenTray runtime/release layer, not by `opentray-core` and not by an extension-private package.

`opentray-core` SHALL remain platform-neutral: it may define App identity state, protocol frames, and `AppProjection`, but it SHALL NOT contain AppKit code, `.app` bundle files, or carrier launch logic. `@opentray/ext-badge` SHALL own only badge/overlay semantics and its native library; it SHALL consume the shared carrier contract when needed and SHALL NOT be the distribution owner of the runtime carrier.

The Darwin runtime package SHALL publish one matching broker executable and one minimal carrier template without embedding a duplicate broker in a carrier archive. The Node runtime SHALL project the caller `appId`, bootstrap `appName`, and default Darwin `appIcon` into a stable App bundle and launch the broker from `Contents/MacOS`. Shipping an idle helper bundle beside a separately launched raw broker SHALL NOT satisfy this requirement.

The default bundle path SHALL be derived from the caller npm package name independently from daemon version and `callerLabel`: scoped package `@scope/name` SHALL map to `~/.opentray/apps/@scope+name/<appName>.app`. An explicit `appBundle.path` SHALL win. The runtime SHALL resolve relative explicit paths against the caller package root rather than `process.cwd()` or the broker working directory.

`appBundle.reinitialize` SHALL default to `true`. Managed mode SHALL keep the `.app` directory path stable and rewrite only OpenTray-owned files through sibling-file replacement, committing the bundle manifest last. `reinitialize: false` SHALL treat the bundle as prebuilt and read-only; missing, malformed, target-incompatible, or broker-incompatible bundles SHALL return a typed error without falling back to mutation.

Package-name inference SHALL prefer explicit caller metadata, then build-adapter project metadata, `npm_package_name`, and the package manifest nearest the caller entry script. An `import.meta.url` owned by OpenTray itself SHALL NOT be used as evidence for the consumer package.

#### Scenario: Darwin package installs a complete runtime

- **GIVEN** a consumer installs a supported `@opentray/darwin-*` package through the normal package manager flow
- **WHEN** the runtime host starts an app-mode WebView
- **THEN** the package can discover both the matching broker executable and shared `.app` carrier from its own artifact graph
- **AND** no consumer-side copy, manual helper install, or `ext-badge` dependency is required.

#### Scenario: Broker executes inside the stable caller carrier

- **GIVEN** a supported Darwin runtime package contains one broker and a minimal carrier template
- **WHEN** a caller starts OpenTray with `appId: "com.skill-creator"` and `appName: "Skill Creator"`
- **THEN** the SDK materializes `~/.opentray/apps/<encoded-package-name>/Skill Creator.app`
- **AND** writes the selected default ICNS into `Contents/Resources` and records `CFBundleIconFile`
- **AND** injects the resolved broker without a second broker copy in the published package
- **AND** the broker `current_exe()` is that bundle's `Contents/MacOS` executable
- **AND** the Dock identity is `Skill Creator`, not the raw executable name `opentray`.

#### Scenario: Carrier reuse remains artifact-coherent

- **GIVEN** a caller-scoped carrier was materialized from one broker artifact
- **WHEN** the resolved carrier or broker artifact identity changes
- **THEN** the SDK replaces the materialized carrier under the existing lifecycle lock
- **AND** an already-running broker is reused only when its executable path and artifact identity match the current materialized bundle.

#### Scenario: Prebuilt bundle remains read-only

- **GIVEN** an `@opentray/*-plugin` generated a complete compatible App bundle
- **AND** the caller passes its path with `reinitialize: false`
- **WHEN** `createTray` starts the Darwin broker
- **THEN** the runtime validates the bundle manifest, plist, target, executable, and hashes
- **AND** launches the embedded broker without rewriting any bundle file
- **AND** rejects incompatibility with a typed error rather than rebuilding it.

#### Scenario: Build adapters share one bundle implementation

- **GIVEN** Vite, esbuild, webpack, or tsdown integrates OpenTray packaging
- **WHEN** its OpenTray appBundle plugin runs
- **THEN** the adapter delegates generation to `@opentray/packaging`
- **AND** emits the same manifest and bundle layout consumed by the runtime
- **AND** no build adapter owns a private carrier format.

#### Scenario: Core crate remains free of bundle ownership

- **GIVEN** the platform-neutral kernel is built or tested
- **WHEN** it handles App identity projection
- **THEN** it carries only protocol/domain state and backend contracts
- **AND** it does not compile, launch, or package a Darwin `.app` bundle.

#### Scenario: Badge package does not own the runtime carrier

- **GIVEN** a caller mounts `@opentray/ext-badge`
- **WHEN** the badge native artifact is staged or loaded
- **THEN** the package contributes badge capability artifacts only
- **AND** the shared Darwin carrier remains owned and versioned by the matching `@opentray/darwin-*` runtime package.

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
