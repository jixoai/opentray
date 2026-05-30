# vision-driven-openspec-workflow Specification

## Purpose

Define OpenTray's project-local OpenSpec workflow where product intent drives specs, BDD tasks, implementation, and self-review loops.

## Requirements

### Requirement: Vision-driven schema SHALL make intent the first artifact

The project SHALL provide a project-local OpenSpec schema named `vision-driven`. Its first artifact SHALL be `research-plan`, and that artifact SHALL generate `plans/plan.md` as the single current Intent Document. The research-plan artifact SHALL keep the canonical project-local workflow commands visible inside the template so the operator can recover the schema-scoped path from SSOT after the initial CLI output is gone. The research-plan stage MAY use change-local demo/spike code under `demos/` to collapse vague requirements before specs are hardened.

#### Scenario: New change starts from intent

- **GIVEN** the project default OpenSpec schema is `vision-driven`
- **WHEN** a new change is created without an explicit schema override
- **THEN** OpenSpec assigns schema `vision-driven`
- **AND** the first ready artifact is `research-plan`
- **AND** the output path for that artifact is `plans/plan.md`
- **AND** any demo/spike code used during intent research remains change-local under `demos/`

#### Scenario: Intent document keeps workflow command surface visible

- **GIVEN** an operator reopens `plans/plan.md` after the initial CLI output is gone
- **WHEN** they inspect the research-plan template
- **THEN** it lists the canonical `bun run openspec:vision` commands for create, status, instructions, validate, and check
- **AND** it does not require raw generic `openspec` fallback commands to understand the flow

### Requirement: Vision-driven workflow SHALL derive specs and tasks from intent

The `vision-driven` schema SHALL require specs after `research-plan`, and tasks after specs. Tasks SHALL remain checkbox-trackable by OpenSpec apply instructions and SHALL include BDD work that traces back to the Intent Document.

#### Scenario: Specs and tasks are dependency ordered

- **GIVEN** a `vision-driven` change has no artifacts yet
- **WHEN** OpenSpec reports artifact status
- **THEN** `specs` is blocked by `research-plan`
- **AND** `tasks` is blocked by `specs`
- **AND** apply tracking uses `tasks.md`

### Requirement: Self-review SHALL separate reasoning from presentation

The `vision-driven` schema SHALL include a `self-review` artifact that generates `review/self-review.md` as the macro-level review reasoning record. The self-review stage SHALL also require a separate `review/self-review.html` presentation report for screenshots, interaction evidence, and structured review information. The self-review artifact SHALL compare output against `plans/plan.md`, specs, and tasks, and SHALL record deviations plus user-confirmation questions. The HTML report SHALL stay structurally readable, but the workflow SHALL NOT require a rigid HTML section taxonomy just to satisfy the checker.

#### Scenario: Review produces reasoning and presentation artifacts

- **GIVEN** a `vision-driven` change has completed tasks
- **WHEN** self-review is requested
- **THEN** the OpenSpec artifact output path is `review/self-review.md`
- **AND** `review/self-review.md` includes review state, deviations, user-confirmation questions, and exit judgment
- **AND** `review/self-review.html` exists as a separate evidence/report presentation

### Requirement: Controller SHALL enforce schema-scoped entrypoints, revision, and review loop mechanics

The repository SHALL provide a controller entrypoint for workflow mechanics not expressible in OpenSpec schema metadata. The controller SHALL provide schema-scoped wrappers for creating a `vision-driven` change, checking artifact status, fetching artifact instructions, and strictly validating a change. The controller SHALL also support backing up `plans/plan.md` to the next `plans/plan-vN.md`, recording review iteration state in `review/state.json` when the review enters a real loop, signaling repeated issues after 2 occurrences, checking required workflow artifacts, checking Git evidence before phase transitions, writing abnormal-exit handoff evidence, and safely renaming active changes after intent realignment. The `check` command SHALL validate workflow file presence and minimal format sanity for both `review/self-review.md` and `review/self-review.html`, but SHALL NOT over-constrain the prose structure of either review layer.

#### Scenario: Schema-scoped workflow commands stay explicit

- **GIVEN** generic OpenSpec CLI commands may resolve a different default workflow
- **WHEN** the repository controller is used to create, inspect, instruct, or validate a `vision-driven` change
- **THEN** the controller passes explicit `vision-driven` schema arguments where needed
- **AND** strict change validation runs with `--type change --strict`

#### Scenario: Plan backup preserves the current SSOT before revision

- **GIVEN** `plans/plan.md` already exists for a change
- **WHEN** the controller backs up the plan
- **THEN** the current plan is copied to the first available `plans/plan-vN.md`
- **AND** the current `plans/plan.md` remains the SSOT path for the next revision

#### Scenario: Repeated review issue routes back to research-plan

- **GIVEN** the same review issue has been recorded once
- **WHEN** the controller records that issue again
- **THEN** it reports the issue as repeated
- **AND** it exits with a non-zero loop-back signal

#### Scenario: Free-form self-review layers are accepted

- **GIVEN** a `vision-driven` change has `plans/plan.md`, `tasks.md`, a non-empty `review/self-review.md`, and a non-empty `review/self-review.html`
- **WHEN** the controller runs `check`
- **THEN** it does not reject the review just because the Markdown or HTML uses a different section layout

#### Scenario: Optional review state is validated when present

