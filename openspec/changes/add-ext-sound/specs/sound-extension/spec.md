## ADDED Requirements

### Requirement: The sound extension SHALL expose a session-scoped, non-blocking sound capability

`@opentray/ext-sound` SHALL attach through the tray/session contract as `attachSound(tray, options?)`, returning a capability with `beep`, `playSystemSound`, and `playSound`, plus a read-only `backend` capabilities snapshot. Every method SHALL resolve when the native call is accepted (playback started), SHALL never block native UI or transport I/O, and SHALL NOT offer completion or progress events in this contract version. Linux targets SHALL be rejected by the facade with typed `sound_platform_unsupported` before any broker connection.

#### Scenario: Playback start resolves without completion tracking

- **GIVEN** an attached sound capability and a playable WAV file
- **WHEN** `playSound(path)` is called
- **THEN** the promise SHALL resolve once the native playback request is accepted, without waiting for playback to finish and without any completion event surface

#### Scenario: Session close stops session-owned playback

- **GIVEN** a session that started a long file playback
- **WHEN** the owning session closes
- **THEN** extension cleanup SHALL stop that playback natively (darwin `NSSound.stop()`; win32 `PlaySound(NULL, SND_PURGE)`) and SHALL NOT stop playback started by other sessions

### Requirement: beep SHALL project the kind table with documented degradation

`beep` SHALL accept `BeepKind = 'default' | 'info' | 'warning' | 'error' | 'question'`. On win32 every kind SHALL map to its distinct `MessageBeep` sound; on darwin every kind SHALL play the single system alert sound (`NSBeep`) as a documented degradation, never an error.

#### Scenario: All five kinds are accepted on both platforms

- **GIVEN** an attached sound capability on either supported platform
- **WHEN** `beep` is called with each of the five kinds
- **THEN** every call SHALL resolve successfully (win32 with distinct native sounds; darwin degraded to NSBeep per the documented matrix)

### Requirement: playSystemSound SHALL resolve common names first, then platform-native names, and SHALL never fail silently

`playSystemSound(name)` SHALL first match the typed common-name table and play the current platform's projection; on miss it SHALL treat the string as a platform-native sound name (darwin `NSSound(named:)` catalog entry; win32 `PlaySound(SND_ALIAS)` sound-scheme alias) and play it; on a second miss it SHALL reject with typed `sound_not_found` carrying the requested name. A silent no-op SHALL NOT occur on any platform.

#### Scenario: Common name projects per platform

- **GIVEN** the facade running on win32
- **WHEN** `playSystemSound('error')` is called
- **THEN** the win32 projection sound SHALL be requested natively (the SystemHand alias)

#### Scenario: Unknown name is a typed rejection, not silence

- **GIVEN** an attached sound capability
- **WHEN** `playSystemSound('definitely-not-a-sound')` is called
- **THEN** the call SHALL reject with typed `sound_not_found` naming the requested string

### Requirement: playSound SHALL be a common capability bounded by a documented per-platform format matrix

Both platforms SHALL provide `playSound` at low cost (win32 `PlaySound(SND_FILENAME|SND_ASYNC)`; darwin `NSSound(contentsOfFile:)`), making it a common capability rather than a platform-specific surface. win32 SHALL accept WAV only and SHALL reject other extensions up front with typed `sound_format_unsupported`; darwin SHALL accept the `NSSound` format family. win32 concurrent playback SHALL follow the documented degradation that a later play cancels the earlier one (process-wide PlaySound semantics); darwin SHALL mix instances naturally. `PlaySoundOptions` SHALL be reserved (no fields in this version); unsupported per-platform conveniences SHALL NOT be added as silently-ignored common fields. Paths SHALL resolve relative to cwd with `~` expansion, and unreadable sources SHALL reject with typed `sound_file_unreadable`.

#### Scenario: Non-WAV on win32 is rejected before any native call

- **GIVEN** the facade running on win32
- **WHEN** `playSound('/tmp/clip.mp3')` is called
- **THEN** the call SHALL reject with typed `sound_format_unsupported` without dispatching a native play command

#### Scenario: darwin plays the same catalog without format rejection

- **GIVEN** the facade running on darwin
- **WHEN** `playSound('/tmp/clip.mp3')` is called
- **THEN** the call SHALL dispatch natively and resolve on acceptance (NSSound format family)

### Requirement: Every platform build SHALL serialize the SoundBackendCapabilities DTO

The native extension SHALL embed and report a `SoundBackendCapabilities` DTO (platform, systemSoundCatalog, playFile, fileFormats). A field added to the TypeScript surface SHALL be serialized by every platform's DTO and constructor; cross-compilation of the darwin target SHALL fail if the win32 projection is missing (the same compile gate as dialogs and webviews).

#### Scenario: The format matrix is runtime truth

- **GIVEN** an attached sound capability on either platform
- **WHEN** the facade reads `backend.fileFormats`
- **THEN** it SHALL report exactly that platform's accepted formats (win32 `['wav']`; darwin the NSSound family)

### Requirement: The sound facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-sound` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` through the same SDK `kind: "embedded"` artifact and workspace pack-size audit delivered by `add-ext-dialog` batch A (identity from facade version plus `contract.json`; accessibility and missing-target failures typed identically). The shared infrastructure SHALL NOT be duplicated in this change.

#### Scenario: Embedded artifact resolves through shared infrastructure

- **GIVEN** the installed `@opentray/ext-sound` facade on `darwin-arm64`
- **WHEN** the SDK resolves the sound extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_sound.dylib` with expected identity `{ extensionName: "sound", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-sound-contract-1" }` using the same embedded-artifact resolver introduced for dialogs
