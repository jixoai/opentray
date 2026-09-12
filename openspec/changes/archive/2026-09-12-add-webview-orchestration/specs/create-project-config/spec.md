## MODIFIED Requirements

### Requirement: Window behavior options SHALL carry durable sync and toolbar defaults

The v1 `window` object SHALL accept optional `toolbar` (both URL and command applications: host the navigation toolbar), `titleFollowsDocument` (default true — the window title follows the target page's `document.title`, document→window one-way; in toolbar mode the followed document is the content webview's), and `iconFollowsDocument` (default false — runtime favicon→window-icon following is opt-in). These are desired-state facts: they round-trip through edit/export and are projected into the generated window's `titleSync`/`iconSync` options and multi-webview toolbar composition.

#### Scenario: Title follows, icon does not, by default

- **GIVEN** a URL application created without sync flags
- **WHEN** its config is parsed
- **THEN** `titleFollowsDocument` SHALL default to true and `iconFollowsDocument` to false
- **AND** an export invocation SHALL reproduce any explicit deviation from those defaults
