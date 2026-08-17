## ADDED Requirements

### Requirement: Yargs SHALL own the public command tree

The `create-opentray` executable SHALL use the npm `yargs` package to define, parse, validate, document, and dispatch root commands and subcommands. Hand-written flag loops SHALL NOT remain a parallel parser. Unknown commands/options, missing required values, mutually exclusive options, and invalid enums SHALL fail before Core mutation with stable non-zero exit status and actionable yargs help.

#### Scenario: Unknown option cannot fall through

- **GIVEN** a non-interactive create invocation containing an unknown option
- **WHEN** yargs parses the command
- **THEN** the command SHALL fail before requesting a Core plan
- **AND** it SHALL name the unknown option

### Requirement: Web SHALL be a stable explicit entry

`create-opentray web` SHALL start the loopback WebUI wizard. Invoking `create-opentray` without a subcommand SHALL continue to dispatch to the same WebUI behavior for compatibility, but documentation and exported durable links SHALL prefer the explicit `web` command. Web server flags SHALL be scoped to `web` and SHALL NOT be accepted by non-interactive commands unless they have the same named semantics.

#### Scenario: Root and web launch the same adapter

- **GIVEN** equivalent WebUI server options
- **WHEN** one invocation uses no subcommand and another uses `web`
- **THEN** both SHALL dispatch the same WebUI server adapter and Core session contract

### Requirement: Create SHALL be fully non-interactive

`create-opentray create [target-dir]` SHALL create a v1 application without opening a browser, launching a prompt, or scraping application name/icon metadata. It SHALL accept either a complete v1 input document or explicit options that compile into v1 desired state. Explicit options SHALL include app identity/name, application and tray icon sources, exact command argv/cwd/env, package manager, icon smoothing, developer mode, window/shell options, and relevant apply controls.

The command SHALL support an argv delimiter so the executable and every subsequent argument arrive as exact vector elements. It SHALL require explicit `appId` and `appName` when no complete config supplies them. Icon sources MAY be local files, HTTP(S) URLs, or Data URLs and SHALL use Core normalization.

#### Scenario: Explicit URL icons create without enrichment

- **GIVEN** app name, app id, command vector, HTTP app icon, and HTTP tray icon supplied to `create`
- **WHEN** the command runs non-interactively
- **THEN** it SHALL request a Core plan/apply without invoking title or favicon scraping
- **AND** the committed registration SHALL contain validated local snapshots

### Requirement: Configuration and option precedence SHALL be deterministic

When a config document and explicit CLI options are both present, the CLI SHALL define one documented precedence rule: a valid input document supplies the base desired state and explicit field options override only their named fields. Destructive/process controls SHALL remain operation inputs and SHALL not be written into v1 config. `--dry-run` SHALL print/return the Core plan without mutation.

#### Scenario: CLI patch does not erase omitted config fields

- **GIVEN** a complete config document and an explicit app-name override
- **WHEN** `create` or `app edit` plans the operation
- **THEN** only app name SHALL differ from the document's normalized desired state
- **AND** omitted CLI options SHALL not reset icon, command, or window fields

### Requirement: Machine-readable mode SHALL conserve output channels

Commands that inspect or mutate applications SHALL support structured JSON output with stable result categories and exit codes. In JSON mode stdout SHALL contain only the result document; progress and diagnostics SHALL use stderr. Environment values SHALL never appear in ordinary diagnostic output.

#### Scenario: Automation receives parseable failure

- **GIVEN** an invalid v1 config and `--json`
- **WHEN** the command fails validation
- **THEN** stdout SHALL contain one parseable typed failure result
- **AND** no human progress line or environment value SHALL corrupt stdout

