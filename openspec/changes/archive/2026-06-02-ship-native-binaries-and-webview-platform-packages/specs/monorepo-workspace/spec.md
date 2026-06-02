## ADDED Requirements

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
