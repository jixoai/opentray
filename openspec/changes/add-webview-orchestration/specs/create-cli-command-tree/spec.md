## MODIFIED Requirements

### Requirement: Create SHALL expose window behavior options

`create` (and `app edit`) SHALL accept `--toolbar` (URL and command applications: compose the native navigation toolbar over the target/service page), `--no-title-follow` (negate the default window-title-follows-document behavior), and `--icon-follow` (opt in to runtime favicon→window-icon following). These compile into the v1 `window` object and round-trip through export. The toolbar flag SHALL NOT be dropped or downgraded in response to any target-site embedding policy.

#### Scenario: Toolbar and sync flags compile and round-trip

- **GIVEN** `create --url https://example.com --toolbar --icon-follow`
- **WHEN** the invocation compiles and its registration is exported
- **THEN** the committed `window` SHALL record the toolbar and icon-following facts
- **AND** the exported command SHALL carry `--toolbar` and `--icon-follow`
