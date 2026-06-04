## ADDED Requirements

### Requirement: Tray-icon backend SHALL route primary activation to a menu item

The tray-icon backend SHALL compile `primaryEvent: true` plain menu items into a primary activation route. The route SHALL resolve to the same `(spaceId, trayId, itemId)` tuple as the corresponding native menu item id. If more than one enabled item is marked primary, the backend SHALL use the first enabled primary item in menu traversal order and keep the rest as normal menu items.

Disabled primary items SHALL NOT become direct activation targets. If no enabled primary item exists, tray icon click behavior SHALL remain the backend's normal menu behavior.

#### Scenario: Projection records primary route

- **GIVEN** a tray menu contains a primary item with id `8`
- **WHEN** the tray-icon backend compiles the surface projection
- **THEN** the backend route table can resolve native primary activation for that tray icon to `TrayEvent::MenuClick`
- **AND** the event carries item id `8`.

#### Scenario: Disabled primary item is ignored

- **GIVEN** a tray menu contains `{ type: "item", id: 8, enabled: false, primaryEvent: true }`
- **WHEN** the backend compiles primary activation routes
- **THEN** that item is not used as the direct primary target
- **AND** normal menu projection still includes it as a disabled menu item.

### Requirement: Tray-icon native runtime SHALL map platform primary gestures conservatively

On platforms where the native tray runtime exposes tray icon click events, the tray-icon runtime SHALL use the primary route only for platform gestures that are intended to be direct activation:

- On Windows, an enabled primary item MAY disable menu-on-left-click so left-click activates the primary route while right-click can still show the menu.
- On macOS, multi-item menus SHALL keep normal menu-on-left-click behavior. If the menu has exactly one click-capable item and it is an enabled primary item, macOS SHALL avoid attaching native menu chrome to the status item so clicking the status item directly activates the primary route instead of opening a menu.
- On Linux, missing or backend-specific tray icon click support SHALL keep normal menu behavior rather than faking primary activation.

#### Scenario: Windows primary click can bypass menu

- **GIVEN** a Windows tray menu has an enabled primary item
- **WHEN** the user left-clicks the tray icon
- **THEN** the backend may route that tray click to the primary item
- **AND** the normal menu remains available through the platform context-menu gesture.

#### Scenario: macOS multi-item menu stays menu-first

- **GIVEN** a macOS tray menu has multiple click-capable items and one is primary
- **WHEN** the user clicks the status item
- **THEN** the native menu opens normally
- **AND** choosing the primary menu item emits the normal `menuClick`.

#### Scenario: macOS single primary item direct-triggers

- **GIVEN** a macOS tray menu has exactly one click-capable item
- **AND** that item is enabled and marked `primaryEvent: true`
- **WHEN** the user clicks the status item
- **THEN** the backend routes the click to that primary item without showing the menu
- **AND** the native runtime does not attach an `NSMenu` to that direct-primary status item.
