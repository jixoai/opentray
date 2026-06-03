## MODIFIED Requirements

### Requirement: Release workflow SHALL stage Lynx dylib and runtime sidecar from GitHub CI

When Lynx platform packages are part of the release set, the release workflow SHALL build the official Lynx extension dylib and the OpenTray-owned Lynx runtime host app zip in GitHub Actions before npm publish. The darwin platform packages SHALL receive both artifacts through workflow artifact transport, not from locally committed files.

#### Scenario: Darwin release stages both Lynx artifacts

- **GIVEN** the release workflow is preparing `@opentray/ext-lynx-darwin-arm64` or `@opentray/ext-lynx-darwin-x64`
- **WHEN** the native darwin build job succeeds
- **THEN** it uploads the Lynx extension dynamic library and the OpenTray Lynx runtime host app zip as GitHub Actions artifacts
- **AND** the release job stages the dylib into the package `lib/` directory
- **AND** the release job stages the runtime host zip into the package `runtime/` directory before npm publish.

### Requirement: Darwin Lynx runtime build SHALL use Xcode selection and the proven research build path

The release workflow SHALL select a full Xcode toolchain on darwin runners before building the official Lynx runtime sidecar. The workflow MAY reuse the researched Lynx build steps and upstream Lynx library build graph, but the mainline release path SHALL build an OpenTray-owned host app rather than zipping a long-term patched `LynxExplorer.app`.

#### Scenario: Darwin release uses an explicit Xcode setup step

- **GIVEN** the release workflow builds Lynx runtime artifacts on macOS
- **WHEN** the workflow is inspected
- **THEN** it selects Xcode explicitly before the Lynx runtime build step
- **AND** the runtime zip is produced by a version-controlled build script in this repository
- **AND** that build script targets the OpenTray-owned Lynx host app carrier.

## ADDED Requirements

### Requirement: Published Lynx audit SHALL have a package-owned CLI command

After npm publish, maintainers SHALL be able to run a documented CLI command from a fresh install to visually verify the Lynx carrier path without depending on a workspace checkout bundle path. The command MAY still accept an explicit bundle override, but the default audit path SHALL come from a package-owned review bundle.

#### Scenario: Fresh install runs the final Lynx audit command

- **GIVEN** `opentray` and `@opentray/ext-lynx` have been installed from npm
- **WHEN** a maintainer runs `opentray smoke daemon-lynx`
- **THEN** the command resolves a package-owned review bundle by default
- **AND** it exercises the installed Lynx runtime host path instead of a workspace-local bundle path.
