## ADDED Requirements

### Requirement: The notification extension SHALL expose a session-scoped OS notification capability

`@opentray/ext-notification` SHALL attach through the tray/session contract as `attachNotification(tray, options?)`, returning a capability with `notify(options)`, `getAuthorizationStatus()`, `requestAuthorization()`, and an asynchronous `getBackend(): Promise<NotificationBackendCapabilities>` (lazy-load then query, immutable snapshot; no synchronous truth property — the shared `{type:"backend"}` ABI shape law of the archived dialog/sound extension specs). `notify` SHALL resolve on acceptance (resolve-on-acceptance, the same law as sound playback): whether and when the user actually sees the notification is not part of the acceptance semantics. This contract version SHALL offer no events (no activation/click EventPort producer), no action buttons or inline replies, no grouping or badge progress, no custom sound (platform default alert sound only), no rich-media attachments, and no platform-specific option namespace. Linux targets SHALL be rejected by the facade with typed `notification_platform_unsupported` before any broker connection.

#### Scenario: notify resolves on native acceptance

- **GIVEN** an attached notification capability on a supported platform with authorization granted
- **WHEN** `notify({ title: 'Build finished' })` is called
- **THEN** the promise SHALL resolve once the native delivery request is accepted, without waiting for user visibility and without any event surface

#### Scenario: Linux invocation is rejected before broker dispatch

- **GIVEN** the facade running on a `linux-*` target
- **WHEN** any capability method is called
- **THEN** the call SHALL reject with typed `notification_platform_unsupported` without connecting to or dispatching through the broker

### Requirement: notify payloads SHALL be validated against frozen bounds before dispatch

`NotifyOptions` SHALL be `{ title, body?, subtitle?, silent? }`. `title` SHALL be required, non-empty, and at most 256 characters; `body` SHALL be at most 4096 characters; unknown option fields SHALL be rejected pre-transport. Violations SHALL reject with typed `notification_payload_invalid` before any state change or native dispatch. `subtitle` SHALL project natively on darwin and SHALL be a documented degradation on win32 (prefixed into the body); `silent` SHALL default to `false` (platform default alert sound) and `true` SHALL mean no sound.

#### Scenario: Empty or oversized payloads are typed rejections

- **GIVEN** an attached notification capability
- **WHEN** `notify({ title: '' })`, a 257-character title, or a body over 4096 characters is submitted
- **THEN** the call SHALL reject with typed `notification_payload_invalid` and no broker/native dispatch SHALL occur

### Requirement: Authorization SHALL be a real surface on darwin and a documented degradation on win32

`getAuthorizationStatus()` SHALL resolve `'granted' | 'denied' | 'notDetermined'` and `requestAuthorization()` SHALL resolve a boolean. On darwin these SHALL carry real UNUserNotificationCenter semantics: under `denied`, `notify` SHALL reject with typed `notification_denied` with no native delivery; under `notDetermined`, the first `notify` SHALL let the system implicitly present the authorization prompt (documented behavior). win32 has no authorization concept: `getAuthorizationStatus()` SHALL resolve `'granted'` and `requestAuthorization()` SHALL resolve `true` as documented degradations, never errors. The internal synchronization strategy of the asynchronous authorization read on darwin is the open adjudication recorded in the plan (bounded synchronous wait vs immediate command with internal semaphore); the public Promise surface SHALL NOT vary with that choice.

#### Scenario: denied authorization is a typed rejection

- **GIVEN** a darwin capability whose authorization status is `denied`
- **WHEN** `notify({ title: 'x' })` is called
- **THEN** the call SHALL reject with typed `notification_denied` and no native delivery SHALL occur

#### Scenario: win32 reports the documented always-granted degradation

- **GIVEN** the facade running on win32
- **WHEN** `getAuthorizationStatus()` and `requestAuthorization()` are awaited
- **THEN** they SHALL resolve `'granted'` and `true` respectively, documented as the no-authorization-concept degradation

### Requirement: darwin SHALL project notifications through UNUserNotificationCenter

