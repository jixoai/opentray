## ADDED Requirements

### Requirement: App identity SHALL own the application icon

The app-facing runtime configuration SHALL accept optional `appIcon?: AppIcon` alongside `appId` and `appName`. `AppIcon` SHALL be a platform-oriented array of native application assets and SHALL be distinct from the tray `Icon` contract. `appIcon` SHALL describe process-level Dock/taskbar identity and SHALL NOT be a WebView window metadata field. A WebView title, favicon, or `window.setIcon()` call SHALL NOT mutate the App identity icon.

The public shape SHALL be equivalent to:

```text
AppIcon = AppIconAsset[]

darwin asset  = { platform: "darwin", format: "icns", variant?, source: FileOrEncoded }
windows asset = { platform: "windows", format: "ico", variant?, source: FileOrEncoded }
linux asset   = { platform: "linux", format: "png", size, variant?, source: FileOrEncoded }
              | { platform: "linux", format: "svg", variant?, source: FileOrEncoded }

variant = Name | Name[]
```

`FileOrEncoded` SHALL contain a path or encoded bytes for the declared native format. The facade SHALL validate a file relative to the caller and convert it to an absolute path before broker dispatch, so broker reuse cannot reinterpret it against another working directory. Raw RGBA buffers, text-only icons, template tray icons, page URLs, and remote favicons SHALL NOT be valid `appIcon` sources. Darwin and Windows accept one asset per `(platform, variant)`; Linux may provide multiple fixed-size theme entries per variant.

Each asset MAY declare one variant name or an array of names. Omission SHALL be exactly equivalent to `"default"`. A declaration such as `["default", "light"]` SHALL allow one native file to serve both names without duplicating bytes. Variant names SHALL be application-defined semantic states, including but not limited to themes (`light/dark`) and domain states (`empty/files`). The catalog SHALL contain a current-platform `default` projection. Duplicate assets within the same platform/variant/size key SHALL reject, while the same platform MAY use different native assets for different variants.

Optional build tooling MAY generate this array, but it SHALL not be required to consume the protocol. `@opentray/vite-plugin` SHALL emit ICNS, ICO, Linux fixed-size PNG assets, and a portable relative-path manifest for both dev and build. Preview/Linux PNGs SHALL declare 72 DPI. ICNS SHALL encode independent @1x/@2x tagged representations so AppKit observes `1024 px / 512 pt`, `512 px / 512 pt`, and `512 px / 256 pt`; it SHALL NOT copy one physical-density payload into incompatible tags. The encoder and representation recipe SHALL participate in cache identity.

The public type surface SHALL export a type-level operation equivalent to `AppIconVariantOf<TCatalog>`, yielding `"default"` plus literal names declared by an `as const` AppIcon catalog. This inference SHALL be usable by an application-owned IPC contract without adding App icon APIs to `@opentray/ext-webview`.

The runtime SHALL resolve one App identity snapshot at initialization. Resolution SHALL follow the Windows distinction between Shell grouping identity and artwork source:

```text
explicit appIcon (current platform)
  > packaged/carrier App identity artwork when appIcon is omitted
  > operating-system executable/default icon
```

`appId` SHALL remain the stable Windows AppUserModelID/grouping identity; it SHALL not be inferred from icon content. The resolved artwork SHALL be reused by all app-mode windows in that runtime. Later tray icon updates and later WebView icon updates SHALL not change the App identity snapshot. An explicit `appIcon` with malformed sources, duplicate Darwin/Windows entries, or no valid current-platform entry SHALL reject with a typed validation error; the runtime SHALL not silently substitute a tray icon, page URL, or text template.

#### Scenario: Explicit platform app icon wins

- **GIVEN** runtime options provide `appIcon`
- **AND** the first tray also provides a generic tray icon
- **WHEN** the App identity is initialized
- **THEN** the explicit app icon is selected
- **AND** the tray icon remains only the tray projection.

#### Scenario: Darwin projects App artwork before Dock participation

- **GIVEN** a Darwin caller provides a standards-compliant ICNS `appIcon` asset
- **WHEN** the Core App projection is synchronized before the first app-mode window is shown
- **THEN** the carrier process applies that image to `NSApplication`
- **AND** Dock never falls back to the generic executable icon for that app-mode reveal.

#### Scenario: Tray template image is not an App icon

- **GIVEN** runtime options omit `appIcon`
- **AND** the first tray icon selects a Darwin template image intended for the menu bar
- **WHEN** App identity fallback is resolved
- **THEN** the template image is not promoted as application artwork
- **AND** the runtime continues to the packaged carrier or operating-system fallback.

#### Scenario: Omitted app icon uses packaged identity before OS default

- **GIVEN** runtime options omit `appIcon`
- **AND** the packaged/carrier identity has a native app icon
- **AND** the first tray created during initialization provides a generic tray icon
- **WHEN** the App identity is initialized
- **THEN** the packaged/carrier app icon wins
- **AND** the first tray icon remains only the tray projection.

#### Scenario: Missing current platform is rejected

- **GIVEN** runtime options provide only a Windows `ico` asset on a Darwin host
- **WHEN** App identity initialization validates the explicit array
- **THEN** initialization rejects with a typed platform-missing validation error
- **AND** the tray icon is not consulted as a fallback.

#### Scenario: Window icon changes do not change App identity

- **GIVEN** an App identity has been initialized
- **WHEN** a WebView calls `setIcon()` or navigates to a page with a favicon
- **THEN** only the WebView/page metadata changes
- **AND** the Dock/taskbar App identity icon remains unchanged.

#### Scenario: Invalid explicit app icon is rejected

