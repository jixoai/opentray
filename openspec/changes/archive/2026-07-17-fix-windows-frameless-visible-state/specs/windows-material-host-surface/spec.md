## MODIFIED Requirements

### Requirement: Probe frameless shell SHALL match the standalone comparator

When the native material comparator topology is enabled and the retained window enters frameless mode, the host SHALL preserve the native resize frame and system-menu style, leave DWM non-client rendering under window-style policy, and use native resizing. It SHALL first delegate `WM_NCCALCSIZE` to the default window procedure, preserve the resulting left/right/bottom native resize insets, and then project only the client top to `window top + DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`. It SHALL NOT retain the caption-height gap above WebView2. Copied client bits MAY be discarded only in this comparator path.

This comparator-only shell SHALL NOT replace the production frameless procedure. Production frameless windows SHALL continue to own full-client geometry, disabled DWM non-client rendering, and application-level soft resize.

#### Scenario: Comparator frameless keeps native resize without a caption gap

- **GIVEN** comparator topology is active on Windows 11
- **AND** the retained window uses frameless style without AppWindow overlay
- **WHEN** Win32 recalculates non-client geometry
- **THEN** the default window procedure owns the left/right/bottom native resize insets
- **AND** the client top is reset to the raw window top plus the DWM visible-frame border thickness
- **AND** public bounds minus `window.outerWidth` and `window.outerHeight` each remain within 0-4 logical pixels.

#### Scenario: Production frameless remains independent

- **GIVEN** an ordinary OpenTray window without comparator topology
- **WHEN** it enters frameless mode
- **THEN** its established full-client and soft-resize behavior remains unchanged
- **AND** comparator-only native-frame and copied-bit policies do not apply.
