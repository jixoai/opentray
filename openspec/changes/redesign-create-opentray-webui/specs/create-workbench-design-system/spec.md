## ADDED Requirements

### Requirement: Current shadcn Base UI SHALL be the sole primitive engine

Implementation SHALL refresh the local shadcn component sources from the current official registry and select the Base UI-backed component base with RTL enabled. Radix primitive runtime dependencies and Radix-specific component conventions SHALL be removed from the WebUI result. Base UI composition, presence/state attributes, portals/positioners, direction context, focus management, and typed part APIs SHALL be applied according to the current official migration contract.

The phrase "latest" SHALL be resolved and recorded at implementation time from official shadcn and Base UI sources; this spec SHALL not freeze a stale package number.

#### Scenario: No mixed primitive engine remains

- **GIVEN** the built WebUI dependency graph and local UI component sources
- **WHEN** the migration gate inspects them
- **THEN** interactive shadcn primitives SHALL use Base UI
- **AND** no `@radix-ui/react-*` runtime package or Radix-only `asChild`/state contract SHALL remain

### Requirement: Every existing and new control SHALL pass a semantic component audit

Before implementation, the WebUI SHALL inventory every interactive/display control across Add, terminal/service preview, Applications, Help, export, dialogs, and navigation. For each control the implementation record SHALL name its user job, current shape, chosen current shadcn/Base UI component or justified native/custom primitive, keyboard model, accessible name/error relation, loading/empty/error states, and RTL/theme behavior.

The audit SHALL prefer standard task components where they fit, including Sidebar/Sheet for navigation, AlertDialog for destructive confirmation, Field/Label/Input for form relationships, Select/Menu/ToggleGroup for option sets, Switch/Checkbox for booleans and acknowledgements, Slider for numeric icon scale, Tabs for view switching, ScrollArea/Resizable for bounded list-detail tools, Skeleton for loading, Tooltip for unfamiliar icon controls, and status/toast primitives for feedback. It SHALL NOT force content into decorative or nested cards merely to use a component.

#### Scenario: Bespoke control needs evidence

- **GIVEN** a custom interactive control that overlaps a current shadcn component
- **WHEN** the component audit is reviewed
- **THEN** it SHALL either migrate to the standard component
- **OR** record a concrete behavior/accessibility reason the standard component cannot satisfy

### Requirement: The workbench SHALL meet WCAG 2.2 AA interaction and contrast

All task routes SHALL be operable with keyboard only and expose logical landmarks, headings, names, roles, values, descriptions, validation, live progress, and results to assistive technology. Focus SHALL be visible and conserved through route changes, dialogs, async errors, list mutations, and destructive completion. Body/placeholder text SHALL reach at least 4.5:1 contrast; large text and non-text control boundaries/focus indicators SHALL meet applicable AA contrast. Color SHALL not be the only state signal.

#### Scenario: Keyboard completes create review

- **GIVEN** a screen-reader/keyboard user on Add
- **WHEN** they fill required fields, open advanced options, review the plan, acknowledge applicable risks, and start Apply
- **THEN** every control and error SHALL be reachable and named in logical order
- **AND** progress/result changes SHALL be announced without stealing focus unpredictably

### Requirement: Layout and type SHALL remain stable across content extremes

The workbench SHALL use a compact product typography scale, stable control dimensions, constrained prose measure, and responsive grid/flex/container rules rather than viewport-scaled type. Long German/Russian labels, Arabic RTL text, long unbroken paths, commands, URLs, application names, and Markdown headings SHALL wrap, truncate with accessible full text, or scroll in their appropriate technical container without overlapping controls or resizing fixed-format toolbars.

#### Scenario: Long localized content does not collide

- **GIVEN** the longest supported localized labels and a narrow supported viewport
- **WHEN** Add, Applications, Help, and dialogs render
- **THEN** no text SHALL overlap icons, neighboring controls, or subsequent content
- **AND** every truncated value SHALL remain accessible in full

### Requirement: Visual language SHALL remain restrained and task-focused

The redesign SHALL use product identity, semantic state, and hierarchy rather than decorative gradients, glass cards, nested cards, excessive rounding, one-hue palettes, or marketing composition. Light and dark themes SHALL use more than one neutral/state family while reserving accent for action, current selection, focus, and meaningful status. Repeated items MAY be framed; whole page sections SHALL remain structural rather than floating cards.

#### Scenario: Add remains denser than a landing page

- **GIVEN** the redesigned default route
- **WHEN** its first viewport is reviewed
- **THEN** command preview and application configuration SHALL dominate usable space
- **AND** no hero, feature explanation card, or decorative media SHALL displace the creation task

