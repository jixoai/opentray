## ADDED Requirements

### Requirement: OpenTray protocol-line tags SHALL evolve as a same-major compatibility line

OpenTray SHALL define the protocol-line tag family as `<channel>-<major>-<minor>`, where `channel` is a maturity selector such as `stable` or `alpha`, and `<major>-<minor>` identifies the current OpenTray protocol line from `@opentray/spec`. The protocol-line tag SHALL remain extension-agnostic. The line MAY advance by minor version within the same major when the new line remains backward-compatible with earlier minors in that major. The tag SHALL represent the current install-time compatibility line, not a product-specific protocol or runtime authority.

#### Scenario: New compatible minor line advances the selector

- **GIVEN** the current OpenTray protocol line is `1.2`
- **WHEN** the release team publishes the next compatible stable package set
- **THEN** the selector is `stable-1-2`
- **AND** the same protocol family remains `opentray-protocol`
- **AND** the tag does not mention `webview`, `lynx`, or another extension product name.

#### Scenario: Same-major earlier minors remain on the same compatibility family

- **GIVEN** packages are already published on `stable-1-0` and `stable-1-1`
- **WHEN** `stable-1-2` becomes current
- **THEN** the release law treats all three as members of the same major line
- **AND** the compatibility rule rejects only different majors, not earlier minors in the same major.

### Requirement: Release tooling SHALL derive protocol-line selectors from a single source of truth

The release tooling SHALL read the current protocol family and protocol-line version from `@opentray/spec` and generate the `npm dist-tag add` plan for every public workspace package in the compatible closure. The tooling SHALL not hardcode `1.0`, and it SHALL not invent extension-specific selector names. When the protocol line advances, the generated plan SHALL make the selector rewrite obvious to maintainers and AI-driven release agents.

#### Scenario: Planner emits the current line from source of truth

- **GIVEN** the current line in `@opentray/spec` is `1.2`
- **WHEN** a maintainer runs the protocol-line planner for channel `stable`
- **THEN** every public workspace package in the compatible closure is planned for `stable-1-2`
- **AND** the output does not mention a product-specific extension name.

#### Scenario: Selector rewrite is visible during line bump

- **GIVEN** the line has advanced from `1.1` to `1.2`
- **WHEN** the planner output is reviewed
- **THEN** the changed selector is visible as a line bump
- **AND** maintainers can update package selectors and release notes without guessing which package family moved.
