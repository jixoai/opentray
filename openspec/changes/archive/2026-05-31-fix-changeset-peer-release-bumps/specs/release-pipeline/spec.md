## ADDED Requirements

### Requirement: Changesets SHALL avoid accidental peer-dependent placeholder releases

The release pipeline SHALL configure changesets so peer dependents are bumped only when their peer dependency range no longer accepts the new dependency version. Roadmap placeholder packages SHALL NOT be released just because a first-stage runtime package they peer-depend on is being released.

#### Scenario: First-stage release does not bump placeholder extensions

- **GIVEN** `@opentray/ext-badge` and `@opentray/ext-island` only peer-depend on `opentray`
- **AND** their peer dependency range still accepts the planned `opentray` version
- **WHEN** `pnpm exec changeset status --verbose` calculates the first-stage release plan
- **THEN** the release plan does not include `@opentray/ext-badge`
- **AND** the release plan does not include `@opentray/ext-island`.
