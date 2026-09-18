# notification-extension Specification

## Purpose
TBD - created by archiving change add-ext-notification. Update Purpose after archive.

## Requirements

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

### Requirement: notify payloads SHALL be validated against frozen UTF-16 bounds before dispatch

`NotifyOptions` SHALL be `{ title, body?, subtitle?, silent? }`. Bounds SHALL be counted in UTF-16 code units and SHALL be the platform-independent common contract: `title` required, non-empty, at most 64 UTF-16 code units; `body` at most 256; `subtitle` at most 64 (the win32 `szInfoTitle`/`szInfo` physical capacity of 64/256 taken as the cross-platform common subset — one contract across platforms is preferred over per-platform limits). Unknown option fields SHALL be rejected pre-transport. Violations SHALL reject with typed `notification_payload_invalid` (details: `field`, `lengthUtf16`, `limit`) before any state change or native dispatch, and payloads SHALL never be silently truncated. On win32 the `subtitle` degradation SHALL join the subtitle into the body under a combined post-join limit of 256 UTF-16 code units — a joined body that exceeds the limit rejects typed rather than truncating. `subtitle` SHALL project natively on darwin; `silent` SHALL default to `false` (platform default alert sound) and `true` SHALL mean no sound.

#### Scenario: Empty or oversized payloads are typed rejections

- **GIVEN** an attached notification capability
- **WHEN** `notify({ title: '' })`, a 65-UTF-16-unit title, a 257-UTF-16-unit body, or a 65-UTF-16-unit subtitle is submitted
- **THEN** the call SHALL reject with typed `notification_payload_invalid` whose details carry the offending field, length, and limit, and no broker/native dispatch SHALL occur

#### Scenario: The win32 subtitle join is jointly validated, never truncated

- **GIVEN** the facade running on win32
- **WHEN** `notify({ title: 't', subtitle: 's', body })` is submitted such that the joined subtitle-prefixed body would exceed 256 UTF-16 code units
- **THEN** the call SHALL reject with typed `notification_payload_invalid` rather than silently truncating the joined body

### Requirement: Authorization SHALL be a real surface on darwin and a documented degradation on win32

`getAuthorizationStatus()` SHALL resolve `'granted' | 'denied' | 'notDetermined'` and `requestAuthorization()` SHALL resolve a boolean. On darwin these SHALL carry real UNUserNotificationCenter semantics: under `denied`, `notify` SHALL reject with typed `notification_denied` with no native delivery; under `notDetermined`, the first `notify` SHALL let the system implicitly present the authorization prompt (documented behavior). The asynchronous authorization read/request on darwin SHALL complete through the existing DeferredOperation transaction and completion port (frozen O2 ruling — no new ABI symbols, the first non-modal use of the deferred infrastructure): the commands return `ExtCommandDispositionV1::deferred(handle)`, the authorization callback wakes the owner loop through main-thread dispatch, and the transaction completes in one step without a synchronous owner-loop wait. A callback that never arrives SHALL time out after 10 s into typed `notification_failed` (reason: `"authorization-timeout"`); session close SHALL revoke in-flight callbacks through the existing registry session-key cleanup law, with the terminal cancel branch delivered exactly once. `notify` acceptance SHALL linearize denial in one owner-loop frame: acceptance = the cached last authorization snapshot plus delivery acceptance, sequenced in the same frame (the snapshot query does not consume the 10 s budget; a first snapshot-less `notify` queries within the 10 s budget before delivering; subsequent `notify` calls reuse the snapshot, and the typed rejection and backend log SHALL name the snapshot provenance — never silently dropped). The snapshot key SHALL be `(appId, trayId, sessionId, instanceGeneration)` and SHALL never be trusted across sessions. win32 has no authorization concept: `getAuthorizationStatus()` SHALL resolve `'granted'` and `requestAuthorization()` SHALL resolve `true` as documented degradations, never errors, and both commands SHALL be Immediate with zero deferred frames.

#### Scenario: denied authorization is a typed rejection

- **GIVEN** a darwin capability whose authorization status is `denied`
- **WHEN** `notify({ title: 'x' })` is called
- **THEN** the call SHALL reject with typed `notification_denied` and no native delivery call SHALL occur

#### Scenario: A never-arriving authorization callback times out typed

- **GIVEN** a darwin deferred authorization read whose callback never arrives
- **WHEN** the command is awaited past the 10 s budget
- **THEN** it SHALL reject with typed `notification_failed` carrying reason `"authorization-timeout"`

#### Scenario: Session close revokes an in-flight authorization transaction

- **GIVEN** a darwin deferred authorization read still awaiting its callback
- **WHEN** the owning session closes
- **THEN** the existing registry session-key cleanup SHALL revoke the in-flight callback and the terminal cancel branch SHALL be delivered exactly once

