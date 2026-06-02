## ADDED Requirements

### Requirement: Release workflow SHALL stage native artifacts before npm publish

The release workflow SHALL build daemon binaries and WebView dynamic libraries on platform-appropriate CI runners before running `changeset publish`. The publish job SHALL download those artifacts and place them into the package directories listed by each package manifest `files` field.

The source repository SHALL remain binary-free. CI-staged artifacts SHALL be present in the npm package tarballs.

#### Scenario: Publish job receives all native artifacts

- **GIVEN** the release workflow reaches npm publish
- **WHEN** package tarballs are prepared
- **THEN** each daemon platform package contains `bin/opentray` or `bin/opentray.exe`
- **AND** each WebView platform package contains its dynamic library artifact
- **AND** no generated native artifact needs to be committed to git.

### Requirement: Native artifact build matrix SHALL cover first-stage platform packages

The release workflow SHALL include build jobs for all first-stage platform packages: macOS arm64, macOS x64, Linux arm64, Linux x64, Windows arm64, and Windows x64. A platform target MAY initially publish a structured unsupported runtime if the native GUI capability cannot be validated, but the package and artifact path SHALL exist.

#### Scenario: Matrix maps targets to package directories

- **GIVEN** the release workflow build matrix is inspected
- **WHEN** targets are enumerated
- **THEN** each target maps to exactly one daemon package directory
- **AND** each target maps to exactly one WebView platform package directory.

### Requirement: Changesets SHALL version native platform packages with their facade packages

The release configuration SHALL keep `opentray` and daemon platform packages version-compatible. It SHALL also keep `@opentray/ext-webview` and WebView platform packages version-compatible. Published package dependency ranges SHALL NOT point at unpublished or mismatched platform package versions.

#### Scenario: Platform packages release with matching version

- **GIVEN** a first-stage release changes daemon binary packaging
- **WHEN** changesets versions packages
- **THEN** `opentray` and all daemon platform packages publish the same release version
- **AND** the `opentray` optional dependency ranges resolve to that version.

#### Scenario: WebView platform packages release with matching version

- **GIVEN** a first-stage release changes WebView dynamic runtime packaging
- **WHEN** changesets versions packages
- **THEN** `@opentray/ext-webview` and all WebView platform packages publish the same release version
- **AND** the facade optional dependency ranges resolve to that version when used.

### Requirement: Post-publish npm registry smoke SHALL be the final release gate

After npm publish, maintainers SHALL verify the release from a fresh project that installs packages from the npm registry rather than workspace links. The smoke SHALL prove daemon binary resolution, daemon health, WebView dynamic library resolution, and human-visible WebView behavior.

#### Scenario: Fresh npm install proves release

- **GIVEN** packages have been published to npm
- **WHEN** a fresh project installs the published versions
- **THEN** `opentray daemon health` can inspect daemon state
- **AND** the daemon can start from the installed platform binary
- **AND** WebView can load from the installed platform dynamic library
- **AND** the visual smoke works or reports a typed unsupported capability error.

### Requirement: Package bootstrap SHALL cover WebView platform atoms

The npm bootstrap/trusted-publish tooling SHALL support the `extension-platform` package kind for `@opentray/ext-webview-<os>-<arch>` packages. The script SHALL initialize missing local package manifests, publish initial packages only when explicitly requested, and configure or verify trusted publishing claims without product-specific branches.

#### Scenario: WebView platform package bootstrap is generic

- **GIVEN** a new `@opentray/ext-webview-darwin-arm64` package needs npm setup
- **WHEN** the package bootstrap script runs with kind `extension-platform`
- **THEN** it uses generic extension-platform manifest defaults
- **AND** it does not contain hardcoded WebView-specific npm logic.
