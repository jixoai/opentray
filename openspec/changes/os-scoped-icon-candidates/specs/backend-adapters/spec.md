# backend-adapters Specification Delta

## MODIFIED Requirements

### Requirement: Tray presentation SHALL be selected from explicit candidate shapes

The tray projection MAY provide explicit icon candidates for the same tray atom. The backend SHALL choose the first supported candidate according to platform capability, current-OS candidate filtering, and the public icon priority law. OS-scoped candidates SHALL be selected only when their OS key matches the current backend target; otherwise they SHALL be ignored in favor of matching generic candidates or fallback material. The backend SHALL preserve explicit absence when no candidate is supported.

Visible tray text SHALL come from the selected icon projection text, such as `SimpleIcon.text`, `icon["text-only"]`, generic `icon["icon-text"].text`, or current-OS `icon["<os>-icon-text"].text`. `tooltip` SHALL mean hover or accessibility text. If a candidate contains both image and text, the backend SHALL use both only when the platform can render both without ambiguity.

If no explicit visible icon/text survives projection, the native tray backend SHALL use the app projection title, derived from runtime `appName`, as final visible tray text. If the app projection title is blank or absent, it MAY use the app id. A fully transparent RGBA icon SHALL count as visually absent for this final text fallback, while missing files, unreadable files, and undecodable image bytes SHALL still fail honestly instead of being silently replaced.

Darwin candidate metadata such as `isTemplate` SHALL stay in the tray-icon backend projection/native adapter. It SHALL NOT become an `opentray-core` field and SHALL NOT require direct AppKit or objc2 logic in OpenTray shared layers.

#### Scenario: Platform chooses the best supported presentation

- **GIVEN** a tray projection provides both an icon-bearing candidate and a text-only candidate
- **WHEN** the backend evaluates the projection on a platform that supports both
- **THEN** it selects the higher-fidelity supported candidate
- **AND** it does not invent a shared space fallback.

#### Scenario: OS-specific candidate shadows only on the matching platform

- **GIVEN** a tray projection provides `darwin-icon-only`, `win32-icon-only`, and generic `icon-only`
- **WHEN** the tray-icon backend evaluates the projection on Darwin
- **THEN** it selects `darwin-icon-only`
- **AND** it ignores `win32-icon-only`.

#### Scenario: Darwin template stays a native adapter concern

- **GIVEN** the selected Darwin candidate has `isTemplate: true`
- **WHEN** the tray-icon backend builds the native status item
- **THEN** it applies the template flag through the native tray-icon adapter
- **AND** core projections remain platform-neutral app/tray/session facts.

#### Scenario: Missing icon falls back to app name text

- **GIVEN** an app projection has title `Status App`
- **AND** a tray projection has no icon
- **WHEN** the tray-icon backend evaluates the projection
- **THEN** it projects `Status App` as visible tray text
- **AND** it does not create a new core tray-title ontology.

#### Scenario: Transparent icon is visually absent

- **GIVEN** a tray projection contains an RGBA icon whose alpha bytes are all zero
- **AND** the app projection has title `Status App`
- **WHEN** the tray-icon backend evaluates the projection
- **THEN** it preserves the authored icon asset
- **AND** it also projects `Status App` as final visible tray text.

#### Scenario: Tooltip remains hover text

- **GIVEN** a tray projection includes a tooltip
- **WHEN** the user hovers the tray or assistive tech queries it
- **THEN** the backend uses the tooltip as hover description
- **AND** it does not reinterpret it as the visible tray label.
