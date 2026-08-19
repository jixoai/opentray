# create-lifecycle-kernel Specification

## Purpose
TBD - created by archiving change unify-create-opentray-core. Update Purpose after archive.
## Requirements
### Requirement: Core SHALL expose deterministic Plan and Apply procedures

Core SHALL provide adapter-neutral procedures to load, normalize, validate, plan, and apply create-opentray desired state. Planning SHALL perform all non-mutating checks needed to describe affected registration paths, payload paths, resources, process actions, generated files, install/launch actions, warnings, and destructive effects. Apply SHALL consume a validated plan or revalidate equivalent preconditions before mutation so CLI and WebUI cannot implement divergent creation semantics.

#### Scenario: CLI and WebUI inputs produce the same plan

- **GIVEN** semantically identical v1 input submitted through CLI and WebUI adapters
- **WHEN** each adapter requests a Core plan
- **THEN** the normalized desired state and ordered effect plan SHALL be equivalent
- **AND** adapter-only presentation fields SHALL not change the plan

### Requirement: Force SHALL require verified create-opentray ownership

Core SHALL treat a registration and its physical `app/` payload as fully regenerable only after a valid v1 configuration, immutable identity, canonical registration location, and expected ownership markers agree. Force MAY transactionally replace that verified payload. Force SHALL NOT adopt or recursively clear an unknown non-empty directory, an identity-mismatched registration, or an unverified external target.

The registration envelope and its source resources SHALL survive ordinary payload replacement. Failed apply SHALL either leave the prior payload usable or return a recoverable transaction state; it MUST NOT expose a half-written payload as successful.

#### Scenario: Force cannot adopt user files

- **GIVEN** a non-empty target directory without a matching v1 registration
- **WHEN** Apply is requested with force enabled
- **THEN** Core SHALL reject the operation before deletion
- **AND** every pre-existing file SHALL remain untouched

### Requirement: List SHALL preserve unhealthy registration evidence

Core SHALL classify entries that have a v1 configuration or v1 registration shape as healthy, invalid-config, incompatible-version, missing-payload, broken-link, or running as applicable. It SHALL return typed status and resolved paths instead of silently hiding damaged v1 registrations. Legacy directories without v1 authority remain outside this classification.

#### Scenario: Broken payload remains actionable

- **GIVEN** a v1 registration whose `app/` link target no longer exists
- **WHEN** Core lists registrations
- **THEN** the record SHALL be returned with `broken-link` status and resolved link evidence
- **AND** no target SHALL be recreated during the read operation

### Requirement: Running application mutation SHALL conserve process ownership

Generated applications SHALL publish a caller-owned runtime record containing at least PID and a unique ownership token under the registration's authority. Apply and Uninstall SHALL return typed `app_running` when that verified process is live unless the adapter explicitly authorizes stop-running. Stop SHALL target only a process whose live identity and ownership token still match; Core SHALL never kill by process name or `appId` alone. Restart SHALL be a separate explicit post-apply action.

#### Scenario: Stale PID cannot authorize termination

- **GIVEN** a runtime record whose PID has been reused by an unrelated process or whose token no longer matches
- **WHEN** stop-running is requested
- **THEN** Core SHALL refuse to terminate the process
- **AND** Apply or Uninstall SHALL remain blocked with actionable ownership evidence

### Requirement: Uninstall SHALL distinguish registration removal from target purge

For a physical managed `app/` directory, Uninstall MAY remove the payload and registration envelope after ownership and running-state checks. For a linked external payload, ordinary Uninstall SHALL remove only the directory link and registration envelope while retaining the resolved external target. External target deletion SHALL require explicit purge-target authorization and a second identity/ownership validation immediately before deletion.

Every result SHALL state the registration path, resolved payload path, whether a link was removed, whether the target was retained or deleted, and that macOS Dock or Windows taskbar pins remain user-managed.

#### Scenario: Linked uninstall preserves user files

- **GIVEN** a healthy registration whose `app/` points to an external directory
- **WHEN** Uninstall runs without purge-target
- **THEN** Core SHALL unlink the registration and retain the external directory
- **AND** the result SHALL explicitly print/report that retention

