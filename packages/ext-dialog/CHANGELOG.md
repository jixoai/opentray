# @opentray/ext-dialog

## 0.33.5

## 0.33.4

## 0.33.3

## 0.33.2

## 0.33.1

## 0.33.0

## 0.32.0

### Minor Changes

- 8a1a6f7: darwin: custom dialog icons via `options.darwin.icon` (messageDialog).

  A file path to any loadable image — a custom `.png`/`.icns` or a system
  icon file — replaces the dialog's default app-icon slot. The osascript
  bridge projects it through `display dialog`'s `with icon file` (the
  severity badge yields: the single `with icon` parameter is either the
  severity constant or a file); an unreadable path rejects typed
  (`dialog_presentation_failed`, `reason: "icon-unreadable"`) before any
  dialog is shown. The in-process path (properly signed carriers)
  projects the same option through `NSAlert.setIcon`. Payload crosses as
  a positional run ARGV reference like every other bridge string.

## 0.31.3

### Patch Changes

- b19dfef: darwin bridge: message dialogs carry the carrier display name as their title.

  The osascript `display dialog` fallback left the title bar empty; the
  bridge now passes `with title` with the carrier bundle's
  `CFBundleDisplayName` (falling back to `CFBundleName`, then the process
  name) — the same string an in-process NSAlert shows by default, so both
  presentation paths show the same title. The title argv slot is composed
  like every other bridge payload (positional `item N of argv` reference,
  never a literal).

## 0.31.2

### Patch Changes

- db9e3a6: darwin: dialogs present through the osascript bridge fallback on unsigned carriers (issue #10 round 2).

  macOS 26 gates interactive dialog presentation by the carrier's
  code-signing class (empirical isolation matrix 2026-09-19): the
  in-process NSAlert/panel of an ad-hoc/linker-signed carrier renders in
  the degenerate form (untitled stacked button slots, stray help button,
  `<`-prefixed suppression placeholder) and never receives any click —
  human or routed-synthetic — under every activation strategy; the 0.31.1
  activation-only fix is retired (`activateIgnoringOtherApps` cannot
  change a signing class). Every show command now triages the process
  signature (same SecCode family as the ext-notification bridge): a
  properly signed carrier keeps the full in-process AppKit experience;
  unsigned/ad-hoc carriers present through the Apple-signed
  `/usr/bin/osascript` host (`display dialog`, `choose file/folder/file
name`) inside the same DeferredOperation transaction — spawn is the
  Accepted frame, child exit is the terminal, session cleanup kills the
  child, and every payload crosses as run ARGV, never AppleScript literal
  interpolation. Documented bridge degradations: `detail` folds into the
  message, `suppressionLabel` resolves `suppressed: false`, filter names
  drop (the extension union applies), bridge dialogs carry the osascript
  host icon. More than three buttons and mixed file+directory selection
  reject typed (`dialog_presentation_failed` with
  `reason: "bridge-buttons-limit"` / `"bridge-mixed-selection-unsupported"`)
  — never a silent clamp. Real-machine evidence: standard form restored,
  routed clicks resolve (alert one-button, three-button index mapping,
  picker cancel → null), zero orphan processes.

## 0.31.1

### Patch Changes

- 5b65f8e: darwin: modal dialogs are clickable on the real broker host (issue #10).

  The broker runs as an unactivated Accessory-policy app between
  surfaces; AppKit routes a non-active app's mouse clicks to application
  activation instead of the modal's buttons, so every shipped dialog
  hung forever on a real host (promise never settled) and rendered in
  the degenerate non-key-window form (blank third button slot, `<`-prefixed
  suppression placeholder, no default-key styling) — while both the
  synthetic-event ABI probe and the mocked-transport suite stayed green.
  Every modal session now begins after
  `NSApplication.activateIgnoringOtherApps(true)`: the modal window
  becomes the key window, clicks reach the buttons, and the system
  de-activates the app naturally after the terminal.

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
