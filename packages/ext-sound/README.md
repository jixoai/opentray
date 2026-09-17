# @opentray/ext-sound

Official OpenTray sound extension: OS-standard sound feedback atoms — system beeps, named system sounds, and low-cost file playback for host-side callers (tray menu actions, background CLIs, moments without a visible page). Sounds a page can play itself (HTMLAudioElement) stay the page's job; there is no page bridge.

## Role

- `attachSound(tray)` returns a session-scoped capability: `beep(kind?)` (default/info/warning/error/question), `playSystemSound(name)`, `playSound(path)`, and an async `getBackend()` capabilities snapshot.
- Fire-and-forget semantics: every method resolves when playback is accepted (the native call was taken), not when it completes. There are no completion events.
- `playSystemSound` resolution law (frozen order): a common name (`notification`/`warning`/`error`) resolves through the frozen projection table (darwin `Glass`/`Sosumi`/`Basso`, win32 `SystemAsterisk`/`SystemExclamation`/`SystemHand`); anything else passes through as a platform-native sound name. A native miss rejects typed `sound_not_found` with a details payload — never a silent no-op, never a fallback to a default sound. `default`/`info`/`question` belong to `beep` only.
- `playSound` preflight before any transport use: `~` expansion, cwd-relative resolution, canonicalization, and readability (typed `sound_file_unreadable`). On win32 the file must additionally pass the frozen structural WAV validation (RIFF/WAVE magic, `declared_size + 8 <= actual`, fmt and data chunks inside the declared region, fmt payload >= 16 bytes, 12-byte minimum, 64 MiB cap, no decoding); violations reject typed `sound_format_unsupported`. darwin performs no content validation (its v1 format set wav/aiff/mp3/m4a is backend-declared).
- All methods on Linux reject typed `sound_platform_unsupported` before any dispatch. v1 carries no `playSound` options (reserved empty `PlaySoundOptions`); unknown option fields throw instead of being silently ignored.
- Rejections surface as `SoundError` with a stable `code` from the frozen four-code family; backend error details pass through as-is. The shared transport-close code surfaces unchanged (the sound family defines no transport alias).

The shared schema (types, the frozen common-name table, and the typed error family) lives in `@opentray/spec` and is re-exported here.

## Packaging

The facade ships one embedded native package: `platforms/<target>/` libraries for darwin-arm64/x64 and win32-arm64/x64 plus the `platforms/manifest.json` identity chain — no `optionalDependencies` platform packages. Consumers never install or locate the native library manually.

Consumer guides live in the public `skills/opentray` documentation.
