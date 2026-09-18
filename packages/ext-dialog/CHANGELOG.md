# @opentray/ext-dialog

## 0.31.0

## 0.30.2

## 0.30.1

### Patch Changes

- d4b56bb: Fix: every dialog command wire is FLAT next to `type` — the shipped
  0.29.0/0.30.0 facade wrapped `messageDialog`/`pickFile`/`pickDirectory`/
  `pickSavePath` payloads in a nested `{options: {...}}` object that the
  internally-tagged native `DialogCommand` decoder rejects with
  'unknown field `options`' (issue #8: every show command failed against
  the real extension). The wire now matches the crate's flat serde shape,
  pinned by mirrored literals on both sides (facade exact-equality frame
  assertions + a crate deserialization fixture proving the nested wrapper
  never decodes).

## 0.30.0

## 0.29.0

### Minor Changes

- 79da0f7: Native dialog and sound extensions (add-ext-dialog + add-ext-sound).

  **@opentray/ext-dialog** — first release. Native modal message dialogs,
  file/directory/save pickers through the generic DeferredOperation
  transaction: `attachDialog(tray)` → `messageDialog` (buttons/severity/
  suppression/default button), `pickFile`/`pickDirectory`/`pickSavePath`
  (filters, all-files spelling, canonicalized results), sugar
  `alert/confirm/promptYesNo`, async frozen `getBackend()` capability
  snapshot, typed error codes with structured details. Platform
  projections: darwin NSAlert/NSSavePanel modal-session stepping (never a
  bare runModal); win32 bounded STA workers with TaskDialogIndirect
  (runtime-resolved) + MessageBox fallback, honest pre-entry synchronous
  failures, join-timeout detach + module self-pin so a live worker's
  library is never unloaded.

  **@opentray/ext-sound** — first release. OS sound feedback atoms:
  `attachSound(tray)` → `beep(BeepKind)`, `playSystemSound(name)` (frozen
  common-name table notification/warning/error + platform-native names),
  `playSound(path)` (win32 exact RIFF validation, 64 MiB cap), async
  `getBackend()`. win32 miss detection uses the registry sound-scheme
  catalog as the authoritative oracle (winmm's BOOL is not a miss oracle
  under SND_NODEFAULT); darwin projects through NSSound with session-owned
  instance recycling. Both ship as embedded-kind packages (all four
  platform binaries inside the facade, real-pack audited: 1.32 MiB /
  1.02 MiB, well under the 3 MB split gate).

  Protocol: extension command ABI v2 (deferred dispositions + deferred
  completion port) with full v1 interop; broker protocol version 2.
