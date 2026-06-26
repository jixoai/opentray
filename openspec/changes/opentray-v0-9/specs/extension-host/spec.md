# extension-host Specification Delta

## MODIFIED Requirements

### Requirement: Kernel SHALL provide an extension host contract scoped to a tray and app runtime

The kernel SHALL provide an extension host contract that loads, registers, commands, and unloads extension instances scoped to a tray and the owning app runtime. Extension instances SHALL communicate with the kernel only through host callbacks and extension command/event payloads keyed by app runtime identity and tray identity. `Space`, `surface`, and `Lease` SHALL not cross the public extension boundary as new concepts.

#### Scenario: Extension message stays tray scoped

- **GIVEN** an extension instance is attached to a tray
- **WHEN** it sends a message
- **THEN** the host scopes that message to the owning app runtime and tray
- **AND** the extension cannot mutate a sibling tray without an explicit host-authorized command.

#### Scenario: Extension boundary stays free of space terms

- **GIVEN** a developer inspects the public extension host API
- **WHEN** they read the type surface
- **THEN** they see tray and app runtime concepts
- **AND** they do not need to reason about `Surface` or `Space` to understand scope.

### Requirement: Extensions SHALL bind through the runtime host rather than a public daemon API

The extension host contract SHALL assume a runtime-host-bound app context. It SHALL not require a public daemon object or broker concept to exist in the developer API. The runtime host MAY still load native extension artifacts internally, but that is an implementation detail behind the tray/app runtime boundary.

#### Scenario: Extension loading does not expose daemon ownership

- **GIVEN** an application loads an extension
- **WHEN** the extension is mounted on a tray
- **THEN** the extension sees the tray/app runtime boundary
- **AND** it does not require a public daemon object to describe the host.
