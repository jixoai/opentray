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

### Requirement: Ext-webview platform package atoms SHALL exist

The workspace SHALL include platform-specific native package atoms for the official WebView extension. The package names SHALL be `@opentray/ext-webview-darwin-arm64`, `@opentray/ext-webview-darwin-x64`, `@opentray/ext-webview-linux-arm64`, `@opentray/ext-webview-linux-x64`, `@opentray/ext-webview-windows-arm64`, and `@opentray/ext-webview-windows-x64`.

Each package SHALL declare `os` and `cpu` metadata matching exactly one platform target. The platform packages SHALL be binary artifact packages only; they SHALL NOT expose the public TypeScript facade.

#### Scenario: WebView platform packages are discoverable workspace atoms

- **GIVEN** the workspace package manifests are inspected
- **WHEN** the first-stage release package set is validated
- **THEN** all six `@opentray/ext-webview-<os>-<arch>` packages exist
- **AND** each package has platform-specific `os` and `cpu` constraints.

### Requirement: Generated native artifacts SHALL stay out of source control

Generated daemon binaries and WebView dynamic libraries SHALL NOT be committed to the source repository. The source tree MAY contain empty placeholder directories or `.gitkeep` files, but the actual executable and dynamic library files SHALL be produced by local staging scripts for local tests and by CI for npm publish.

#### Scenario: Source tree is binary-free

- **GIVEN** a developer inspects the git diff
- **WHEN** native artifacts have been built locally
- **THEN** generated files under platform package `bin` or `lib` directories are ignored
- **AND** npm package `files` entries still include those directories for CI-staged publish artifacts.
