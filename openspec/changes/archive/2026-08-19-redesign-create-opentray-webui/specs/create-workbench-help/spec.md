## ADDED Requirements

### Requirement: Help Center SHALL be a read-only Markdown list-detail browser

The Help route SHALL present one logical Skill-shaped human documentation tree as a list/detail surface. The list SHALL expose relative files/directories; the detail SHALL render the selected Markdown file. Initial entry SHALL select `SKILL.md`. Selection SHALL be addressable in route state, keyboard navigable, and retained when moving between responsive list/detail presentations.

On wide viewports list and detail SHALL coexist without nested cards. On narrow viewports selection SHALL transition from list to detail with an obvious back action and restored list focus/scroll position.

#### Scenario: Help opens on SKILL.md

- **GIVEN** no help document selection
- **WHEN** Help Center opens
- **THEN** the logical tree SHALL be visible
- **AND** detail SHALL render localized human `SKILL.md` content

### Requirement: Human help SHALL explain product mechanics and command use

The human documentation SHALL explain OpenTray's App/Tray/Session and extension model, how create-opentray observes a command and materializes a registered app, the v1 registry/config/payload model, WebUI workflows, and the stable `web`, non-interactive `create`, `app`, and English AI `skill` CLI commands. Destructive, linked-target, Windows, Dock/taskbar, developer-mode, icon-source, smoothing, and env-export limitations SHALL be stated where users make those decisions.

#### Scenario: Help distinguishes human and AI surfaces

- **GIVEN** a user reading the WebUI help for `skill`
- **WHEN** the page explains CLI help access
- **THEN** it SHALL state that packaged Skill content is English and AI-facing
- **AND** SHALL not imply WebUI translations are returned by `skill read`

### Requirement: WebUI SHALL own targeted human localizations

Help documents SHALL provide targeted human-readable content for all supported WebUI locales. They MAY reorganize or rephrase material for readers and SHALL not be stored as localized files inside the canonical English AI Skill. Stable logical document identifiers/paths SHALL let route selection survive locale changes; a locale switch SHALL select the corresponding human document without exposing storage paths.

#### Scenario: Locale switch preserves logical document

- **GIVEN** a user viewing a nested help document in French
- **WHEN** they switch to Japanese
- **THEN** Help SHALL render the Japanese projection of the same logical document when present
- **AND** return to `SKILL.md` with a clear notice only if that logical document has no valid projection

### Requirement: Markdown rendering SHALL be contained and accessible

The Help server/browser boundary SHALL resolve only allowlisted packaged human-help files and reject absolute, traversal, and link-escape paths. Markdown rendering SHALL sanitize unsafe HTML/URLs, preserve heading hierarchy, accessible links/tables/images, and LTR bidi isolation for code/commands/paths. External links SHALL be visibly external and opening behavior SHALL not grant native API trust to their content.

#### Scenario: Malicious Markdown cannot execute

- **GIVEN** a help document containing script HTML, event-handler attributes, traversal image URLs, or unsafe schemes
- **WHEN** detail renders it
- **THEN** unsafe content SHALL be removed or inert
- **AND** no request SHALL escape the packaged help root

### Requirement: Help loading SHALL preserve all lifecycle states

The list and detail SHALL distinguish never loaded, loading, empty, loaded, refreshing, missing, unsupported locale, and error states. Loading SHALL use stable skeleton geometry; an error fetching another document SHALL not blank the currently readable document. Retry controls SHALL lock while pending.

#### Scenario: Failed selection preserves readable content

- **GIVEN** one document is rendered successfully
- **WHEN** a second document fails to load
- **THEN** the first document SHALL remain readable with an inline selection error
- **AND** focus SHALL move to or announce the error without resetting the tree

