## ADDED Requirements

### Requirement: Windows composition diagnostics SHALL remain extension-owned and opt-in

Windows WebView composition diagnostics SHALL live inside the `@opentray/ext-webview` Windows runtime and SHALL be enabled only by `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1`. The generic broker and `opentray-core` SHALL NOT parse diagnostic commands, own diagnostic state, or add WebView-specific branches.

The diagnostics SHALL describe the actual OpenTray host operation rather than a standalone raw Win32 probe. They SHALL NOT alter WebView controller creation, DWM background selection, shell state, focus, pointer capture, or rendering policy merely by being enabled.

#### Scenario: A normal product session remains diagnostic-free

- **GIVEN** a Windows WebView session starts without `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1`
- **WHEN** it changes background, frameless state, visibility, or size
- **THEN** no diagnostic records are emitted
- **AND** its native behavior is unchanged by the diagnostic capability.

#### Scenario: A source diagnostic run observes the real extension host

- **GIVEN** `example:win32-bug` starts with `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1`
- **WHEN** it invokes a supported residue control
- **THEN** the Windows extension emits records from its actual HWND/WebView/DWM host path
- **AND** no broker/core WebView special case is required.

### Requirement: Composition records SHALL distinguish request, operation, and observable native state

Each diagnostic record SHALL include an operation reason, monotonic operation sequence, requested background family, WebView clear-backing intent, frameless/resizable state, HWND style/ex-style, visible/minimized/maximized state, and native bounds. A completed shell-state clear SHALL also include elapsed time.

The operation reason SHALL distinguish at least manual `clearWhiteBlock`, next-message cleanup, delayed retained reveal cleanup, native-resize terminal cleanup, and explicit resize. The page SHALL separately label its bounded one-pixel pulse request. A record MAY report requested/effective host policy separately, but it SHALL NOT claim that a DWM/WebView2 internal surface was cleared unless a measurable API result exists.

#### Scenario: A manual clear records a shell-state baseline

- **GIVEN** the diagnostic environment variable is enabled
- **AND** a normal non-maximized Windows WebView has a material or transparent background
- **WHEN** the page invokes `navigator.opentray.execCommand("clearWhiteBlock")`
- **THEN** the native log records `manual-clear` before and after the shell-state operation
- **AND** the record includes requested surface contract, HWND state, and elapsed time
- **AND** the record does not assert that the visible residue was cleared.

#### Scenario: A skipped clear records its predicate rather than pretending success

- **GIVEN** diagnostics are enabled
- **AND** a clear is skipped because the window is hidden, minimized, maximized, opaque-framed, or in active soft-resize capture
- **WHEN** the runtime evaluates the operation
- **THEN** it records the skip reason and current native state
- **AND** it does not emit a false completed-clear result.

### Requirement: The Windows residue example SHALL reuse the Window control surface

`pnpm --filter opentray example:win32-bug` SHALL be a Windows-only source-tree diagnostic entrypoint. It SHALL use the standard caller-scoped broker, local Vite server, retained WebView lifecycle, primary `Show Example` / `Hide Example` menu behavior, and shutdown ordering used by runnable WebView examples.

Its `/win32-bug` page SHALL reuse every control from WebView Control's first Window card: capability/style refresh, frameless/resizable/topmost toggles, opacity, background and background-state selection, Windows corner preference, minimize/maximize/restore, resize, move, `clearWhiteBlock`, close, and devtools controls. The page SHALL add a residue probe without duplicating a second native style authority.

The diagnostic entrypoint SHALL set `OPENTRAY_WINDOWS_AUTO_CLEAR_WHITE_BLOCK=0` before starting its source runtime. This confines automatic-recovery suppression to the diagnostic session so a one-pixel pulse measures its geometry path without an automatic shell-state clear. The explicit page `clearWhiteBlock` command SHALL remain available as the shell-state control baseline.

#### Scenario: A Windows operator reaches the complete control baseline

- **GIVEN** the operator runs `pnpm --filter opentray example:win32-bug` on Windows
- **WHEN** the diagnostic window opens
- **THEN** the page exposes all first Window card controls
- **AND** the tray primary item reflects retained operational visibility
- **AND** the source runtime uses a caller-scoped broker and local Vite URL.
- **AND** automatic white-block recovery is disabled before the WebView session starts.

#### Scenario: A non-Windows invocation fails truthfully

- **GIVEN** an operator invokes `example:win32-bug` on a non-Windows platform
- **WHEN** the example validates its host platform
- **THEN** it exits with a clear Windows-only diagnostic message
- **AND** it does not claim a cross-platform residue result.

### Requirement: The residue probe SHALL compare manual clear with a reversible one-pixel geometry pulse

The `/win32-bug` residue probe SHALL expose a reversible one-pixel native resize pulse derived from the current trusted native bounds. It SHALL request `width + 1` then restore the original dimensions through the existing typed window bridge. It SHALL record page-side request/failure details without claiming visual success.

The probe SHALL retain the existing `clearWhiteBlock` command as a control baseline and SHALL explicitly distinguish manual-clear, frameless/background transition, and one-pixel pulse operations in its operator-facing log.

#### Scenario: An operator compares the known contrast under one window session

- **GIVEN** a material-backed Windows diagnostic window displays residue after a frameless or retained-reveal transition
- **WHEN** the operator invokes `clearWhiteBlock`
- **THEN** the page records the manual baseline request
- **WHEN** the operator invokes the one-pixel pulse
- **THEN** the page resizes from the current native bounds by one pixel and restores the original bounds
- **AND** automatic shell recovery does not run during either explicit resize
- **AND** the operator can compare the same window/session before deciding whether either operation visibly cleared residue.

### Requirement: Candidate recovery SHALL remain evidence-gated

The production `clearWhiteBlock` mechanism SHALL remain the current shell-state control baseline during this change. A non-shell candidate such as `SWP_NOCOPYBITS`, host geometry pulse, WebView parent reattachment, or composition-root reattachment SHALL be introduced only as one named diagnostic candidate at a time after the baseline matrix is captured.

A candidate SHALL NOT replace the production clear path unless Windows visual acceptance shows it clears the target residue for the same trigger, introduces no shell-state flash, and preserves focus, pointer/input routing, retained page state, and operational visibility semantics.

#### Scenario: A candidate does not become a silent production workaround

- **GIVEN** a diagnostic candidate changes non-shell window or controller behavior
- **WHEN** it has not passed the source evidence matrix and human-visible acceptance
- **THEN** it remains opt-in and explicitly named in the diagnostic surface
- **AND** the existing production clear path remains the control baseline.
