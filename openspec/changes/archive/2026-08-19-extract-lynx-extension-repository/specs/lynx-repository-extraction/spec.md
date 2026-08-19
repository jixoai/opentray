# Lynx Repository Extraction Specification

## Purpose

Define the destructive repository boundary that moves the official Lynx extension family into `jixoai/opentray-ext-lynx` while keeping OpenTray core generic and independently releasable.

## MODIFIED Requirements

### Requirement: OpenTray core SHALL publish without Lynx ownership

The OpenTray core repository SHALL NOT include Lynx facade packages, Lynx platform package atoms, the Lynx native crate, Lynx runtime carrier sources, Lynx patches, Lynx-specific build/staging scripts, Lynx smoke examples, or Lynx native release/preview/verification jobs. Generic extension ABI, loader, `@opentray/spec`, WebView, Badge, Runtime, and generic tray extension dispatch SHALL remain in core.

#### Scenario: Core build graph is Lynx-free

- **GIVEN** a fresh checkout of the OpenTray core repository
- **WHEN** a developer runs workspace discovery, build planning, and the core release/preview planner
- **THEN** no Lynx workspace member, package, native target, runtime sidecar, or Lynx-specific CI job is selected
- **AND** core build and verification do not require Lynx source dependencies or carrier downloads.

#### Scenario: Core generic extension boundary remains intact

- **GIVEN** an OpenTray client uses `TrayHandle.extend(...)`
- **WHEN** it loads an independently published Lynx extension package
- **THEN** the core daemon discovers and dispatches it through the generic extension ABI
- **AND** core code does not parse Lynx commands or own Lynx process lifecycle.

### Requirement: The independent Lynx repository SHALL own the complete Lynx release closure

`jixoai/opentray-ext-lynx` SHALL contain a normalized pnpm/Cargo workspace with the `@opentray/ext-lynx` facade, `@opentray/ext-lynx-darwin-arm64`, `@opentray/ext-lynx-darwin-x64`, the `opentray-ext-lynx` native crate, macOS carrier source, Lynx patches, bundle/smoke fixtures, and scripts required to build and stage the runtime artifacts. Public package metadata SHALL identify the new repository, while generated binaries SHALL remain CI/local staging outputs.

#### Scenario: New repository package graph is self-contained

- **GIVEN** a clean clone of `jixoai/opentray-ext-lynx`
- **WHEN** a developer installs dependencies and lists workspace packages
- **THEN** the facade, two Darwin platform atoms, native crate, and carrier build inputs are discoverable without a path into the OpenTray core checkout
- **AND** the facade depends only on public OpenTray contracts.

#### Scenario: New repository has an independent native release path

- **GIVEN** a Lynx changeset is present in the new repository
- **WHEN** its release workflow plans native work
- **THEN** it builds the Darwin extension libraries and runtime carrier, stages them into the platform package atoms, validates packed consumer artifacts, and publishes only through the repository's own release workflow
- **AND** the configured trusted publisher is exercised only by that repository's OIDC release workflow.

### Requirement: Shared protocol contracts SHALL not be copied into the Lynx repository

The Lynx native crate SHALL consume `opentray-spec` through an explicit pinned public source (initially a Git revision or published crate selected by the migration) rather than copying protocol definitions. The selected source and upgrade procedure SHALL be documented in the new repository.

#### Scenario: Protocol source is auditable

- **GIVEN** a maintainer inspects the Lynx native workspace
- **WHEN** they trace the `opentray-spec` dependency
- **THEN** it resolves to an explicit immutable source or version
- **AND** no duplicate local protocol crate shadows the core contract.

### Requirement: Core documentation SHALL describe the new ownership boundary

OpenTray core documentation, agent guidance, package aliases, and OpenSpec durable specs SHALL stop presenting Lynx as a core workspace atom and SHALL point users to `jixoai/opentray-ext-lynx` for Lynx development and release operations. The new repository SHALL provide the consumer-facing installation and smoke recipe.

#### Scenario: Documentation and implementation agree

- **GIVEN** a maintainer searches the core repository for Lynx ownership references
- **WHEN** the migration is complete
- **THEN** remaining references are limited to generic consumer compatibility or an explicit external-repository pointer
- **AND** no core command claims to build or publish Lynx.
