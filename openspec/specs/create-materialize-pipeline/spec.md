# create-materialize-pipeline Specification

## Purpose
TBD - created by archiving change create-no-first-launch-force-terminal. Update Purpose after archive.

## Requirements

### Requirement: Generation SHALL complete without re-running the command

The create pipeline SHALL treat dependency installation as its final phase. It SHALL NOT spawn the generated entry, SHALL NOT run the recorded command, and SHALL NOT gate success on a ready marker, a service port, or a materialized Darwin bundle. The wizard's command-preview surface remains the sole pre-generation command validator.

#### Scenario: Install completion is success

- **GIVEN** a frozen wizard configuration whose dependencies install successfully
- **WHEN** the create pipeline finishes the install phase
- **THEN** generation SHALL report success immediately
- **AND** no child process running the recorded command SHALL exist

#### Scenario: No ready-marker wait exists

- **GIVEN** the generated entry is never spawned during generation
- **WHEN** a consumer inspects the pipeline phases
- **THEN** the step surface SHALL expose only scaffold, icon, and install
- **AND** no launch or bundle step SHALL exist

### Requirement: Open-app SHALL cold-start through the entry when no bundle exists

On platforms whose stable launcher is a materialized artifact (Darwin `.app` bundle), the open-app action SHALL fall back to a detached absolute-runtime launch of the generated entry (`node main.mjs`) whenever the artifact does not yet exist. The fallback SHALL be fire-and-forget in the wizard process and SHALL NOT wait for the entry's readiness. When the artifact exists, opening it through the platform launcher SHALL remain the default path.

#### Scenario: First open on Darwin without a bundle

- **GIVEN** a freshly generated project whose Darwin bundle was never materialized
- **WHEN** the user triggers the open-app action
- **THEN** the entry SHALL be spawned detached with the absolute Node runtime
- **AND** the wizard SHALL report the launched pid without blocking on readiness

#### Scenario: Later opens use the bundle

- **GIVEN** the entry has run at least once and the stable bundle exists
- **WHEN** the user triggers the open-app action
- **THEN** the platform launcher SHALL open the bundle path

### Requirement: Success surface SHALL stay platform-truthful about pinning

The success hint SHALL NOT claim a Dock/taskbar pin target exists before the first real launch. On Darwin the hint SHALL state that pinning becomes available after the first open materializes the application bundle.

#### Scenario: Darwin pin hint before first open

- **GIVEN** generation succeeded and no bundle exists yet
- **WHEN** the success surface renders the pinning hint
- **THEN** it SHALL instruct the user to open the app first and pin afterwards

### Requirement: Create icon pipeline SHALL consume the shared icon kernel

The create pipeline's icon phases — tray icon derivation, app-icon composition (background selection, squircle clipping, macOS content variant), glyph fallback, and platform catalog generation — SHALL delegate to the shared `@opentray/icon` kernel. The create core SHALL NOT retain its own sharp-based composition or glyph implementation, and its glyph fallback SHALL use the kernel's default glyph generator so wizard-generated defaults and runtime-synthesized defaults are the same standard.

#### Scenario: Wizard glyph fallback matches runtime defaults

- **GIVEN** a create invocation that falls back to the glyph icon
- **WHEN** its generated app icon is compared with a runtime-synthesized default for the same `appName`
- **THEN** both icons come from the same kernel generator and follow the same squircle standard

#### Scenario: Composition analysis survives the kernel move

- **GIVEN** a user-provided foreground image with known luminance and coverage
- **WHEN** the create pipeline composes the app icon through the kernel
- **THEN** background auto-selection, foreground pixel preservation, and the macOS content variant preserve their create-round-12 semantics
