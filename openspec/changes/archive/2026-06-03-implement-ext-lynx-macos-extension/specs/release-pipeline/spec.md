## ADDED Requirements

### Requirement: Release workflow SHALL stage Lynx dylib and runtime sidecar from GitHub CI

When Lynx platform packages are part of the release set, the release workflow SHALL build the official Lynx extension dylib and the Lynx Explorer runtime sidecar zip in GitHub Actions before npm publish. The darwin platform packages SHALL receive both artifacts through workflow artifact transport, not from locally committed files.

#### Scenario: Darwin release stages both Lynx artifacts

- **GIVEN** the release workflow is preparing `@opentray/ext-lynx-darwin-arm64` or `@opentray/ext-lynx-darwin-x64`
- **WHEN** the native darwin build job succeeds
- **THEN** it uploads the Lynx extension dynamic library and `LynxExplorer.app.zip` as GitHub Actions artifacts
- **AND** the release job stages the dylib into the package `lib/` directory
- **AND** the release job stages `LynxExplorer.app.zip` into the package `runtime/` directory before npm publish.

### Requirement: Darwin Lynx runtime build SHALL use Xcode selection and the proven research build path

The release workflow SHALL select a full Xcode toolchain on darwin runners before building the official Lynx runtime sidecar. The workflow MAY reuse the researched Lynx build script, but the mainline release path SHALL keep that runtime build inside GitHub CI and under version-controlled scripts.

#### Scenario: Darwin release uses an explicit Xcode setup step

- **GIVEN** the release workflow builds Lynx runtime artifacts on macOS
- **WHEN** the workflow is inspected
- **THEN** it selects Xcode explicitly before the Lynx runtime build step
- **AND** the runtime zip is produced by a version-controlled build script in this repository.
