## ADDED Requirements

### Requirement: Darwin runtime carrier SHALL own macOS app bundle identity

OpenTray SHALL provide an internal shared Darwin runtime carrier for macOS `.app` bundle construction and launch identity. The carrier SHALL own the common app-bundle law for executable placement, `Info.plist` merge, bundle identifier selection, display name selection, activation policy inputs, and privacy usage string generation. Extension atoms SHALL consume the carrier through configuration instead of owning independent `.app` bundle implementations.

The carrier SHALL remain internal infrastructure for this change. It SHALL NOT expose a public package or user API unless a later distribution contract explicitly promotes it.

#### Scenario: Extension consumes carrier rather than owning bundle law

- **GIVEN** an official Darwin extension requires an app bundle identity
- **WHEN** its native artifact is built
- **THEN** the extension provides carrier configuration
- **AND** the shared Darwin carrier materializes the `.app` bundle
- **AND** the extension does not maintain a separate private app-bundle law.

#### Scenario: Carrier remains internal

- **GIVEN** the Darwin carrier is introduced for WebView permissions and badge helper migration
- **WHEN** packages are published
- **THEN** no new public carrier API is required
- **AND** existing distribution-facing extension package names may remain as compatibility projections.

### Requirement: Darwin carrier SHALL derive privacy usage strings from permission policy

The Darwin runtime carrier SHALL generate or merge macOS `Info.plist` privacy usage keys from declared browser permission policy. Camera, microphone, and any other macOS privacy-gated permission family SHALL have a deterministic default human-facing usage string when the permission family is declared. Applications MAY override the usage text through explicit app or extension configuration.

The generated `Info.plist` SHALL be carrier-owned source output. Extension atoms SHALL NOT each hand-maintain privacy usage strings for the same permission family.

#### Scenario: Permission policy produces plist privacy keys

- **GIVEN** a WebView permission policy declares camera and microphone permission families
- **WHEN** the Darwin app bundle is generated
- **THEN** the carrier includes the required macOS privacy usage keys for camera and microphone
- **AND** each key has either an app-provided usage string or the carrier default.

#### Scenario: App overrides human-facing usage text

- **GIVEN** an app provides custom privacy text for a declared permission family
- **WHEN** the carrier merges the generated `Info.plist`
- **THEN** the app-provided text overrides the carrier default
- **AND** the permission key remains present in the bundle.

### Requirement: Darwin carrier SHALL preserve source-of-action boundaries

The Darwin runtime carrier SHALL not grant browser permissions by itself. It SHALL provide app identity and native bundle metadata so platform privacy systems can evaluate requests. Runtime authorization decisions SHALL still trace to app identity, session, source origin, permission family, permission-management state, and prompt-confirmation policy.

#### Scenario: Bundle identity is not permission grant

- **GIVEN** a WebView page requests camera permission inside a carrier-backed `.app`
- **WHEN** the request reaches the permission policy
- **THEN** the carrier identity is available as platform context
- **AND** the final allow, deny, prompt, or unsupported decision is made by the permission policy
- **AND** the carrier does not silently grant the permission on its own.

## MODIFIED Requirements

## REMOVED Requirements

## RENAMED Requirements