- **GIVEN** runtime options provide an `appIcon` that is remote, tray-only, malformed, duplicate, or missing the current platform
- **WHEN** App identity initialization validates it
- **THEN** initialization rejects with a typed validation error
- **AND** it does not silently fall back to a page or tray representation.

#### Scenario: Generated Darwin artwork preserves native point scale

- **GIVEN** the optional Vite generator renders a 1024-pixel application icon
- **WHEN** its PNG representations are encoded into ICNS
- **THEN** ICNS contains distinct @1x/@2x tagged representations
- **AND** AppKit reports `1024 px / 512 pt`, `512 px / 512 pt`, and `512 px / 256 pt`
- **AND** it does not interpret the 1024-pixel representation as a multi-thousand-point image.

#### Scenario: Variant omission and aliases normalize to default

- **GIVEN** a native asset omits `variant` or declares `["default", "light"]`
- **WHEN** the AppIcon catalog is validated
- **THEN** omission resolves to the canonical `default` name
- **AND** the aliased asset may be selected by either `default` or `light`.

#### Scenario: Semantic variants are not limited to themes

- **GIVEN** an application declares complete `empty` and `files` App icon variants
- **WHEN** its domain state changes from empty to files
- **THEN** it may select `files` through the Core App identity handle
- **AND** no WebView or badge capability is required.

### Requirement: App identity SHALL remain caller-owned and session-isolated

The App identity snapshot SHALL be created from the caller-owned runtime seam used by `createTray(...)`. `createWebviewWindow(...)` SHALL not be able to create, replace, or globally mutate App identity. A runtime host SHALL associate the resolved App identity with its one owning caller session and SHALL clear native projections when that session closes.

#### Scenario: Window creation cannot replace App identity

- **GIVEN** a runtime already has a resolved App identity
- **WHEN** a WebView window is created with a different window icon
- **THEN** the App identity remains unchanged
- **AND** the window icon is scoped to that window session.

#### Scenario: Repeated explicit App creation is idempotent

- **GIVEN** Core already owns an App with a stable explicit `appId`, name, icon, and trays
- **WHEN** another create request uses the same `appId` with omitted or different bootstrap metadata
- **THEN** Core returns the existing App reference
- **AND** it does not clear or replace the existing identity or trays.

#### Scenario: Session close clears App projections

- **GIVEN** a runtime session owns an App identity and one or more app-mode windows
- **WHEN** the owning caller disconnects or destroys its session
- **THEN** all app-mode windows and their Shell projections are removed
- **AND** no retained App identity remains visible without a live owning session.

### Requirement: App identity mutation SHALL be a Core/runtime capability

The generic Core protocol and kernel SHALL expose app-scoped mutation operations for the logical App name and App icon. The public TypeScript facade SHALL expose these operations through an App-scoped handle reachable from the caller-owned tray runtime, without introducing a second `createApp` lifecycle. The mutation path SHALL update the stored `AppOptions`, re-run the generic `AppProjection`, and let each backend/carrier project only the portions it truthfully supports.

The public App handle SHALL use `getName`, `setName`, `getAppIcon`, `getAppIconVariant`, and `setAppIcon`. It SHALL NOT reuse WebView window `setTitle`/`setIcon` names at the same object level. `setAppIcon(name)` SHALL select a declared variant while retaining the catalog. `setAppIcon(catalog)` SHALL replace the catalog and select `default`; `setAppIcon(null)` SHALL clear explicit App artwork. App name mutation SHALL not claim to rename a packaged executable, Windows shortcut, or macOS bundle at runtime. WebView window metadata SHALL remain owned by `@opentray/ext-webview`.

Core SHALL retain the full catalog and active variant as App identity state. Native `AppProjection` SHALL contain only assets belonging to the active name. Selecting a missing or invalid variant SHALL return a typed error before mutating state, SHALL preserve the prior active variant and native projection, and SHALL NOT silently fall back to `default` or another name.

`@opentray/ext-badge` SHALL remain responsible for badge text/count, progress, overlay icon, and attention state. It SHALL not become the owner of base App title or App icon mutation.

The App identity contract SHALL be split from its Darwin packaging carrier: Core owns the logical identity and projection protocol, while the matching Darwin runtime distribution owns the shared `.app` bundle that supplies the native process carrier. The `.app` bundle SHALL not be treated as a WebView or badge extension artifact.

#### Scenario: Caller updates App identity through the Core path

- **GIVEN** a live caller owns an App identity
- **WHEN** it calls `tray.app.setName("Skill Creator")`, `tray.app.setAppIcon(nativeIcon)`, or `tray.app.setAppIcon("files")`
- **THEN** the request is routed through the generic App protocol/kernel path
- **AND** the resulting App projection is synchronized to the backend/carrier
- **AND** no badge extension mount is required.

#### Scenario: App identity uses the runtime carrier without moving carrier code into Core

- **GIVEN** a Darwin runtime is installed from the matching `@opentray/darwin-*` package
- **WHEN** Core synchronizes an App identity projection
- **THEN** the runtime carrier applies the supported native App name/icon projection
- **AND** Core remains free of AppKit and `.app` bundle ownership.

#### Scenario: Window metadata remains separate from App identity

- **GIVEN** a WebView calls `navigator.window.setTitle(...)` or `navigator.window.setIcon(...)`
- **WHEN** the extension applies the metadata change
- **THEN** only that native WebView window changes
- **AND** the App identity icon/name remains unchanged.

#### Scenario: Badge extension remains status-only

- **GIVEN** a caller wants to set a badge, overlay, or attention state
- **WHEN** it mounts `@opentray/ext-badge`
- **THEN** the extension changes only its status projection
- **AND** it does not become the authority for base App name or icon.
