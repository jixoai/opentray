## MODIFIED Requirements

### Requirement: Broker daemon SHALL route native events to owning sessions

The daemon SHALL receive native backend events, route them through the kernel, and write resulting event frames only to the session that owns the matching authority. Backend-originated menu events SHALL use space, tray, and item identifiers, not menu item id alone.

Primary tray-icon activation SHALL follow the same rule. When the selected backend maps a tray icon click to a primary menu item, the daemon SHALL route the resulting `menuClick` through the kernel and SHALL send the event only to the owning session.

#### Scenario: Menu click reaches owning session

- **GIVEN** a visible tray was created by client session `session-a`
- **WHEN** the user clicks a menu item for that tray
- **THEN** the daemon routes the event through the kernel
- **AND** only the connection for `session-a` receives the `event` frame.

#### Scenario: Primary tray activation reaches owning session

- **GIVEN** a visible tray was created by client session `session-a`
- **AND** its menu declares item `8` as `primaryEvent`
- **WHEN** the native backend maps a tray icon click to that primary item
- **THEN** the daemon routes `menuClick { itemId: 8 }` through the kernel
- **AND** only `session-a` receives the `event` frame.

#### Scenario: Unknown native event does not broadcast

- **GIVEN** the native backend emits an event for an unknown space or tray
- **WHEN** the daemon routes that event
- **THEN** no client receives a misleading event
- **AND** the daemon may emit a structured diagnostic.
