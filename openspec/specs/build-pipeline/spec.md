# build-pipeline Specification

## Purpose
Define OpenTray's branch preview build law so native extension iteration is triggered by changed changeset files, planned by artifact family, and executed without dragging unrelated extension families into the build graph.
## Requirements
### Requirement: Preview build workflow SHALL be triggered by changeset file updates, not by branch state

OpenTray SHALL provide a branch preview build workflow whose normal automatic trigger is a push that updates one or more `.changeset/*.md` files. The workflow SHALL NOT use “this branch contains changesets” as its trigger law.

#### Scenario: Non-changeset push does not trigger preview build

- **GIVEN** a branch push updates product code but does not modify any `.changeset/*.md` file
- **WHEN** GitHub evaluates the preview build workflow trigger
- **THEN** the preview build workflow does not start automatically

#### Scenario: Changeset file update triggers preview planner

- **GIVEN** a branch push updates at least one `.changeset/*.md` file
- **WHEN** GitHub evaluates the preview build workflow trigger
- **THEN** the preview build workflow starts
- **AND** the first planner step inspects only the changeset files updated by that push

### Requirement: Changeset build marker SHALL be the explicit preview-build intent surface

OpenTray SHALL treat a machine-readable build marker inside a changeset file as the explicit request to spend CI resources on a preview build. A changed changeset file without that marker SHALL cause the workflow to no-op after planning.

#### Scenario: Deleted changed changeset is ignored during preview planning

- **GIVEN** a push changes one or more `.changeset/*.md` paths
- **AND** at least one of those paths was deleted in the resulting checkout
- **WHEN** the preview planner inspects changed changesets
- **THEN** deleted paths are ignored instead of causing file-read failure
- **AND** any remaining live marked changeset still drives the preview plan normally

### Requirement: Planner SHALL infer or validate artifact families instead of hard-coding workflow branches

OpenTray SHALL centralize branch preview build planning in a planner that reads changed changesets, parses build markers, infers default artifact families from the changeset release packages when needed, validates explicit family requests, and produces a normalized job matrix.

#### Scenario: WebView changeset infers ext-webview preview family

- **GIVEN** a changed changeset bumps `@opentray/ext-webview` and contains a build marker with `alias`
- **AND** the marker omits explicit `families`
- **WHEN** the planner resolves the preview build request
- **THEN** it infers the `ext-webview-native` family
- **AND** it chooses the family default target set

#### Scenario: Explicit family request is validated

- **GIVEN** a changed changeset contains a build marker with explicit `families`
- **WHEN** the planner resolves the request
- **THEN** unknown family names fail with a typed planning error
- **AND** known family names produce a normalized family plan

#### Scenario: Multiple marked changesets in one push fail explicitly

- **GIVEN** one push changes multiple `.changeset/*.md` files
- **AND** more than one changed file contains an enabled OpenTray preview build marker
- **WHEN** the planner resolves the request
- **THEN** planning fails explicitly instead of silently merging them

### Requirement: Manual preview overrides SHALL exist without weakening changeset-gated automatic triggers

OpenTray SHALL keep `workflow_dispatch` as an escape hatch for manual preview builds, but that manual path SHALL use the same planner and family metadata as changeset-triggered builds.

#### Scenario: Manual dispatch uses the same planner law

- **GIVEN** a maintainer triggers the preview workflow manually
- **WHEN** they provide explicit family or target overrides
- **THEN** the planner applies the same family validation and job-matrix normalization rules as the automatic changeset path
- **AND** the workflow still avoids unrelated family builds

### Requirement: Native build graph SHALL model daemon and extension artifacts as independent atoms

OpenTray SHALL treat the daemon binary, WebView native library, and Badge native library as distinct native build atoms. Preview families and release package selection MAY combine these atoms, but they SHALL NOT collapse them back into one platform-owned monolith.

#### Scenario: WebView preview family keeps its atom explicit

- **GIVEN** a preview build request resolves to the `ext-webview-native` family
- **WHEN** the planner materializes the native job
- **THEN** the job includes the WebView native library atom for the selected target
- **AND** unrelated native package atoms remain outside that job

### Requirement: Preview and release planners SHALL share the same native build graph truth

OpenTray SHALL keep one authoritative native build graph for target support, artifact kinds, and atom composition. Preview and release planners MAY expose different operator-facing inputs, but they SHALL resolve those inputs through the same target and atom truth.

#### Scenario: Shared target truth covers WebView first-stage targets in both planners

- **GIVEN** the repository currently publishes WebView platform packages for macOS arm64/x64 and Windows arm64/x64
- **WHEN** preview or release planning resolves a WebView build request without explicit target narrowing
- **THEN** both planners agree on the same first-stage WebView target set
- **AND** neither planner invents a second target matrix just for its own workflow
