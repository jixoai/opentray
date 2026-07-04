# client-sdk Specification Delta

## MODIFIED Requirements

### Requirement: Public tray creation SHALL use a unified icon projection field

The public `createTray` API SHALL expose one `icon` field for tray visual projection. The API SHALL NOT introduce a separate `icons`, `display`, `appearance`, or `presentation` field for the same concern.

The existing single-image icon payload SHALL be named `IconImage`. The public `Icon` contract SHALL represent the unified tray projection input: generic image-only candidates, text-only candidates, generic icon-with-text candidates, OS-scoped image and icon-text candidates, and simple fallback material carried through the same `icon` field.

The intended TypeScript shape SHALL preserve the user's intersection-style compression:

```ts
type IconImage =
  | { type: "rgba"; data: Uint8Array | number[]; width: number; height: number }
  | { type: "encoded"; data: Uint8Array | number[] }
  | { type: "file"; path: string };

type DarwinIcon = IconImage & { isTemplate?: boolean };
type Win32Icon = IconImage;
type LinuxIcon = IconImage;
type IconText = IconImage & { text: string };
type DarwinIconText = DarwinIcon & { text: string };

type Icons = {
  "icon-only"?: IconImage;
  "text-only"?: string;
  "icon-text"?: IconText;
  "darwin-icon-only"?: DarwinIcon;
  "darwin-icon-text"?: DarwinIconText;
  "win32-icon-only"?: Win32Icon;
  "win32-icon-text"?: IconText;
  "linux-icon-only"?: LinuxIcon;
  "linux-icon-text"?: IconText;
};

type SimpleIcon = IconImage & { text?: string };

type Icon = Icons & Partial<SimpleIcon>;
```

`Icons` SHALL remain a pure explicit-candidate map. It SHALL NOT contain a generic `text` field. Generic fallback text belongs to `SimpleIcon.text`, so fallback image and fallback text share one simple icon atom. Darwin `isTemplate` SHALL be metadata only on Darwin candidates.

Implementation MAY refine the exact TypeScript expression if plain `Icons & SimpleIcon` prevents valid candidate-only values, but it MUST preserve the public contract: one `icon` field, `IconImage` as the image atom, `SimpleIcon` as fallback material, and generic plus OS-scoped candidate maps as part of `Icon` rather than a sibling field.

#### Scenario: Simple icon remains low ceremony

- **GIVEN** a caller invokes `createTray` with `icon` set to a plain image payload
- **WHEN** the SDK serializes the tray options
- **THEN** the image payload is treated as the fallback icon image
- **AND** the caller does not need to write a separate candidate map.

#### Scenario: Responsive icon candidates use the icon field

- **GIVEN** a caller invokes `createTray` with generic icon candidates, OS-scoped icon candidates, or `SimpleIcon` fallback fields
- **WHEN** the SDK and broker evaluate tray display options
- **THEN** those candidates are read from `icon`
- **AND** no separate `icons`, `display`, `appearance`, or `presentation` option is required.

#### Scenario: Darwin template metadata stays scoped to Darwin candidates

- **GIVEN** a caller provides `icon["darwin-icon-only"].isTemplate` or `icon["darwin-icon-text"].isTemplate`
- **WHEN** the public type contract accepts the icon
- **THEN** the template flag belongs to the Darwin candidate
- **AND** generic, Win32, and Linux candidates do not gain template-specific fields.

### Requirement: Public SDK SHALL export application-facing tray types

The `opentray` package SHALL re-export the common application-facing TypeScript types that callers need to author tray code without deriving shapes from runtime functions. At minimum, the public entrypoint SHALL provide `CreateTrayOptions`, `TrayIcon`, `TrayMenu`, `TrayTooltip`, `TrayEvent`, and `TrayBoundsResult`.

Application examples and consumer skills SHALL import these names from `opentray` or the source entrypoint used by repository-local examples. They SHALL NOT teach ordinary app code to derive SDK shapes with `Parameters<typeof createTray>` or import `@opentray/spec` directly for common tray options, icons, menus, tooltips, or events. Direct `@opentray/spec` imports remain valid for low-level protocol tooling and package-internal code.

