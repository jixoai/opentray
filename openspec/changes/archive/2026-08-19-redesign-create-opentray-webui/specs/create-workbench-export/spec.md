## ADDED Requirements

### Requirement: Export SHALL offer direct command, POSIX shell, and PowerShell

The WebUI SHALL export the complete normalized create-opentray invocation through Core as direct clipboard command, `.sh`, or `.ps1`. The UI SHALL make target shell/format explicit, show an accessible preview, and preserve the exact app identity, argv, cwd, env, icon sources/render options, window/shell options, developer mode, package manager, target/link choice, and applicable operation controls. It SHALL not hand-build quoting in browser code.

#### Scenario: Script formats preserve the same desired state

- **GIVEN** one reviewed form state
- **WHEN** `.sh` and `.ps1` exports are generated
- **THEN** both SHALL reconstruct semantically equivalent Core desired state on their supported platform
- **AND** format-specific quoting SHALL not change argv elements

### Requirement: Uploaded resources SHALL default to self-contained script export

When any selected icon/resource originates from browser-uploaded bytes without a stable external URL/path, the default export action SHALL be script download with embedded bytes. Direct clipboard copy SHALL remain available only through an explicit force-copy choice that states the resulting command may be very long. The copy action SHALL report success/failure and never silently fall back to a different format.

#### Scenario: Upload disables ordinary copy default

- **GIVEN** an uploaded SVG used by the form
- **WHEN** Export opens
- **THEN** self-contained script download SHALL be selected by default
- **AND** direct command copy SHALL require an explicit long-content override

### Requirement: Any environment overlay SHALL require editable risk review

If one or more env entries exist, Export SHALL present the complete env overlay in an editable review form before copy or download. Values SHALL be visible/editable only in this explicit review context according to normal input privacy behavior. The user MAY retain, clear, or replace each value with their own safe template token. Complete export SHALL remain blocked until a non-preselected disclaimer checkbox acknowledges that exported commands/scripts contain the reviewed environment values.

The UI SHALL not label any individual value as sensitive or safe and SHALL not use name/value heuristics.

#### Scenario: User sanitizes env before acknowledgement

- **GIVEN** an env-bearing export with real values
- **WHEN** the user replaces values with template tokens and checks the disclaimer
- **THEN** export SHALL contain the edited template values
- **AND** original values SHALL not appear in the exported artifact or export diagnostics

### Requirement: Export SHALL be accessible under clipboard and download failure

Copy and download controls SHALL expose pending state, lock duplicate actions, announce completion, and return actionable errors for clipboard permission denial, browser download failure, Core serialization failure, or unsupported value. Preview/code SHALL remain keyboard scrollable and LTR in every locale. Failure SHALL not discard the reviewed form or env edits.

#### Scenario: Clipboard denial preserves script path

- **GIVEN** browser clipboard permission is denied
- **WHEN** direct copy fails
- **THEN** the error SHALL be announced and the reviewed command SHALL remain visible
- **AND** `.sh`/`.ps1` download choices SHALL remain available without rebuilding the plan

