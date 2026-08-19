## ADDED Requirements

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