#### Scenario: App code can name createTray options directly

- **GIVEN** an application imports `createTray` and `CreateTrayOptions` from `opentray`
- **WHEN** it declares its tray options before calling `createTray`
- **THEN** the public type is available without `typeof` inference
- **AND** the type describes the same first argument accepted by `createTray`.

#### Scenario: App code can name icon and menu atoms directly

- **GIVEN** an application exports a helper that builds a tray icon or menu
- **WHEN** it imports `TrayIcon` or `TrayMenu` from `opentray`
- **THEN** the helper can publish a stable application-facing type
- **AND** it does not need a direct `@opentray/spec` dependency for ordinary tray authoring.

### Requirement: Icon candidate selection SHALL prefer current-OS candidates before same-mode generic candidates

The tray projection resolver SHALL derive display candidates from `icon` using deterministic order. It SHALL inspect the following candidate sources:

1. Current-OS `icon["<os>-icon-only"]` and generic `icon["icon-only"]` as the effective icon-only candidate.
2. `icon["text-only"]` as the explicit text-only candidate.
3. Current-OS `icon["<os>-icon-text"]` and generic `icon["icon-text"]` as the effective icon-with-text candidate.
4. `SimpleIcon` fallback fields picked from `icon`, including `type`, `data`, `path`, `width`, `height`, and optional `text`, as fallback material.

When choosing the effective projection for a platform, explicit only-mode candidates SHALL have highest priority for their matching mode because they are authored as "only" projections. The effective priority SHALL be:

```text
effective icon-only
text-only
effective icon-text
fallback
```

The effective icon-only candidate SHALL use the current OS-specific key when present and otherwise use `icon["icon-only"]`. The effective icon-text candidate SHALL use the current OS-specific key when present and otherwise use `icon["icon-text"]`. OS-specific keys for other operating systems SHALL be ignored by the current platform resolver.

The fallback candidate SHALL be computed from `SimpleIcon` fields when present; if those fields are absent, fallback MAY use effective icon-text, effective icon-only, then text-only so explicitly authored candidates can still degrade to another platform-supported mode.

#### Scenario: Current OS icon-only shadows generic icon-only

- **GIVEN** `icon["darwin-icon-only"]` and `icon["icon-only"]` are present
- **AND** the selected platform is Darwin
- **WHEN** the resolver selects an icon-only projection
- **THEN** it uses `icon["darwin-icon-only"]`
- **AND** it does not read `icon["icon-only"]` for that mode.

#### Scenario: Non-current OS candidates do not shadow generic candidates

- **GIVEN** `icon["win32-icon-only"]` and `icon["icon-only"]` are present
- **AND** the selected platform is Darwin
- **WHEN** the resolver selects an icon-only projection
- **THEN** it ignores `icon["win32-icon-only"]`
- **AND** it may use `icon["icon-only"]`.

#### Scenario: Text-only remains OS independent

- **GIVEN** `icon["text-only"]` is present
- **AND** OS-specific image candidates are also present
- **WHEN** the selected platform projection mode is text-only
- **THEN** it uses `icon["text-only"]`
- **AND** no OS-specific text-only key is required.

#### Scenario: Darwin icon-text can carry template metadata and visible text

- **GIVEN** `icon["darwin-icon-text"]` has image data, `text`, and `isTemplate: true`
- **AND** the selected platform is Darwin
- **WHEN** the resolver selects icon-text projection
- **THEN** it uses the Darwin candidate image and text
- **AND** the template flag is preserved for the native Darwin tray backend.

#### Scenario: Explicit candidates can still provide fallback

- **GIVEN** no `SimpleIcon` image fields are present on `icon`
- **AND** one or more explicit candidates are present
- **WHEN** the resolver computes fallback material
- **THEN** it MAY fall back through effective icon-text, effective icon-only, and text-only in that order
- **AND** it MUST preserve the rule that only-mode candidates win for their own projection modes.
