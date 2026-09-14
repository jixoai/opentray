# kernel-runtime delta

## MODIFIED Requirements

### Requirement: Broker sessions SHALL dispatch client commands through Kernel authority

The broker runtime SHALL translate accepted client command frames into `opentray-core::Kernel` operations. Surface creation, tray creation, tray mutation, tray destruction, lease cleanup, extension commands, and backend-originated events SHALL use kernel ownership checks rather than reimplementing policy in the transport layer.

Extension command dispatch SHALL be scoped to the tray-owning session: the kernel SHALL reject an `ext-command` addressed to a tray owned by a different live session before any extension code runs. Extension event routing law is unchanged — pushed events route by ownership — but a foreign session can neither dispatch nor destroy through another session's tray.

#### Scenario: Create tray dispatches through kernel and backend projection

- **GIVEN** a client session has an accepted lease
- **AND** the session has created a surface
- **WHEN** the client sends `create-tray`
- **THEN** the broker calls the kernel with the session `leaseId`
- **AND** the kernel derives a `SurfaceProjection`
- **AND** the selected backend receives that projection.

#### Scenario: Command before init is rejected

- **GIVEN** a client connection has not completed compatible `init`
- **WHEN** it sends `create-surface`, `create-tray`, `set-tray-menu`, or `ext-command`
- **THEN** the broker returns a structured protocol error
- **AND** the kernel is not mutated.

#### Scenario: Extension command from a non-owning session is rejected before dispatch

- **GIVEN** session A owns a tray with a loaded extension
- **AND** session B owns a different tray
- **WHEN** session B sends `ext-command` addressing session A's tray
- **THEN** the kernel rejects the command with a session-mismatch error
- **AND** no extension code runs and neither session observes events from the dispatch
- **AND** the owning session's state — including any window session reachable through legacy commands — is untouched.

#### Scenario: Owner dispatch still routes events by ownership

- **GIVEN** session A owns a tray with a loaded push extension
- **WHEN** session A dispatches an extension command on its own tray
- **THEN** mirrored command events flow back to the dispatching session
- **AND** pushed events route to the owning session per the extension event routing law.
