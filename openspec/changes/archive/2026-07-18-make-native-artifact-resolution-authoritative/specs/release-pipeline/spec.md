## ADDED Requirements

### Requirement: Native release artifacts SHALL embed the published artifact-set identity

Every official native extension build SHALL embed the owning facade package version, extension contract fingerprint, target, and CI/source build identity in the dynamic library manifest. Every broker build SHALL expose a deterministic executable identity at runtime. Release staging SHALL preserve these identities when copying artifacts into platform package atoms.

#### Scenario: Facade and packed platform extension agree

- **GIVEN** release CI builds and stages an official extension family
- **WHEN** the facade and platform package tarballs are inspected
- **THEN** the facade descriptor's expected artifact-set version and contract fingerprint equal the dynamic library's embedded manifest
- **AND** the native target equals the platform package `os` and `cpu` metadata.

#### Scenario: Wrong binary in correctly versioned package fails release verification

- **GIVEN** a platform package manifest has the current npm version
- **AND** its staged dynamic library embeds an older artifact-set identity
- **WHEN** release verification runs
- **THEN** verification fails before publish
- **AND** package metadata alone cannot mask the stale binary.

### Requirement: Consumer install verification SHALL cover package-manager artifact authority

The release gate SHALL build temporary consumers from real packed tarballs and install them using supported package-manager topologies. At minimum it SHALL cover npm-compatible flat resolution and pnpm isolated resolution. The pnpm fixture SHALL include an unmanaged older top-level platform package while the current package remains in the facade dependency closure.

#### Scenario: Packed pnpm consumer ignores orphan platform package

- **GIVEN** current facade and platform tarballs are installed in a temporary pnpm consumer
- **AND** an older same-named platform package exists at the consumer root
- **WHEN** the consumer resolves and loads the extension through the public SDK
- **THEN** it selects the current facade-relative artifact
- **AND** verifies its embedded identity
- **AND** requires no artifact environment override.

#### Scenario: Packed npm consumer resolves one coherent closure

- **GIVEN** current tarballs are installed in a clean npm-compatible consumer
- **WHEN** it starts the broker and resolves an official extension
- **THEN** broker and extension artifact identities match the installed package closure
- **AND** the consumer requires no repository checkout or source build.
