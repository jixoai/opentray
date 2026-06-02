## ADDED Requirements

### Requirement: Daemon health SHALL report public session state

The daemon health command SHALL report the running broker process using public `Session` vocabulary. The output SHALL include daemon PID, package version, protocol version, endpoint identity, active session count, and per-session state. Internal lease identifiers MAY be included only as diagnostic implementation details when clearly labeled and not required by public API consumers.

#### Scenario: Health output identifies active sessions

- **GIVEN** a same-version daemon is running
- **AND** one or more clients are connected
- **WHEN** the operator runs `opentray daemon health`
- **THEN** the output includes the daemon PID
- **AND** it reports active sessions
- **AND** it does not describe the primary public connection list as leases.

#### Scenario: Health output remains useful during alpha migration

- **GIVEN** the implementation still uses an internal lease id
- **WHEN** health output includes that id for debugging
- **THEN** it labels it as an internal or compatibility diagnostic
- **AND** the stable public lifecycle field remains session-oriented.

## MODIFIED Requirements

### Requirement: Broker daemon SHALL clean session-owned state on disconnect

When a client transport disconnects or exits after receiving an accepted session, the broker SHALL close that session through the kernel. Cleanup SHALL remove only trays and extension state owned by that session and SHALL resync affected backend projections.

#### Scenario: Disconnect closes only owned session

- **GIVEN** two client sessions have trays on the same space
- **WHEN** one client disconnects
- **THEN** the broker closes only that client's session
- **AND** trays owned by the other session remain mounted.

#### Scenario: Extension cleanup follows session ownership

- **GIVEN** a client session loaded an extension scoped to a space and tray
- **WHEN** that session disconnects
- **THEN** extension cleanup is invoked only for state owned by that session
- **AND** other sessions' extension state is not destroyed.

### Requirement: Broker daemon SHALL route native events to owning sessions

The daemon SHALL receive native backend events, route them through the kernel, and write resulting event frames only to the session that owns the matching authority. Backend-originated menu events SHALL use space, tray, and item identifiers, not menu item id alone.

#### Scenario: Menu click reaches owning session

- **GIVEN** a visible tray was created by client session `session-a`
- **WHEN** the user clicks a menu item for that tray
- **THEN** the daemon routes the event through the kernel
- **AND** only the connection for `session-a` receives the `event` frame.

#### Scenario: Unknown native event does not broadcast

- **GIVEN** the native backend emits an event for an unknown space or tray
- **WHEN** the daemon routes that event
- **THEN** no client receives a misleading event
- **AND** the daemon may emit a structured diagnostic.