#### Scenario: win32 reports the documented always-granted degradation

- **GIVEN** the facade running on win32
- **WHEN** `getAuthorizationStatus()` and `requestAuthorization()` are awaited
- **THEN** they SHALL resolve `'granted'` and `true` respectively as Immediate commands with zero deferred frames, documented as the no-authorization-concept degradation

### Requirement: darwin SHALL project notifications through UNUserNotificationCenter

On darwin the extension SHALL deliver `UNMutableNotificationContent` title/body/subtitle through UNUserNotificationCenter on the owner thread (objc2 UserNotifications bindings, zero raw `msgSend`). Bundle identity SHALL come from the caller-specific Darwin carrier under the existing carrier law (no new identity atom). `silent: true` SHALL omit the sound flag; the default SHALL be the platform alert sound. This contract version SHALL attach no delegate, and notification-center retention SHALL remain owned by system policy.

#### Scenario: subtitle projects as a distinct native field on darwin

- **GIVEN** a granted darwin capability
- **WHEN** `notify({ title: 't', subtitle: 's', body: 'b' })` is accepted
- **THEN** the native content SHALL carry title, subtitle, and body as distinct UNMutableNotificationContent fields

### Requirement: win32 SHALL project notifications through the registered tray icon's balloon/toast channel

On win32 notifications SHALL ride the caller's already-registered tray icon via `Shell_NotifyIcon(NIF_INFO)` through the frozen broker-internal tray-notification bridge (Codex R1, option B): the notify command envelope is routed broker-side by the composition layer's generic tray-notification capability table — matched on the envelope's capability word, never an `ext == "notification"` special case in opentray-core — to the registered tray icon bound to the envelope's `(appId, trayId, sessionId, instanceGeneration)` scope, performing `NIF_MODIFY` setting `NIF_INFO`, reusing the existing `(HWND, uID)` identity law with zero new windows and zero new identity atoms (no AUMID/shortcut atom). The extension crate SHALL still build and load on win32 targets with identical identity/manifest/DTO obligations through the generic FFI path. The bridge SHALL operate only the icon registered by the same-scope session (cross app/session unreachable). Errors SHALL map typed: a missing or unregistered tray icon → `notification_tray_absent`; a failing `Shell_NotifyIconW` → `notification_failed` (details carry the win32 error code). Multiple mounts sharing one icon channel SHALL degrade by replacement — the later notification replaces the earlier (win32 single balloon slot, documented). `title`/`body` SHALL project to `szInfoTitle`/`szInfo` (balloons render as toasts on Win10+); `silent: true` SHALL project to `NIIF_NOSOUND` (NIF_INFO has no separate silence bit). Documented limitations SHALL hold: no action buttons, system-owned duration, classic balloons before Win10. A future WinRT Toast evolution SHALL replace only the projection layer; the facade wire contract, manifest/DTO, and error model SHALL NOT change.

#### Scenario: notify updates the registered tray icon and nothing else

- **GIVEN** the facade running on win32 under the frozen broker-internal bridge
- **WHEN** `notify({ title: 't', body: 'b', silent: true })` is accepted
- **THEN** the broker SHALL issue one tray-icon `NIF_MODIFY` carrying `NIF_INFO` with `NIIF_NOSOUND` against the already-registered `(HWND, uID)`, and no new window or identity atom SHALL be created

#### Scenario: A scope without a registered tray icon is typed tray-absent

- **GIVEN** a win32 notify envelope whose scope has no registered tray icon
- **WHEN** the bridge resolves the target icon
- **THEN** the call SHALL reject with typed `notification_tray_absent` and no other session's or app's icon SHALL be touched

#### Scenario: Multiple mounts replace rather than accumulate

- **GIVEN** two mounted notification capabilities sharing one win32 tray icon channel
- **WHEN** both notify in order
- **THEN** the later notification SHALL replace the earlier one in the single balloon slot

### Requirement: Every platform build SHALL serialize the NotificationBackendCapabilities DTO

The native extension SHALL embed and report a `NotificationBackendCapabilities` DTO exposed through the asynchronous `getBackend()` (immutable snapshot; the shared `{type:"backend"}` ABI shape round-trip fixture law). The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. The DTO SHALL report this platform's frozen projection facts — `platform`; `authorizationModel` (darwin `'user'`; win32 `'always-granted'`); `channel` (darwin `'user-notification-center'`; win32 `'tray-icon-info'`, a diagnostics-read-only projection channel); `titleLimitUtf16: 64`, `bodyLimitUtf16: 256`, `subtitleLimitUtf16: 64` (platform-independent contract constants, the same source as the payload bounds); and `supportsSubtitle` (win32 `false` via the documented degraded join; darwin `true`) — not an open-ended runtime probe.

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
