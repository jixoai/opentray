# client-sdk Specification Delta

## ADDED Requirements

### Requirement: v0.9 SDK SHALL remove previous public compatibility surfaces

The v0.9 public SDK SHALL be a breaking tray-first API. It SHALL remove `createSpace`, `resolveDefaultSpace`, `createSurface`, `SpaceOptions`, `SpaceRef`, `SurfaceOptions`, `SurfaceRef`, top-level tray `title`, and public `spaceId`-based creation or routing from the public TypeScript entrypoint. Removed public concepts SHALL NOT remain as deprecated aliases.

The v0.9 protocol-facing SDK SHALL reject or fail to type-check old public input shapes rather than translating them into the new tray-first shape. Compatibility glue is forbidden for this change.

#### Scenario: Removed createSpace API is not exported

- **GIVEN** a developer imports from the v0.9 `opentray` package
- **WHEN** they inspect the public exports
- **THEN** `createSpace`, `resolveDefaultSpace`, and `createSurface` are absent
- **AND** `createTray` is the public creation entrypoint.

#### Scenario: Removed tray title field is rejected

- **GIVEN** a caller invokes v0.9 `createTray` with top-level `title`
- **WHEN** the TypeScript compiler or runtime validator evaluates the input
- **THEN** the old shape is rejected
- **AND** the caller must put visible tray text in `icon`.

### Requirement: Public tray creation SHALL use a unified icon projection field

The public v0.9 `createTray` API SHALL expose one `icon` field for tray visual projection. The API SHALL NOT introduce a separate `icons`, `display`, `appearance`, or `presentation` field for the same concern.

The existing single-image icon payload SHALL be renamed at the type level from `Icon` to `IconImage`. The public `Icon` contract SHALL represent the unified tray projection input: image-only candidates, text-only candidates, icon-with-text candidates, and simple fallback material carried through the same `icon` field.

The intended TypeScript shape SHALL preserve the user's intersection-style compression:

```ts
type IconImage =
  | { type: "rgba"; data: Uint8Array | number[]; width: number; height: number }
  | { type: "encoded"; data: Uint8Array | number[] }
  | { type: "file"; path: string };

type Icons = {
  "icon-only"?: IconImage;
  "text-only"?: string;
  "icon-text"?: IconImage & { text: string };
};

type SimpleIcon = IconImage & { text?: string };

type Icon = Icons & SimpleIcon;
```

`Icons` SHALL remain a pure explicit-candidate map. It SHALL NOT contain a generic `text` field. Generic fallback text belongs to `SimpleIcon.text`, so fallback image and fallback text share one simple icon atom.

Implementation MAY refine the exact TypeScript expression if plain `Icons & SimpleIcon` prevents valid candidate-only values, but it MUST preserve the public contract: one `icon` field, `IconImage` as the image atom, `SimpleIcon` as fallback material, and the responsive candidate map as part of `Icon` rather than a sibling field.

#### Scenario: Simple icon remains low ceremony

- **GIVEN** a caller invokes `createTray` with `icon` set to a plain image payload
- **WHEN** the SDK serializes the tray options
- **THEN** the image payload is treated as the fallback icon image
- **AND** the caller does not need to write a separate candidate map.

#### Scenario: Responsive icon candidates use the icon field

- **GIVEN** a caller invokes `createTray` with `icon["icon-only"]`, `icon["text-only"]`, `icon["icon-text"]`, or `SimpleIcon` fallback fields
- **WHEN** the SDK and broker evaluate tray display options
- **THEN** those candidates are read from `icon`
- **AND** no separate `icons`, `display`, `appearance`, or `presentation` option is required.

### Requirement: Icon candidate selection SHALL prefer explicit only modes before fallback

The tray projection resolver SHALL derive display candidates from `icon` using deterministic order. It SHALL inspect the following candidate sources:

