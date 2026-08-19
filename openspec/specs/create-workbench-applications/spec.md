# create-workbench-applications Specification

## Purpose
TBD - created by archiving change redesign-create-opentray-webui. Update Purpose after archive.
## Requirements
### Requirement: Applications SHALL project the fixed v1 registry

The Applications route SHALL request Core registration records under `~/.opentray/create/*` and render healthy, running, invalid-config, incompatible-version, missing-payload, and broken-link v1 states truthfully. It SHALL provide complete never-loaded/loading/empty/loaded/updating/error-with-data states and SHALL not hide last-known data during refresh errors. Legacy directories without `create-opentray.json v1` SHALL not appear.

#### Scenario: Refresh error preserves known applications

- **GIVEN** a loaded application list
- **WHEN** a later refresh fails
- **THEN** existing rows/items SHALL remain available with a visible stale/error state
- **AND** repeated refresh actions SHALL lock while pending

### Requirement: Edit SHALL reuse Add with frozen identity and Core planning

Editing an application SHALL navigate to the Add work surface populated from its v1 desired state. `appId` SHALL be read-only, edit mode SHALL be explicit, and verified payload replacement SHALL start with force enabled as requested. Before mutation the UI SHALL show the Core plan, resolved registration/payload paths, process action, and warnings. An identity change SHALL be offered only as copy/create-new, never hidden inside edit.

#### Scenario: Edit round-trips every v1 field

- **GIVEN** a healthy registration using independent icons, smoothing disabled, developer mode enabled, command env, and shell/window options
- **WHEN** Edit opens and the user makes no changes
- **THEN** every value SHALL be represented accurately
- **AND** the resulting normalized Core plan SHALL not reset an omitted field

### Requirement: Running updates SHALL require explicit stop and restart choices

When Core returns `app_running`, the UI SHALL explain the verified running owner and offer an explicit stop-then-continue action. Restart after successful Apply SHALL be a separate selected choice. The UI SHALL not kill by display name, appId, or stale PID and SHALL preserve the user's edited form if ownership cannot be verified.

#### Scenario: Ownership failure leaves edits intact

- **GIVEN** an edited running application whose PID/token can no longer be verified
- **WHEN** the user chooses stop-then-continue
- **THEN** Apply SHALL remain blocked with actionable ownership evidence
- **AND** unsaved edited desired state SHALL remain available

### Requirement: Uninstall SHALL expose unlink and purge as different actions

Applications SHALL offer uninstall for v1 registrations. Destructive confirmation SHALL display application identity, registration path, payload/link path, resolved external target when present, running state, and the exact default effect. A linked target SHALL default to retain; purge-target SHALL be a separate stronger action. Completion SHALL state what was removed, what was retained, and that macOS Dock/Windows taskbar pins require manual user cleanup.

#### Scenario: Linked target retention is unmistakable

- **GIVEN** an application whose payload is external
- **WHEN** the ordinary uninstall confirmation opens
- **THEN** retain-external-target SHALL be the default and primary described behavior
- **AND** purge-target SHALL not be preselected or visually conflated with unlink

### Requirement: Application list actions SHALL remain efficient and accessible

Each application item SHALL expose a predictable primary edit action and a compact secondary action menu for copy/export/uninstall/open-location where supported. Status, identity, app name, payload location, and running health SHALL be scannable without decorative card nesting. List insertions/removals MAY animate for continuity and SHALL restore focus to a logical neighbor after deletion.

#### Scenario: Keyboard uninstall restores list focus

- **GIVEN** a keyboard user uninstalls one application from a populated list
- **WHEN** confirmation succeeds and the row/item is removed
- **THEN** focus SHALL move to the next logical application or list heading
- **AND** the result announcement SHALL include retained/deleted path facts

