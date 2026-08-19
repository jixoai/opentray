## ADDED Requirements

### Requirement: Badge Darwin helper SHALL consume the shared Darwin carrier

The badge extension's macOS Dock helper SHALL be expressed as configuration for the shared internal Darwin runtime carrier. Badge SHALL continue to own badge facts and badge-specific commands, but SHALL NOT own private `.app` bundle construction, private `Info.plist` law, or private app-bundle release scripts once the shared carrier exists.

Distribution-facing package names, artifact names, and helper names MAY remain stable as compatibility projections when required by release tooling. Those projections SHALL NOT imply a separate badge-owned Darwin carrier.

#### Scenario: Badge helper is carrier configuration

- **GIVEN** a macOS badge helper artifact is built
- **WHEN** the build graph materializes the helper app bundle
- **THEN** badge supplies Dock badge behavior configuration
- **AND** the shared Darwin carrier supplies app-bundle construction and plist merge
- **AND** badge does not maintain a separate private app-bundle implementation path.

#### Scenario: Compatibility names are projections

- **GIVEN** release tooling still emits an artifact named for the badge helper
- **WHEN** the artifact is inspected
- **THEN** the artifact name is treated as distribution compatibility
- **AND** the underlying app-bundle mechanics are still owned by the shared Darwin carrier.

### Requirement: Badge extension SHALL remain an orthogonal status atom after carrier migration

The badge extension SHALL remain responsible only for badge text/count, progress, overlay icon, attention state, capability reporting, and platform badge projection behavior. It SHALL not import or reimplement WebView browser permission policy, `opentrayPermissions`, or WebView page capability logic while moving onto the shared Darwin carrier.

#### Scenario: Badge does not couple to WebView permissions

- **GIVEN** badge and WebView both consume the shared Darwin carrier
- **WHEN** badge sets a Dock badge label
- **THEN** the operation uses badge capability state and carrier launch identity only
- **AND** it does not depend on WebView permission policy or `opentrayPermissions`.

## MODIFIED Requirements

## REMOVED Requirements

## RENAMED Requirements
