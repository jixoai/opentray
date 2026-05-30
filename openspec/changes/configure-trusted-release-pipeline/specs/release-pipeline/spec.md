## ADDED Requirements

### Requirement: Trusted publisher script SHALL batch configure all public workspace packages

The repository SHALL provide a script under `scripts/` that discovers non-private workspace packages and configures npm trusted publishing for each package using GitHub Actions, repository `jixoai/opentray`, workflow file `release.yml`, environment `npm-release`, and both publish permissions.

#### Scenario: Script skips already matching packages

- **GIVEN** a package already has a trusted publisher matching repository, workflow file, environment, and allowed publish actions
- **WHEN** the batch script runs
- **THEN** it skips that package
- **AND** it does not attempt to replace or revoke existing npm trust configuration.

#### Scenario: Script exposes safe dry-run and check modes

- **GIVEN** maintainers want to inspect trusted publisher state
- **WHEN** they run dry-run or check mode
- **THEN** dry-run prints the commands it would run without mutating npm
- **AND** check mode exits non-zero when packages are missing the expected trust configuration.

### Requirement: Release workflow SHALL use OIDC trusted publishing claims

The GitHub Actions release workflow SHALL be named `release.yml`, SHALL run on `main`, SHALL use environment `npm-release`, and SHALL grant `id-token: write` so npm can exchange the GitHub OIDC token for a short-lived publish token.

#### Scenario: Trusted publishing claims match npm configuration

- **GIVEN** npm trusted publisher configuration uses repo `jixoai/opentray`, workflow `release.yml`, and environment `npm-release`
- **WHEN** GitHub Actions publishes packages
- **THEN** the OIDC claims emitted by the job match the npm trusted publisher configuration.

### Requirement: Changesets SHALL own version and publish automation

The repository SHALL include changesets configuration and root scripts for creating changesets, versioning packages, and publishing changed packages.

#### Scenario: Release action creates release PR or publishes

- **GIVEN** a commit lands on `main`
- **WHEN** changesets/action runs
- **THEN** it creates or updates a Version Packages PR if changesets exist
- **AND** it runs the repository publish command when package versions are ready to publish.

### Requirement: Release pipeline SHALL avoid long-lived npm write tokens

The release workflow SHALL NOT require `NPM_TOKEN` for publishing. Publishing SHALL rely on npm trusted publishing and GitHub OIDC.

#### Scenario: Workflow has no npm token dependency

- **GIVEN** the release workflow is inspected
- **WHEN** environment variables and secrets are reviewed
- **THEN** no `NPM_TOKEN` secret is required for publish.
