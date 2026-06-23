## ADDED Requirements

### Requirement: Badge extension SHALL be an honest capability-gated status atom

The badge capability SHALL live outside the kernel as `@opentray/ext-badge` plus platform-native package atoms. `opentray` and the broker SHALL remain generic and SHALL NOT own badge parsing, badge projection, or platform-specific status heuristics.

The extension SHALL expose a typed status contract for badge text/count, progress, overlay icon, and attention state. Every effect family SHALL be capability-gated at runtime. If the current platform cannot truthfully project a requested effect, the extension SHALL reject the request with a typed unsupported result rather than faking success.

#### Scenario: Badge command routes through the extension host

- **GIVEN** a tray-mounted client calls the badge facade
- **WHEN** the facade sends a badge update command
- **THEN** the client emits an extension-scoped frame for `ext-badge`
- **AND** the broker dispatches it through the generic extension host boundary
- **AND** the broker does not parse badge-specific payloads itself.

### Requirement: Badge extension SHALL expose a compact status API surface

The badge extension SHALL expose the following public operations: `setBadge`, `clearBadge`, `setProgress`, `setProgressState`, `setOverlayIcon`, `setAttention`, and `getCapabilities`. The contract MAY expose a single shared update command internally, but the public surface SHALL remain small and effect-oriented.

`getCapabilities` SHALL report, at minimum, whether badge text/count, progress, overlay icon, and attention are supported on the current runtime, and it SHALL separate native support from best-effort projection behavior.

#### Scenario: Capabilities describe real runtime support

- **GIVEN** a client inspects `getCapabilities()`
- **WHEN** the current runtime cannot support one of the requested effect families
- **THEN** the result reports that family as unsupported or reduced
- **AND** the client can choose a portable fallback intentionally.

### Requirement: Badge state SHALL remain source data, not a projection label

The durable badge facts SHALL be the current badge text/count, progress value and range, progress state, overlay icon, and attention flag. Dock/taskbar/tray badges, overlay glyphs, and attention highlights SHALL be treated as projections of those facts, not as the facts themselves.

The extension SHALL not rewrite a visible projection back into badge source data unless the client explicitly issues a state-changing command.

#### Scenario: Projection does not become ontology

- **GIVEN** a platform renders a badge projection
- **WHEN** the projection changes because of a native shell update
- **THEN** the extension does not silently overwrite the badge source record
- **AND** only a client command may change the durable badge state.

### Requirement: Badge support SHALL be platform-specific and truth-preserving

The badge extension SHALL support the following substrate truth:

- macOS SHALL support badge text/count natively and MAY support additional projection through a native Dock surface when available.
- Windows SHALL support progress and overlay icon projection through the taskbar substrate, and MAY support badge-adjacent status projection where the native shell allows it.
- Linux SHALL expose only the status families that the active desktop shell can actually project through the current backend. If a requested badge family has no native substrate, the extension SHALL reject it as unsupported or reduced.

The extension SHALL not claim Linux parity for badge/progress/overlay behavior unless the backend proves it through a real desktop substrate.

#### Scenario: Linux stays honest about missing primitives

- **GIVEN** the active Linux backend cannot provide a native badge count or progress projection
- **WHEN** the client requests that unsupported family
- **THEN** the extension returns a typed unsupported result
- **AND** it does not fake a native badge or progress surface.

### Requirement: Badge operations SHALL be asynchronous and capability-gated

Every badge operation SHALL return a promise. The extension SHALL validate the request, check platform support, and resolve or reject with typed results. Unsupported badge text, progress, overlay, or attention behavior SHALL reject explicitly instead of no-oping silently.

#### Scenario: Unsupported family rejects explicitly

- **GIVEN** a client calls `setProgressState("paused")`
- **WHEN** the current platform cannot represent paused progress truthfully
- **THEN** the promise rejects with a typed unsupported error
- **AND** the runtime does not claim the operation succeeded.

### Requirement: Badge debug evidence SHALL be observable through the extension contract

The badge extension SHALL be testable through visible contract-level evidence on every supported platform. The contract SHALL expose enough capability metadata for a debug panel or test harness to show what the current runtime can project, what it reduces, and what it rejects.

#### Scenario: Debug tooling can inspect the capability matrix

- **GIVEN** a debug harness queries badge capabilities
- **WHEN** it renders the response
- **THEN** it can show which effect families are native, reduced, or unsupported
- **AND** the output is derived from the extension contract rather than hand-written platform assumptions.
