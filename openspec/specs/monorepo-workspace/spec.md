# monorepo-workspace Specification

## Purpose

Define OpenTray's pnpm workspace topology, npm package naming law, initial package set, and repository agent guide requirements.

## Requirements
### Requirement: Workspace SHALL use pnpm monorepo topology

The project SHALL initialize as a pnpm workspace with package directories under `packages/*`. Root workspace metadata SHALL be private and SHALL expose scripts for OpenSpec vision workflow validation and workspace package inspection.

#### Scenario: Workspace package discovery is explicit

- **GIVEN** a developer opens the repository
- **WHEN** they inspect workspace configuration
- **THEN** `pnpm-workspace.yaml` includes `packages/*`
- **AND** root `package.json` remains private
- **AND** root scripts include OpenSpec vision commands.

### Requirement: CLI package SHALL publish as unscoped npm opentray

The package under `packages/cli` SHALL be named `opentray`. It SHALL represent the final public npm package that developers install directly.

#### Scenario: CLI package owns the public package name

- **GIVEN** the workspace is initialized
- **WHEN** `packages/cli/package.json` is inspected
- **THEN** its `name` is `opentray`
- **AND** its README explains that it is the developer-facing SDK and CLI entry package.

### Requirement: Non-cli packages SHALL publish under @opentray scope

Every package directly under `packages/*` except `packages/cli` SHALL use the npm name `@opentray/<directory-name>`.

#### Scenario: Scoped packages follow directory naming

- **GIVEN** a package directory exists under `packages/*`
- **WHEN** the package is not `packages/cli`
- **THEN** its package name is scoped as `@opentray/<directory-name>`.

### Requirement: Initial package set SHALL cover platform and extension atoms

The initial workspace SHALL include placeholders for the TypeScript protocol package, official extension packages, and per-platform binary packages needed by the OpenTray distribution model.

#### Scenario: Initial package names are present

- **GIVEN** the repository is initialized
- **WHEN** package manifests are inspected
- **THEN** the workspace includes `opentray`, `@opentray/spec`, `@opentray/ext-webview`, `@opentray/ext-badge`, `@opentray/ext-island`, and six per-platform binary packages.

### Requirement: AGENTS guide SHALL preserve project law

The repository SHALL include `AGENTS.md` describing the OpenTray vision, monorepo management law, package naming law, OpenSpec workflow, verification expectations, and architecture boundaries.

#### Scenario: Agent guide orients future work

- **GIVEN** a future agent starts in the repository
- **WHEN** it reads `AGENTS.md`
- **THEN** it can identify OpenTray's Desktop Status Platform goal
- **AND** it can see how to use vision-driven OpenSpec before implementation
- **AND** it can see package ownership boundaries.
