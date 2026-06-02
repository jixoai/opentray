## ADDED Requirements

### Requirement: Release workflow SHALL compile native binaries only in GitHub CI/CD

Release-grade native daemon binaries and native extension dynamic libraries SHALL be compiled by GitHub Actions before npm publish. Local native builds MAY be used for developer smoke tests, but they SHALL NOT be used as release inputs and SHALL NOT be committed to source control.

#### Scenario: Published tarballs come from CI artifacts

- **GIVEN** the release workflow reaches npm publish
- **WHEN** daemon and extension platform package tarballs are prepared
- **THEN** their native files come from artifacts built in the same GitHub Actions workflow run
- **AND** no local `target/release` artifact is required
- **AND** no generated native binary is committed to git.

#### Scenario: Local binary staging is not release authority

- **GIVEN** a maintainer has locally staged native binaries for smoke testing
- **WHEN** a release workflow runs on `main`
- **THEN** the workflow rebuilds native artifacts in GitHub CI
- **AND** it does not trust local staged binaries as publish inputs.

### Requirement: Native build workflow SHALL use maintained Actions for toolchain cache and artifact transport

The native build workflow SHALL use maintained GitHub Actions or GitHub Marketplace Actions for Rust toolchain setup, Cargo caching, and artifact upload/download. Custom shell scripts MAY copy files after build, but they SHALL NOT replace maintained Actions for toolchain installation, cache management, or cross-job artifact transport.

The preferred Action shape SHALL be either `actions-rust-lang/setup-rust-toolchain` with cache enabled or `dtolnay/rust-toolchain` plus `Swatinem/rust-cache`. Cross-job artifact movement SHALL use `actions/upload-artifact` and `actions/download-artifact`.

#### Scenario: Rust setup is not hand-rolled

- **GIVEN** the native artifact workflow is inspected
- **WHEN** Rust is installed and Cargo cache is configured
- **THEN** the workflow uses a maintained Rust setup/cache Action
- **AND** it does not rely on ad hoc curl/install/cache shell code.

#### Scenario: Publish job receives artifacts through official artifact Actions

- **GIVEN** native artifacts are built by platform matrix jobs
- **WHEN** the release job stages npm packages
- **THEN** it downloads build outputs through `actions/download-artifact`
- **AND** the matrix jobs upload those outputs through `actions/upload-artifact`.

### Requirement: Native build matrix SHALL prefer native runners for GUI extension artifacts

Native daemon and WebView extension artifacts SHALL be built on platform-appropriate GitHub hosted runners when those runners are available. Cross-compilation Actions MAY be used only as a documented fallback for daemon-only artifacts or future non-GUI extension atoms. WebView dynamic libraries SHALL NOT use cross-compilation as the default because native GUI frameworks and system WebView dependencies must be exposed by CI.

#### Scenario: WebView artifacts build on native platform runners

- **GIVEN** the workflow builds `opentray-ext-webview`
- **WHEN** the target is macOS, Linux, or Windows
- **THEN** the build job runs on a matching native OS runner
- **AND** it installs or uses that platform's native WebView dependencies.

#### Scenario: Cross build fallback is explicit

- **GIVEN** a native runner for a target is unavailable or unreliable
- **WHEN** the workflow uses a cross-compilation Action
- **THEN** the fallback is documented in the workflow or OpenSpec
- **AND** it is not used to claim WebView visual/runtime validation unless the native dependency surface is also proven.

### Requirement: Release workflow SHALL reject GitHub Release binary upload as the main artifact path

OpenTray's release surface SHALL remain npm platform package tarballs. GitHub Release binary upload Actions MAY be used only for an additional distribution channel after npm package staging is proven. They SHALL NOT replace npm package artifact staging or trusted publishing.

#### Scenario: Native artifacts are staged into npm packages

- **GIVEN** native artifacts have been compiled by CI
- **WHEN** the release job prepares publishable packages
- **THEN** daemon artifacts are staged into daemon platform packages
- **AND** extension dynamic libraries are staged into extension platform packages
- **AND** the workflow does not require GitHub Release assets for npm consumers.

### Requirement: Native artifact workflow SHALL keep daemon and extension atoms independent

The CI build and staging law SHALL treat the daemon binary and each native extension artifact as independent atoms. Building `opentray-bin` SHALL NOT link WebView runtime into the daemon. Building `opentray-ext-webview` SHALL produce the WebView dynamic library for its platform package.

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
