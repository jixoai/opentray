## MODIFIED Requirements

### Requirement: Native artifact workflow SHALL keep daemon and extension atoms independent

The CI build and staging law SHALL treat the daemon binary and each native extension artifact as independent atoms. Building `opentray-bin` SHALL NOT link WebView runtime into the daemon. Building `opentray-ext-webview` SHALL produce the WebView dynamic library for its platform package.

Release-time native artifact planning SHALL derive its build closure from the package families named by the current pending changesets. It SHALL NOT assume that every publish needs every first-stage native extension family.

#### Scenario: CI preserves WebView runtime ownership

- **GIVEN** CI builds release artifacts for macOS
- **WHEN** linkage evidence is inspected
- **THEN** the daemon binary does not link WebView runtime frameworks
- **AND** the WebView dynamic library owns WebView runtime linkage.

#### Scenario: Package staging keeps atoms separate

- **GIVEN** CI downloads native artifacts into the release job
- **WHEN** staging scripts populate package directories
- **THEN** daemon binaries go only to daemon platform packages
- **AND** WebView dynamic libraries go only to WebView platform packages.

#### Scenario: WebView-only release plan excludes Lynx work

- **GIVEN** the pending changesets release `@opentray/ext-webview`
- **AND** they do not release `@opentray/ext-lynx`
- **WHEN** the release planner resolves the native build jobs
- **THEN** it schedules WebView native atoms for the WebView first-stage targets
- **AND** it does not compile `opentray-ext-lynx`
- **AND** it does not invoke the Lynx runtime sidecar build

#### Scenario: Lynx release plan stays darwin-scoped and includes runtime

- **GIVEN** the pending changesets release `@opentray/ext-lynx`
- **WHEN** the release planner resolves the native build jobs
- **THEN** it schedules Lynx native atoms only for the supported darwin targets
- **AND** it includes the Lynx runtime sidecar atom for those targets
- **AND** it does not schedule Windows or Linux Lynx jobs

### Requirement: Release workflow SHALL stage native artifacts before npm publish

The release workflow SHALL build daemon binaries and WebView dynamic libraries on platform-appropriate CI runners before running `changeset publish`. The publish job SHALL download those artifacts and place them into the package directories listed by each package manifest `files` field.

The source repository SHALL remain binary-free. CI-staged artifacts SHALL be present in the npm package tarballs.

The release workflow SHALL skip native artifact compilation and native package staging when the current pending changesets do not release any native package families.

#### Scenario: Publish job receives all native artifacts

- **GIVEN** the release workflow reaches npm publish
- **WHEN** package tarballs are prepared
- **THEN** each daemon platform package contains `bin/opentray` or `bin/opentray.exe`
- **AND** each WebView platform package contains its dynamic library artifact
- **AND** no generated native artifact needs to be committed to git.

#### Scenario: No pending changesets skip native build planning

- **GIVEN** the release workflow starts on a revision with no pending changeset files
- **WHEN** the release planner resolves the native build closure
- **THEN** it returns no native jobs
- **AND** the native artifact matrix does not start

#### Scenario: WebView-only release validates only WebView package atoms

- **GIVEN** the release planner selected only WebView native atoms for the current publish
- **WHEN** the release job stages and validates package contents
- **THEN** it stages only the selected WebView platform package directories
- **AND** it does not require Lynx package directories to contain artifacts
- **AND** it does not fail because an unrelated Lynx runtime zip was never built
