## ADDED Requirements

### Requirement: Native build graph SHALL model daemon and extension artifacts as independent atoms

OpenTray SHALL treat the daemon binary, WebView native library, Lynx native library, and Lynx runtime sidecar as distinct native build atoms. Preview families and release package selection MAY combine these atoms, but they SHALL NOT collapse them back into one platform-owned monolith.

#### Scenario: WebView preview family keeps Lynx atoms out of the closure

- **GIVEN** a preview build request resolves to the `ext-webview-native` family
- **WHEN** the planner materializes the native job
- **THEN** the job includes the WebView native library atom for the selected target
- **AND** it excludes the Lynx native library atom
- **AND** it excludes the Lynx runtime sidecar atom

#### Scenario: Lynx release selection still keeps runtime as an explicit atom

- **GIVEN** a release plan resolves a publish that includes `@opentray/ext-lynx`
- **WHEN** the planner materializes the native jobs
- **THEN** the plan includes the Lynx native library atom
- **AND** it separately includes the Lynx runtime sidecar atom
- **AND** the two atoms remain absent from WebView-only release plans

### Requirement: Preview and release planners SHALL share the same native build graph truth

OpenTray SHALL keep one authoritative native build graph for target support, artifact kinds, and atom composition. Preview and release planners MAY expose different operator-facing inputs, but they SHALL resolve those inputs through the same target and atom truth.

#### Scenario: Shared target truth covers WebView first-stage targets in both planners

- **GIVEN** the repository currently publishes WebView platform packages for macOS arm64/x64, Linux arm64/x64, and Windows arm64/x64
- **WHEN** preview or release planning resolves a WebView build request without explicit target narrowing
- **THEN** both planners agree on the same first-stage WebView target set
- **AND** neither planner invents a second target matrix just for its own workflow
