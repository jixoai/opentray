# create-workbench-shell Specification

## Purpose
TBD - created by archiving change redesign-create-opentray-webui. Update Purpose after archive.
## Requirements
### Requirement: Workbench SHALL expose stable task routes

The WebUI SHALL render a persistent application shell with primary routes for Add, Applications, and Help Center. Add SHALL be the default route for the root wizard URL. Route state SHALL be deep-linkable within the token-guarded session, preserve browser history, and restore the selected route without resetting unrelated live Core session state.

On desktop the primary navigation SHALL occupy the logical start edge; on narrow viewports it SHALL become an accessible temporary navigation surface without covering active controls or trapping content. Arabic RTL SHALL mirror the navigation to the right while preserving semantic order.

#### Scenario: Root opens the actual creation workflow

- **GIVEN** a valid WebUI session URL without a route selection
- **WHEN** the workbench loads
- **THEN** Add SHALL be active and its creation controls SHALL be usable in the first viewport
- **AND** no marketing/landing interstitial SHALL block the task

### Requirement: Navigation SHALL carry product identity and utility controls

The supplied create-opentray logo SHALL be promoted to a stable WebUI-owned asset and displayed as a clear first-viewport product identity signal without becoming an oversized hero. Language and theme controls SHALL live in the navigation utility area near the bottom on desktop and in the equivalent stable area on mobile. Every icon-only navigation/control button SHALL have an accessible name and tooltip when its meaning is not universally obvious.

#### Scenario: Collapsed navigation remains understandable

- **GIVEN** the navigation is in an icon-only or mobile state
- **WHEN** keyboard or pointer focus reaches Add, Applications, Help, language, or theme controls
- **THEN** each control SHALL expose a localized accessible name
- **AND** an unfamiliar icon SHALL have a discoverable tooltip

### Requirement: Locale state SHALL support nine language families and direction

The WebUI SHALL provide localized interface and human-help content for `zh-CN`, `ja`, `ko`, `en`, `ar`, `fr`, `es`, `de`, and `ru`. Initial locale SHALL follow a persisted explicit choice, otherwise the closest supported system locale, otherwise English. Changing locale SHALL update visible chrome, validation, status, destructive copy, document language, and direction without reloading or losing form/session state.

Arabic SHALL set document and Base UI direction to RTL. Technical islands including argv, terminal content, URLs, filesystem paths, code blocks, JSON, and shell/PowerShell previews SHALL remain explicitly LTR with safe bidi isolation.

#### Scenario: Arabic mirrors shell but preserves commands

- **GIVEN** a populated Add form and Arabic selected
- **WHEN** locale changes from an LTR language
- **THEN** navigation, overlays, directional icons, list-detail geometry, and focus traversal SHALL project RTL
- **AND** command arguments, URLs, paths, and code SHALL remain LTR and visually unambiguous

### Requirement: Theme SHALL support system, light, and dark without state loss

The theme control SHALL offer exactly system, light, and dark. An explicit choice SHALL persist. System mode SHALL respond live to operating-system color-scheme changes. Initial theme resolution SHALL occur before first painted application content to avoid a wrong-theme flash. Both themes SHALL define complete semantic colors for surfaces, text, controls, focus, selection, disabled, loading, info, warning, success, and destructive states.

#### Scenario: System theme changes live

- **GIVEN** theme mode system and a populated unsaved form
- **WHEN** the operating system changes color scheme
- **THEN** the workbench SHALL apply the matching semantic theme without reload
- **AND** form, route, terminal, and selection state SHALL remain unchanged

### Requirement: Shell transitions SHALL preserve task continuity

Route, navigation, list insertion/removal, and responsive shell transitions MAY animate only to communicate state and spatial continuity. Motion SHALL complete quickly, remain interruptible, avoid layout-thrashing properties, and honor reduced-motion with instant or crossfade behavior. Content SHALL never be hidden pending an animation trigger.

#### Scenario: Reduced motion removes spatial choreography

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** navigation or route state changes
- **THEN** the destination SHALL become usable immediately
- **AND** no sliding, scaling, or stagger sequence SHALL be required to reveal content

