## ADDED Requirements

### Requirement: Package bootstrap script SHALL initialize npm package atoms before trusted publishing

The repository SHALL provide a package bootstrap script under `scripts/npm/` that can take one package name and drive the package from local workspace state to npm registry state before configuring trusted publishing. The script SHALL treat package initialization, artifact validation, initial publish, trusted publisher configuration, and final verification as separate stages in one idempotent lifecycle.

The script SHALL NOT special-case `@opentray/ext-webview`. Platform package templates MAY exist, but they SHALL be generic package kinds rather than product-specific branches.

#### Scenario: Missing package is published before trust configuration

- **GIVEN** a local public package manifest exists for `@opentray/example`
- **AND** npm registry lookup reports that `@opentray/example` is missing
- **WHEN** the operator runs the bootstrap script with live publish and trust flags
- **THEN** the script publishes the initial npm version before running `npm trust github`
- **AND** it does not attempt trusted publisher configuration before the package exists.

#### Scenario: Existing package skips initial publish

- **GIVEN** npm registry lookup reports that the target package already exists
- **WHEN** the operator runs the bootstrap script
- **THEN** the script skips initial publish
- **AND** it never attempts to overwrite an already-published version.

#### Scenario: Package kind controls manifest defaults

- **GIVEN** the operator asks the script to create a missing workspace package
- **WHEN** the package kind is `plain`, `platform`, or `extension-platform`
- **THEN** the script creates only generic package metadata for that kind
- **AND** every generated public manifest includes repository metadata for `https://github.com/jixoai/opentray`.

### Requirement: Package bootstrap script SHALL keep live registry mutations explicit and idempotent

The package bootstrap script SHALL default to dry-run behavior. Live initial publish, trusted publisher creation, and trusted publisher replacement SHALL require explicit flags. The script SHALL report state transitions as structured data so a failed run can be safely retried.

#### Scenario: Dry-run does not mutate npm

- **GIVEN** the operator runs the package bootstrap script without the live-confirmation flag
- **WHEN** the package is missing from npm or trusted publishing is missing
- **THEN** the script reports the publish and trust commands it would run
- **AND** it does not publish, revoke trust, or create trust configuration.

#### Scenario: Matching trust is skipped

- **GIVEN** a package already has a trusted publisher matching repo `jixoai/opentray`, workflow file `release.yml`, environment `npm-release`, and publish plus stage-publish permissions
- **WHEN** the package bootstrap script verifies trust state
- **THEN** it skips trusted publisher creation
- **AND** it reports the package as already trusted.

#### Scenario: Mismatched trust requires explicit replacement

- **GIVEN** a package has a trusted publisher that does not match the expected claims
- **WHEN** the package bootstrap script runs without an explicit replacement flag
- **THEN** it stops before revoking or replacing trusted publisher state
- **AND** it reports the mismatch and the required operator action.

### Requirement: Package bootstrap script SHALL separate publish authentication from trust authentication

The package bootstrap script SHALL model initial npm publish authentication and trusted publisher authentication as separate auth modes. A local `NPM_TOKEN` MAY be used for initial package publish, but trusted publisher management SHALL use an npm authentication context accepted by `npm trust`, such as an ambient login or a temporary legacy-login session with per-command OTP.

#### Scenario: Token publish and legacy OTP trust are composed

- **GIVEN** `.env` contains a usable `NPM_TOKEN`, `NPM_WHOAMI`, `NPM_PASSWORD`, and `NPM_2FA_SECRET`
- **WHEN** the bootstrap script uses token publish auth and legacy-env trust auth
- **THEN** it publishes the initial package using a temporary token npm config
- **AND** it configures trusted publishing using a temporary npm login session and fresh `NPM_CONFIG_OTP`.

#### Scenario: Token trust failure is not treated as package write failure

- **GIVEN** token-authenticated package access reports read-write authority
- **AND** token-authenticated `npm trust` inspection returns an authorization error
- **WHEN** the package bootstrap script classifies the result
- **THEN** it reports trust-auth as blocked
- **AND** it does not claim package publish authority is missing.

### Requirement: Package bootstrap script SHALL handle npm registry propagation after initial publish

The package bootstrap script SHALL wait for registry visibility after a successful initial publish before final verification. The wait loop SHALL be bounded and SHALL distinguish publish success from registry read-after-write delay.

#### Scenario: Post-publish view is retried

- **GIVEN** `npm publish` succeeds for a new package
- **AND** an immediate `npm view <package> version` returns 404
- **WHEN** the package bootstrap script verifies registry visibility
- **THEN** it retries using bounded backoff
- **AND** it may use `npm dist-tag ls` and package access checks as supporting evidence
- **AND** it only proceeds to final success after the package version becomes visible or the retry budget is exhausted.

### Requirement: Package bootstrap script SHALL produce operator and machine-readable proof

The package bootstrap script SHALL emit a concise human-readable summary and a machine-readable report covering local package state, artifact validation, npm package state, registry visibility, auth mode, trusted publisher state, and final result.

#### Scenario: Bootstrap proof includes final trusted publisher claims

- **GIVEN** the package bootstrap script completes successfully
- **WHEN** the operator reads the report
- **THEN** the report includes the package name, version, whether initial publish happened, whether trust was created or skipped, and the final trusted publisher claims
- **AND** the report does not include secrets, OTP values, or npm auth tokens.
