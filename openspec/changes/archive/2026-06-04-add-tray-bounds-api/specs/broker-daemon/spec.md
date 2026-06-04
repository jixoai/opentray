## MODIFIED Requirements

### Requirement: Broker daemon SHALL route native events to owning sessions

The daemon SHALL receive native backend events, route them through the kernel, and write resulting event frames only to the session that owns the matching authority. Backend-originated menu events SHALL use space, tray, and item identifiers, not menu item id alone.

The daemon SHALL also route trusted tray capability requests such as tray-bounds lookup through the kernel ownership path. A tray-bounds response SHALL be request-correlated and SHALL resolve only for the session that owns the named tray.

#### Scenario: Menu click reaches owning session

- **GIVEN** a visible tray was created by client session `session-a`
- **WHEN** the user clicks a menu item for that tray
- **THEN** the daemon routes the event through the kernel
- **AND** only the connection for `session-a` receives the `event` frame.

#### Scenario: Tray-bounds request stays session-owned

- **GIVEN** a visible tray was created by client session `session-a`
- **WHEN** `session-a` requests bounds for that tray
- **THEN** the daemon routes the request through the kernel ownership path
- **AND** only `session-a` receives the correlated tray-bounds response.

#### Scenario: Unknown native event does not broadcast

- **GIVEN** the native backend emits an event for an unknown space or tray
- **WHEN** the daemon routes that event
- **THEN** no client receives a misleading event
- **AND** the daemon may emit a structured diagnostic.
