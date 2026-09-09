## MODIFIED Requirements

### Requirement: Create SHALL be fully non-interactive

`create-opentray create [target-dir]` SHALL create a v1 application without opening a browser, launching a prompt, or scraping application name/icon metadata. It SHALL accept either a complete v1 input document or explicit options that compile into v1 desired state. Explicit options SHALL include app identity/name, application and tray icon sources, exact command argv/cwd/env OR a single `--url` application source, package manager, icon smoothing, developer mode, window/shell options, and relevant apply controls.

The command SHALL support an argv delimiter so the executable and every subsequent argument arrive as exact vector elements. It SHALL require explicit `appId` and `appName` when no complete config and no derivable source supplies them; under `--url` the identity SHALL default to Core's URL identity derivation. Icon sources MAY be local files, HTTP(S) URLs, or Data URLs and SHALL use Core normalization. `--url` SHALL be mutually exclusive with `--exec`, `--arg`, `--cwd`, and `--env`; combining them SHALL fail validation before any plan.

#### Scenario: Explicit URL icons create without enrichment

- **GIVEN** app name, app id, command vector, HTTP app icon, and HTTP tray icon supplied to `create`
- **WHEN** the command runs non-interactively
- **THEN** it SHALL request a Core plan/apply without invoking title or favicon scraping
- **AND** the committed registration SHALL contain validated local snapshots

#### Scenario: A URL alone creates an application

- **GIVEN** only `--url https://example.com` (no identity, no command flags)
- **WHEN** `create` runs non-interactively
- **THEN** it SHALL derive identity from the URL and plan/apply a URL application
- **AND** the committed config SHALL carry `url` with no command object

#### Scenario: URL and command flags conflict

- **GIVEN** `--url https://example.com` together with `--exec npm`
- **WHEN** `create` compiles flags
- **THEN** it SHALL fail with a typed validation error naming the mutual exclusion
- **AND** no plan or mutation SHALL occur