- **GIVEN** a `vision-driven` change includes `review/state.json`
- **WHEN** the controller runs `check`
- **THEN** the state file must be structurally valid for that change

### Requirement: Workflow SHALL preserve Git evidence at every phase boundary

The `vision-driven` workflow SHALL require Git evidence when durable work changes state. Once research-plan, specs, and tasks are ready for apply, the OpenSpec artifacts SHALL be committed before implementation starts. During apply, an agent SHALL update only tasks it has completed and verified in the current working context, then commit the task updates with the corresponding code and BDD evidence. Self-review updates to OpenSpec artifacts, including reopened or newly added tasks, SHALL be committed before the next implementation round.

#### Scenario: OpenSpec artifacts are committed before apply

- **GIVEN** a `vision-driven` change has research-plan, specs, and tasks ready for apply
- **WHEN** implementation is about to start
- **THEN** the agent records a Git commit containing the OpenSpec artifacts before changing product code

#### Scenario: Task progress is committed by the agent that performed it

- **GIVEN** a task is completed during apply
- **WHEN** the agent updates `tasks.md`
- **THEN** the same commit includes the matching implementation or verification evidence
- **AND** the agent does not check off tasks completed only by a previous context without current evidence

### Requirement: Implementation SHALL carry intent comments at critical effect points

Implementation produced by the workflow SHALL include concise comments at critical effect points that trace back to the Intent Document. These comments SHALL preserve the user's original intent in plain language where code behavior could otherwise drift during review or context compression.

#### Scenario: Intent comment supports lightweight review

- **GIVEN** a task implements behavior derived from `plans/plan.md`
- **WHEN** the implementation introduces a non-obvious decision or externally visible effect
- **THEN** the code includes a concise comment linking the decision to the user's intent

### Requirement: Abnormal exit SHALL produce change-local handoff evidence

If self-review cannot exit normally because maximum iterations are exhausted or an issue survives repeated rounds, the workflow SHALL produce `HANDOFF.md` inside the active change directory. If `HANDOFF.md` already exists, the previous file SHALL be renamed to the next `vN.HANDOFF.md` before the new handoff is written. The handoff SHALL be built from schema metadata, generated artifacts, current status, Git state, and validation evidence instead of conversation memory alone.

#### Scenario: Handoff preserves continuation state

- **GIVEN** a `vision-driven` change cannot exit normally
- **WHEN** the controller writes handoff evidence
- **THEN** `openspec/changes/<change>/HANDOFF.md` contains Goal, Current Progress, What Worked, What Didn't Work, and Next Steps
- **AND** any existing handoff is preserved as `vN.HANDOFF.md`

#### Scenario: Handoff files remain commit-ready evidence

- **GIVEN** the workflow writes `HANDOFF.md` or `vN.HANDOFF.md` under `openspec/changes/<change>/`
- **WHEN** the agent checks Git status for evidence retention
- **THEN** those change-local handoff files are not ignored by repository ignore rules
- **AND** they can be committed with the self-review or abnormal-exit evidence checkpoint

### Requirement: File-writing controller commands SHALL accept Here Document input

Controller commands that write user-visible files SHALL share a single inline-document input path. When `handoff <change>` receives non-empty stdin, such as shell Here Document content, the controller SHALL write that content to `HANDOFF.md` after applying the same `vN.HANDOFF.md` backup rule. When stdin is empty, `handoff <change>` SHALL generate the handoff from repository evidence.

#### Scenario: Handoff accepts inline document content

- **GIVEN** an operator runs `bun run openspec:vision -- handoff <change> <<'END'`
- **WHEN** the Here Document body is provided on stdin
- **THEN** the controller writes that body as `openspec/changes/<change>/HANDOFF.md`
- **AND** any previous `HANDOFF.md` is preserved as `vN.HANDOFF.md`

#### Scenario: Empty stdin keeps generated handoff behavior

- **GIVEN** an operator runs `bun run openspec:vision -- handoff <change>` without inline content
- **WHEN** the controller writes handoff evidence
- **THEN** it generates the handoff from schema metadata, generated artifacts, OpenSpec status, Git state, and validation evidence

### Requirement: Change rename SHALL support post-review intent realignment

The controller SHALL provide a safe rename operation for active `vision-driven` changes. Rename SHALL validate both change ids, refuse to overwrite an existing target directory, move the change directory, and update controller-owned state that explicitly records the old change id.

#### Scenario: Rename keeps active change evidence together

- **GIVEN** discussion after self-review changes the target enough that the change id should be renamed
- **WHEN** the controller renames the change
- **THEN** the active change directory moves from the old id to the new id
- **AND** `review/state.json` is updated when it exists
- **AND** existing plan, specs, tasks, review, and handoff evidence remain inside the renamed change

### Requirement: Existing spec-driven changes SHALL remain valid

Changing the project default schema to `vision-driven` SHALL NOT rewrite existing changes that explicitly declare `schema: spec-driven` in `.openspec.yaml`.

#### Scenario: Existing change metadata keeps old workflow

- **GIVEN** an existing change has `.openspec.yaml` with `schema: spec-driven`
- **WHEN** OpenSpec loads status for that change after the default schema changes
- **THEN** it resolves the change through `spec-driven`
- **AND** it does not require `plans/plan.md`, `review/self-review.md`, or `review/self-review.html`