On darwin the extension SHALL deliver `UNMutableNotificationContent` title/body/subtitle through UNUserNotificationCenter on the owner thread (objc2 UserNotifications bindings, zero raw `msgSend`). Bundle identity SHALL come from the caller-specific Darwin carrier under the existing carrier law (no new identity atom). `silent: true` SHALL omit the sound flag; the default SHALL be the platform alert sound. This contract version SHALL attach no delegate, and notification-center retention SHALL remain owned by system policy.

#### Scenario: subtitle projects as a distinct native field on darwin

- **GIVEN** a granted darwin capability
- **WHEN** `notify({ title: 't', subtitle: 's', body: 'b' })` is accepted
- **THEN** the native content SHALL carry title, subtitle, and body as distinct UNMutableNotificationContent fields

### Requirement: win32 SHALL project notifications through the registered tray icon's balloon/toast channel

On win32 notifications SHALL ride the caller's already-registered tray icon via `Shell_NotifyIcon(NIF_INFO)` under the recommended broker-internal bridge (design-reference §2, option B): the notify command envelope is short-circuited broker-side to the core tray-icon holder performing `NIF_MODIFY` setting `NIF_INFO`, reusing the existing `(HWND, uID)` identity law with zero new windows and zero new identity atoms (no AUMID/shortcut atom); the extension crate still exists with identical identity/manifest/DTO obligations. `title`/`body` SHALL project to `szInfoTitle`/`szInfo` (balloons render as toasts on Win10+); `silent: true` SHALL project to `NIIF_NOSOUND` (NIF_INFO has no separate silence bit). Documented limitations SHALL hold: no action buttons, system-owned duration, classic balloons before Win10. The carrier of this path is the open adjudication recorded in the plan (option B broker bridge vs option A WinRT Toast); if the adjudication rejects the bridge, win32 v1 SHALL fall back to typed `notification_platform_unsupported` rather than ship the dependency-inverted AUMID atom.

#### Scenario: notify updates the registered tray icon and nothing else

- **GIVEN** the facade running on win32 under adjudicated option B
- **WHEN** `notify({ title: 't', body: 'b', silent: true })` is accepted
- **THEN** the broker SHALL issue one tray-icon `NIF_MODIFY` carrying `NIF_INFO` with `NIIF_NOSOUND` against the already-registered `(HWND, uID)`, and no new window or identity atom SHALL be created

### Requirement: Every platform build SHALL serialize the NotificationBackendCapabilities DTO

The native extension SHALL embed and report a `NotificationBackendCapabilities` DTO exposed through the asynchronous `getBackend()` (immutable snapshot; the shared `{type:"backend"}` ABI shape round-trip fixture law). The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. The DTO SHALL report this platform's documented projection facts (darwin real authorization model; win32 always-granted degradation and balloon/toast channel), not an open-ended runtime probe.

#### Scenario: The authorization model is runtime truth

- **GIVEN** an attached notification capability on win32
- **WHEN** the facade awaits `getBackend()`
- **THEN** the returned snapshot SHALL report the no-authorization-concept (always-granted) projection for the platform

### Requirement: The facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-notification` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` (`libopentray_ext_notification.dylib` for darwin targets; `opentray_ext_notification.dll` for win32 targets) through the same SDK `kind: "embedded"` artifact and workspace pack-size audit delivered by the archived `add-ext-dialog` change and generalized by `add-ext-sound` (identity from facade version plus `contract.json` = `{"extensionName":"notification","contractFingerprint":"opentray-ext-notification-contract-1"}`; accessibility and missing-target failures typed identically). The shared infrastructure SHALL NOT be duplicated in this change.

#### Scenario: Embedded artifact resolves through shared infrastructure

- **GIVEN** the installed `@opentray/ext-notification` facade on `darwin-arm64`
- **WHEN** the SDK resolves the notification extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_notification.dylib` with expected identity `{ extensionName: "notification", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-notification-contract-1", sha256: <manifest hash for the target>, buildIdentity: <manifest build identity> }` using the same embedded-artifact resolver and `LoadExt` identity fields introduced for dialogs
