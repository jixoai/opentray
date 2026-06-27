# backend-adapters Specification Delta

## MODIFIED Requirements

### Requirement: Backend adapters SHALL implement a shared AppBackend contract

The system SHALL define a platform-agnostic tray backend contract for physical tray operations. The contract SHALL cover tray materialization, icon projection updates, tooltip updates, menu projection updates, visibility, menu display where supported, backend-originated events, and tray placement retrieval where supported. Tray placement SHALL be keyed by the durable app/tray identity tuple for the single caller session, not by a shared surface id.

Unsupported tray placement SHALL remain explicit as capability absence or an unavailable result path. The contract MUST NOT fabricate a tray rectangle for an unrelated tray contribution.

#### Scenario: Capability absence is visible

- **GIVEN** a backend cannot return a usable tray placement for a named tray
- **WHEN** the kernel or extension asks for that tray's placement
- **THEN** the backend reports that the capability is unavailable
- **AND** the broker projection preserves that absence through an unavailable tray result instead of fake certainty.

#### Scenario: Tray placement is resolved per tray identity

- **GIVEN** one app runtime contains more than one tray contribution
- **WHEN** the backend is asked for placement of one named tray
- **THEN** it resolves placement for that tray identity
- **AND** it does not return an ambiguous runtime-wide rect.

## ADDED Requirements

### Requirement: Backend selection SHALL apply app-owned tray projections

The runtime host composition layer SHALL own backend selection and SHALL apply app-owned tray projections emitted by the kernel to the selected backend. The runtime host SHALL NOT expose concrete backend handles, `tray-icon` types, `ksni` types, or native event-loop types through public TypeScript APIs or `opentray-core`.

#### Scenario: Host tray creation reaches physical backend

- **GIVEN** the host is running with a selected backend
- **AND** an accepted client creates a tray
- **WHEN** the kernel syncs the app-owned tray projection
- **THEN** the selected backend receives the projection
- **AND** a supported desktop platform creates or updates the visible tray state.

### Requirement: Tray presentation SHALL be selected from explicit candidate shapes

The tray projection MAY provide explicit icon candidates for the same tray atom. The backend SHALL choose the first supported candidate according to platform capability and SHALL preserve explicit absence when no candidate is supported. Visible tray text SHALL come from the selected icon projection text, such as `SimpleIcon.text`, `icon["text-only"]`, or `icon["icon-text"].text`. `tooltip` SHALL mean hover or accessibility text. If a candidate contains both image and text, the backend SHALL use both only when the platform can render both without ambiguity.

#### Scenario: Platform chooses the best supported presentation

- **GIVEN** a tray projection provides both an icon-bearing candidate and a text-only candidate
- **WHEN** the backend evaluates the projection on a platform that supports both
- **THEN** it selects the higher-fidelity supported candidate
- **AND** it does not invent a shared space fallback.

#### Scenario: Tooltip remains hover text

- **GIVEN** a tray projection includes a tooltip
- **WHEN** the user hovers the tray or assistive tech queries it
- **THEN** the backend uses the tooltip as hover description
- **AND** it does not reinterpret it as the visible tray label.
