## ADDED Requirements

### Requirement: The sound extension SHALL expose a session-scoped, non-blocking sound capability

`@opentray/ext-sound` SHALL attach through the tray/session contract as `attachSound(tray, options?)`, returning a capability with `beep`, `playSystemSound`, and `playSound`, plus an asynchronous `getBackend(): Promise<SoundBackendCapabilities>` (lazy-load then query, immutable snapshot; no synchronous truth property). Every method SHALL resolve when the native call is accepted (playback started), SHALL never block native UI or transport I/O, and SHALL NOT offer completion or progress events in this contract version. Linux targets SHALL be rejected by the facade with typed `sound_platform_unsupported` before any broker connection. The runtime model stays single-session (R2 P0-3): playback ownership tracks the broker-injected session identity; concurrent-same-tray-multi-session scenarios SHALL NOT appear.

#### Scenario: Playback start resolves without completion tracking

- **GIVEN** an attached sound capability and a playable WAV file
- **WHEN** `playSound(path)` is called
- **THEN** the promise SHALL resolve once the native playback request is accepted, without waiting for playback to finish and without any completion event surface

#### Scenario: Session close purges once for the latest matching owner

- **GIVEN** the single caller session (current runtime) with multiple loaded sound mounts, where a later play superseded an earlier one under process-wide semantics
- **WHEN** the session closes
- **THEN** all loaded mounts SHALL receive the one actual session-close sequence and the arbiter SHALL purge at most once for the latest matching owner token; darwin SHALL stop that session-owned `NSSound` set. Non-owner-close non-purge behavior SHALL be proven by deterministic PlaybackArbiter unit tests with two simulated full `CommandScope` tokens — no live second caller session may be named until a multi-session runtime change lands

### Requirement: beep SHALL project the kind table with documented degradation

`beep` SHALL accept `BeepKind = 'default' | 'info' | 'warning' | 'error' | 'question'`. On win32 every kind SHALL map to its distinct `MessageBeep` sound; on darwin every kind SHALL play the single system alert sound (`NSBeep`) as a documented degradation, never an error.

#### Scenario: All five kinds are accepted on both platforms

- **GIVEN** an attached sound capability on either supported platform
- **WHEN** `beep` is called with each of the five kinds
- **THEN** every call SHALL resolve successfully (win32 with distinct native sounds; darwin degraded to NSBeep per the documented matrix)

### Requirement: playSystemSound SHALL resolve common names first, then platform-native names, and SHALL never fail silently

`playSystemSound(name)` SHALL first match the frozen three-entry common-name table (`notification` → Glass/SystemAsterisk, `warning` → Sosumi/SystemExclamation, `error` → Basso/SystemHand) and play the current platform's projection; on miss it SHALL treat the string as a platform-native sound name (darwin `NSSound(named:)` catalog entry; win32 `PlaySound` with exactly `SND_ALIAS | SND_ASYNC | SND_NODEFAULT` — `SND_NODEFAULT` forbids the silent default-sound fallback and `SND_ASYNC` forbids blocking the owner loop) and play it; on a native `false` return or a second miss it SHALL reject with typed `sound_not_found` whose details carry the requested name, platform, and attempted mode/catalog. Acceptance SHALL be judged from native return values with broker.log diagnostics, not from the absence of an error; a silent no-op or wrong-sound fallback SHALL NOT occur on any platform. `default`/`info`/`question` belong to `beep` only and SHALL NOT enter the common catalog.

#### Scenario: Common name projects per platform

- **GIVEN** the facade running on win32
- **WHEN** `playSystemSound('error')` is called
- **THEN** the win32 projection sound SHALL be requested natively (the SystemHand alias)

#### Scenario: Unknown name is a typed rejection, not silence

- **GIVEN** an attached sound capability
- **WHEN** `playSystemSound('definitely-not-a-sound')` is called
- **THEN** the call SHALL reject with typed `sound_not_found` naming the requested string

