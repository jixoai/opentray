## ADDED Requirements

### Requirement: Lynx extension packages SHALL exist as workspace atoms

The workspace SHALL include an official Lynx facade package and macOS platform-native package atoms. The facade package SHALL publish as `@opentray/ext-lynx`. The first-stage platform packages SHALL publish as `@opentray/ext-lynx-darwin-arm64` and `@opentray/ext-lynx-darwin-x64`.

Each platform package SHALL declare `os` and `cpu` metadata matching exactly one darwin target. The platform packages SHALL contain runtime distribution artifacts only; they SHALL NOT become the public TypeScript facade.

#### Scenario: Lynx package atoms are discoverable

- **GIVEN** the workspace package manifests are inspected
- **WHEN** the Lynx extension package set is validated
- **THEN** `@opentray/ext-lynx`, `@opentray/ext-lynx-darwin-arm64`, and `@opentray/ext-lynx-darwin-x64` exist
- **AND** the darwin platform packages have platform-specific `os` and `cpu` constraints.
