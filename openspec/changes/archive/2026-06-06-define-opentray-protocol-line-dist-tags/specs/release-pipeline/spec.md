## ADDED Requirements

### Requirement: OpenTray packages SHALL publish under extension-agnostic protocol-line dist-tags

OpenTray SHALL define an OpenTray-wide protocol family and protocol-line version for install-time compatibility selection. The npm protocol-line dist-tag SHALL use the shape `<channel>-<major>-<minor>`, where `channel` is a release maturity channel such as `stable` or `alpha`, and `<major>-<minor>` is the OpenTray protocol-line version.

The protocol-line tag SHALL be extension-agnostic. Tags such as `stable-webview-1-0` or `alpha-lynx-1-0` SHALL NOT be used for the OpenTray core protocol line because they imply the core release law knows official extension product protocols. Official extension packages SHALL instead publish compatible versions under the same OpenTray protocol-line tag as the compatible core package.

#### Scenario: Stable install locks a compatible package closure

- **GIVEN** `opentray`, `@opentray/ext-webview`, and their platform package atoms implement OpenTray protocol line `opentray-protocol/1.0`
- **WHEN** a maintainer assigns the stable protocol-line dist-tag
- **THEN** the tag is `stable-1-0`
- **AND** every compatible public package atom is tagged with that same `stable-1-0` selector
- **AND** no tag contains `webview`, `lynx`, or another extension product name.

#### Scenario: Alpha install uses the same protocol-line law

- **GIVEN** an alpha package set implements OpenTray protocol line `opentray-protocol/1.0`
- **WHEN** the package set is exposed for alpha users
- **THEN** the protocol-line tag is `alpha-1-0`
- **AND** alpha is treated as a release maturity channel, not as a separate extension protocol.

### Requirement: Protocol-line dist-tags SHALL remain install-time selectors, not runtime authority

OpenTray SHALL keep runtime protocol compatibility enforced by the local broker handshake and endpoint identity. npm protocol-line dist-tags SHALL help users install compatible package sets, but SHALL NOT replace runtime handshake validation, daemon package-version isolation, or dynamic extension ABI validation.

#### Scenario: Mismatched install still fails at runtime

- **GIVEN** a project accidentally combines packages from incompatible OpenTray protocol lines
- **WHEN** the client connects to a daemon or loads a dynamic extension
- **THEN** the runtime handshake or ABI validation rejects the mismatch
- **AND** the failure is not hidden by npm tag naming.

### Requirement: Release tooling SHALL plan protocol-line dist-tags from the public spec

OpenTray SHALL provide release tooling that reads public workspace packages and generates the npm `dist-tag add` operations for the current OpenTray protocol line. The tooling SHALL derive the protocol-line tag from `@opentray/spec` constants rather than duplicating string literals in scripts or workflow files.

The tooling SHALL default to dry-run output. Live registry mutation SHALL require an explicit apply flag and an npm authentication context that can mutate dist-tags.

#### Scenario: Dry-run emits stable protocol-line commands

- **GIVEN** public workspace packages have package names and versions
- **WHEN** the maintainer runs the protocol dist-tag planner for channel `stable`
- **THEN** it emits `npm dist-tag add <package>@<version> stable-1-0` commands
- **AND** it does not mutate the npm registry.

#### Scenario: Live mutation remains explicit

- **GIVEN** a maintainer wants to update protocol-line dist-tags
- **WHEN** they run the planner without `--apply`
- **THEN** no registry mutation occurs
- **AND** the output can be reviewed before an authenticated `--apply` run.

### Requirement: Trusted-publishing release workflow SHALL not pretend OIDC can mutate arbitrary dist-tags

OpenTray's release workflow SHALL keep trusted publishing as the default package publishing path. Because npm OIDC trusted publishing currently authorizes `npm publish` and `npm stage publish`, the workflow SHALL NOT silently add post-publish `npm dist-tag add` steps unless the repository has an explicitly approved authentication mechanism for dist-tag mutation.

The workflow MAY generate and test a protocol-line tag plan as release evidence. Automatic post-publish tag mutation SHALL require a separate security decision because it would introduce traditional npm write credentials or depend on a future npm OIDC capability.

#### Scenario: Release plan distinguishes publish auth from dist-tag auth

- **GIVEN** the release workflow publishes packages with npm trusted publishing
- **WHEN** maintainers inspect the protocol-line dist-tag law
- **THEN** package publish remains OIDC-backed
- **AND** protocol-line dist-tag mutation is documented as a separate authenticated operation
- **AND** the workflow does not claim protocol-line tags were updated unless `npm dist-tag add` actually ran with suitable auth.