1. `icon["icon-text"]` as the icon-with-text candidate.
2. `icon["icon-only"]` as the explicit icon-only candidate.
3. `icon["text-only"]` as the explicit text-only candidate.
4. `SimpleIcon` fallback fields picked from `icon`, including `type`, `data`, `path`, `width`, `height`, and optional `text`, as fallback material.

When choosing the effective projection for a platform, explicit only-mode candidates SHALL have highest priority for their matching mode because they are authored as "only" projections. The effective priority SHALL be:

```text
icon-only
text-only
icon-text
fallback
```

The fallback candidate SHALL be computed from `SimpleIcon` fields when present; if those fields are absent, fallback MAY use `icon-text`, then `icon-only`, then `text-only` so explicitly authored candidates can still degrade to another platform-supported mode.

#### Scenario: Explicit icon-only wins for icon-only platforms

- **GIVEN** `icon["icon-only"]` is present
- **AND** the selected platform projection mode is icon-only
- **WHEN** the resolver selects the tray projection
- **THEN** it uses `icon["icon-only"]` before any generic top-level fallback image
- **AND** it does not synthesize an icon from text.

#### Scenario: Explicit text-only wins for text-only platforms

- **GIVEN** `icon["text-only"]` is present
- **AND** the selected platform projection mode is text-only
- **WHEN** the resolver selects the tray projection
- **THEN** it uses `icon["text-only"]` before `icon["icon-text"].text` or `SimpleIcon.text`
- **AND** it does not require an image payload.

#### Scenario: Icon-text is used before generic fallback when only modes do not apply

- **GIVEN** `icon["icon-text"]` is present
- **AND** no applicable `icon-only` or `text-only` projection is selected
- **WHEN** the resolver needs an icon-with-text projection
- **THEN** it uses `icon["icon-text"]`
- **AND** the candidate's `text` belongs to the icon projection rather than to a separate `title` ontology.

#### Scenario: Explicit candidates can still provide fallback

- **GIVEN** no `SimpleIcon` image fields are present on `icon`
- **AND** one or more explicit candidates are present
- **WHEN** the resolver computes fallback material
- **THEN** it MAY fall back through `icon-text`, `icon-only`, and `text-only` in that order
- **AND** it MUST preserve the rule that only-mode candidates win for their own projection modes.

### Requirement: Tray visible text SHALL live in icon projection

Tray text that participates in visible tray projection SHALL belong to `SimpleIcon.text`, `icon["text-only"]`, or `icon["icon-text"].text`. The v0.9 `createTray` input SHALL NOT accept top-level `title` as a second source for visible tray text.

If a future API needs a separate human-readable name, window title, diagnostics label, or accessibility label, it SHALL use a field whose name describes that role. It SHALL NOT reuse `title` as a competing tray display text source.

#### Scenario: Top-level title is rejected as tray display text

- **GIVEN** a caller invokes v0.9 `createTray` with a top-level `title`
- **WHEN** the tray projection is resolved
- **THEN** the input is rejected by type checking or runtime validation
- **AND** the caller is directed to use `icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`.

#### Scenario: Icon text is the only visible text source

- **GIVEN** a caller provides `icon["icon-text"].text`
- **WHEN** the backend selects an icon-text projection
- **THEN** that text is the visible tray text
- **AND** no top-level `title` can override or shadow it.

### Requirement: SDK tray handles SHALL bind to runtime host and not a public daemon concept

The public SDK SHALL treat transport and lifecycle as host binding concerns. It SHALL not require callers to understand daemon mode, broker mode, or surface/space ownership in order to create, extend, or destroy a tray. The public TypeScript surface SHALL operate through tray handles and runtime-host-bound transport, not a public daemon object.

#### Scenario: Tray creation stays host-bound

- **GIVEN** a developer imports from the v0.9 `opentray` package
- **WHEN** they create a tray
- **THEN** the returned handle is bound to the current runtime host context
- **AND** the caller does not need to create or manage a public daemon object first.
