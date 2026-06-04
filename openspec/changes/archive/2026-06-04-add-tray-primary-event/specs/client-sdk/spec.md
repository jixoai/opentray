## ADDED Requirements

### Requirement: Tray menu items SHALL support a primary event role

The public TypeScript protocol SHALL allow a plain menu button item to declare `primaryEvent: true`. A primary item SHALL remain a normal `type: "item"` menu entry: it SHALL still render as a native menu item where the backend shows menus, and choosing it from the menu SHALL emit the same `menuClick` event as before.

The primary role SHALL be additive. Existing menu items without `primaryEvent` SHALL keep their existing behavior. Check, radio, separator, and submenu container items SHALL NOT become primary targets in this change.

#### Scenario: Developer declares a primary menu item

- **GIVEN** a developer creates a tray menu with a plain item `{ type: "item", id: 8, title: "Show Window", primaryEvent: true }`
- **WHEN** TypeScript code type-checks the menu declaration
- **THEN** the declaration is accepted by the public `MenuItem` type
- **AND** the item still has the normal menu item fields such as `id`, `title`, `enabled`, and `shortcut`.

#### Scenario: Primary item still emits menuClick

- **GIVEN** a primary menu item has id `8`
- **WHEN** the native backend activates the primary action
- **THEN** the client receives an `event` frame whose event is `menuClick`
- **AND** the event carries the same `itemId: 8` used by normal menu selection.
