## ADDED Requirements

### Requirement: darwin dialog presentation SHALL triage the carrier's code-signing class

macOS 26 gates interactive dialog presentation by the running process's code-signing class (empirical isolation matrix 2026-09-19, issue #10 round 2): an ad-hoc/linker-signed carrier's in-process `NSAlert`/panel renders in a degenerate form and never receives any click under any activation strategy. Every show command SHALL triage the process signature before presentation: a properly signed carrier keeps the in-process AppKit path; unsigned/ad-hoc carriers SHALL present through the Apple-signed `/usr/bin/osascript` host (`display dialog`, `choose file` / `choose folder` / `choose file name`) inside the same DeferredOperation transaction. Payload SHALL cross as osascript run ARGV, never AppleScript string-literal interpolation. Bridge degradations SHALL be documented, never silent: `detail` folds into the message, `suppressionLabel` resolves `suppressed: false`, filter names drop (the extension union applies), and the dialog title is the carrier display name. Session cleanup SHALL kill the bridge child.

#### Scenario: Unsigned carrier presents a clickable dialog through the bridge

- **GIVEN** a broker carrier with an ad-hoc/linker-signed code signature
- **WHEN** a messageDialog or picker is shown
- **THEN** it SHALL present through the osascript host in the standard form, resolve real clicks with the caller's button-index / path / cancel-null contract, and terminate the child process at completion or session close

#### Scenario: Bridge-inexpressible inputs reject typed before spawn

- **GIVEN** bridge presentation is active
- **WHEN** a messageDialog carries more than three buttons, a pickFile requests mixed file+directory selection, or `darwin.icon` names an unreadable file
- **THEN** the command SHALL reject typed (`dialog_presentation_failed` with `bridge-buttons-limit` / `bridge-mixed-selection-unsupported` / `icon-unreadable`) with zero Accepted frames, zero terminals, and no dialog shown

### Requirement: messageDialog SHALL accept a darwin custom icon path

`options.darwin.icon` (messageDialog) SHALL accept a file path whose loadable image replaces the dialog's default app-icon slot. The bridge SHALL project it through `display dialog`'s `with icon file` (the severity badge yields: the single `with icon` parameter is either the severity constant or a file); the in-process path SHALL project the same option through `NSAlert.setIcon`. The path SHALL cross as a positional run ARGV reference on the bridge.

#### Scenario: A custom icon replaces the default slot on both paths

- **GIVEN** `darwin.icon` names a readable image file
- **WHEN** the dialog presents
- **THEN** the image SHALL occupy the dialog's icon slot (bridge: via `with icon file`; in-process: via `NSAlert.setIcon`), and the button-index contract SHALL be unchanged