### Requirement: playSound SHALL be a common capability bounded by a documented per-platform format matrix

Both platforms SHALL provide `playSound` at low cost (win32 `PlaySound(SND_FILENAME|SND_ASYNC)`; darwin `NSSound(contentsOfFile:)`), making it a common capability rather than a platform-specific surface. win32 SHALL accept WAV only and SHALL enforce it by an exact RIFF parser before dispatch — path expansion, canonicalization, readability, a maximum of 64 MiB, at least 12 bytes, `declared_size + 8 <= actual_size` (the offset-4 field counts past the 8-byte RIFF header), the presence of BOTH `fmt ` and `data` chunks with each chunk's `offset + 8 + size + odd-padding` inside the declared RIFF region and a `fmt ` payload of at least 16 bytes (no decoding) — rejecting any violation with typed `sound_format_unsupported` and unreadable sources with typed `sound_file_unreadable`, with a PlaySound spy asserting zero native calls on every reject path. darwin SHALL accept the finite v1 committed set (wav/aiff/mp3/m4a) with readability/canonical-path checks. All win32 `PlaySound` paths (alias and filename, never `MessageBeep`) SHALL pass through one process-wide PlaybackArbiter that linearizes the native call, its return-value handling, and the `(sessionId, instanceGeneration, sequence)` token swap under a single mutex; session close SHALL compare the complete token under the same lock and purge only on a match (non-owner-close non-purge is proven by deterministic arbiter tests with simulated tokens), and a later play supersedes the earlier one recorded as `accepted but prior owner superseded`. `PlaySoundOptions` SHALL be reserved (no fields in this version); unsupported per-platform conveniences SHALL NOT be added as silently-ignored common fields.

#### Scenario: Non-WAV on win32 is rejected by content, before any native call

- **GIVEN** the facade running on win32
- **WHEN** `playSound('/tmp/clip.mp3')` is called, or a file named `clip.wav` whose header is not `RIFF`/`WAVE`
- **THEN** the call SHALL reject with typed `sound_format_unsupported` after preflight content validation, without dispatching a native play command

#### Scenario: darwin plays the same catalog without format rejection

- **GIVEN** the facade running on darwin
- **WHEN** `playSound('/tmp/clip.mp3')` is called
- **THEN** the call SHALL dispatch natively and resolve on acceptance (NSSound format family)

### Requirement: Every platform build SHALL serialize the SoundBackendCapabilities DTO

The native extension SHALL embed and report a `SoundBackendCapabilities` DTO (platform, systemSoundCatalog, playFile, fileFormats) exposed via the asynchronous `getBackend()`. The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. `fileFormats` SHALL report the finite v1 committed set (win32 `['wav']`; darwin `['wav','aiff','mp3','m4a']`), not an open-ended runtime probe.

#### Scenario: The format matrix is runtime truth

- **GIVEN** an attached sound capability on either platform
- **WHEN** the facade awaits `getBackend()`
- **THEN** the returned snapshot SHALL report exactly that platform's v1 committed formats (win32 `['wav']`; darwin `['wav','aiff','mp3','m4a']`)

### Requirement: The sound facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-sound` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` through the same SDK `kind: "embedded"` artifact and workspace pack-size audit delivered by `add-ext-dialog` batch A (identity from facade version plus `contract.json`; accessibility and missing-target failures typed identically). The shared infrastructure SHALL NOT be duplicated in this change.

#### Scenario: Embedded artifact resolves through shared infrastructure

- **GIVEN** the installed `@opentray/ext-sound` facade on `darwin-arm64`
- **WHEN** the SDK resolves the sound extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_sound.dylib` with expected identity `{ extensionName: "sound", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-sound-contract-1", sha256: <manifest hash for the target>, buildIdentity: <manifest build identity> }` using the same embedded-artifact resolver and `LoadExt` identity fields introduced for dialogs
