## ADDED Requirements

### Requirement: The wizard SHALL expose the navigation toolbar option

The wizard form SHALL offer an explicit 「导航工具栏」 toggle in the window-options section for both application flows (URL and command), defaulting to off. The toggle SHALL be a desired-state fact: it compiles into the v1 `window.toolbar` field, persists through draft reload, and round-trips through edit/export exactly like the CLI flag. Enabling it SHALL require no embedding knowledge — the wizard SHALL NOT probe, warn about, or condition the toggle on any target-site policy.

#### Scenario: The toggle defaults off and commits on enable

- **GIVEN** a wizard session for a URL or command application
- **WHEN** the window options render
- **THEN** the 「导航工具栏」 toggle SHALL be visible and default to off
- **AND** enabling it before confirmation SHALL commit `window.toolbar: true` into the frozen config

#### Scenario: Command applications get the same toggle

- **GIVEN** a wizard session in the command flow with a verified service
- **WHEN** the operator enables the navigation toolbar
- **THEN** the generated application SHALL compose the toolbar over the service window with the same carrier as URL applications
