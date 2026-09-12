# create-project-config Specification

## Purpose
TBD - created by archiving change unify-create-opentray-core. Update Purpose after archive.

## Requirements

### Requirement: V1 configuration SHALL be the sole editable application authority

Each registered application SHALL contain one `create-opentray.json` document with a numeric schema version of `1`. The document SHALL be the sole editable desired-state authority for create-opentray. Generated entry files, dependency manifests, native icon catalogs, runtime descriptors, and any compatibility projection SHALL be derived output and MUST NOT become a second editable configuration authority.

The v1 document SHALL preserve at least application identity and name, exact command vector, command working directory and environment overlay, package-manager choice, application and tray icon resource references, icon-rendering options including `imageSmoothingEnabled`, generated-window options, and `developerMode`. Apply-time controls such as force, stop-running, restart, purge-target, dry-run, or risk acknowledgement SHALL NOT be persisted as desired state.

#### Scenario: Reapply converges from one source

- **GIVEN** a valid v1 registration whose generated entry and package metadata drift from its configuration
- **WHEN** Core plans and applies that registration
- **THEN** it SHALL derive the application payload from `create-opentray.json`
- **AND** it SHALL NOT read a generated runtime file as competing desired state

### Requirement: Application identity SHALL be immutable after registration

The registration key and OpenTray `appId` SHALL represent the same immutable identity. Editing an existing registration SHALL reject an `appId` change before filesystem or process mutation. Creating the same content under another `appId` SHALL be a new application or explicit copy operation, not an in-place rename.

#### Scenario: Edit cannot migrate identity

- **GIVEN** an existing v1 application registered as `com.example.first`
- **WHEN** an edit requests `appId` `com.example.second`
- **THEN** Core SHALL reject the edit as an identity change
- **AND** the original registration and payload SHALL remain unchanged

### Requirement: Commands SHALL persist as process vectors

The v1 command model SHALL contain an executable, an ordered argument array, an explicit working directory, and an environment overlay. Core SHALL execute that vector without inferring shell syntax. Pipes, redirection, expansion, chaining, or platform shell semantics SHALL exist only when the executable and arguments explicitly name a shell such as `sh -lc`, `powershell -Command`, or `cmd /c`.

A v1 document SHALL describe exactly ONE application source: either a command vector or a `url` string (an `http:`/`https:` address the generated window opens directly). Supplying both, or neither, SHALL be a validation failure. A URL source carries no executable, arguments, working directory, or environment overlay, and no consumer SHALL synthesize any of them from the URL.

#### Scenario: Metacharacters remain ordinary arguments

- **GIVEN** a command vector whose argument contains `&&`
- **WHEN** Core executes or exports the vector without an explicit shell executable
- **THEN** `&&` SHALL remain one literal argument
- **AND** Core SHALL NOT synthesize a shell process

#### Scenario: URL source excludes command semantics

- **GIVEN** a v1 document containing `url` and a `command` object
- **WHEN** the document is parsed
- **THEN** parsing SHALL fail with a typed `invalid_config` error naming the conflict
- **AND** a document containing only `url` SHALL parse with no command fields defaulted

### Requirement: V1 parsing SHALL reject incompatible or ambiguous state before mutation

Core SHALL strictly validate schema version, identity, source (command vector or URL), path/resource references, option domains, and cross-field invariants before producing an executable Apply plan. Unknown future schema versions, absolute references for registration-owned resources, missing required default icon projections, malformed environment entries, paths escaping the registration envelope, non-`http(s)` URL schemes, and ambiguous source combinations SHALL produce typed validation failures with no mutation.

#### Scenario: Future configuration is read-only evidence

- **GIVEN** a registration containing a configuration version newer than `1`
- **WHEN** Core scans or applies it
- **THEN** the registration MAY be reported as incompatible diagnostic evidence
- **BUT** Core SHALL NOT modify, downgrade, or apply it

#### Scenario: Non-HTTP URL scheme is rejected

- **GIVEN** a v1 document whose `url` is `file:///Users/me/site` or `ftp://example.com`
- **WHEN** the document is parsed
- **THEN** parsing SHALL fail with a typed validation failure naming the URL requirement
- **AND** no registration or payload mutation SHALL have occurred

### Requirement: Window behavior options SHALL carry durable sync and toolbar defaults

The v1 `window` object SHALL accept optional `toolbar` (both URL and command applications: host the navigation toolbar), `titleFollowsDocument` (default true — the window title follows the target page's `document.title`, document→window one-way; in toolbar mode the followed document is the content webview's), and `iconFollowsDocument` (default false — runtime favicon→window-icon following is opt-in). These are desired-state facts: they round-trip through edit/export and are projected into the generated window's `titleSync`/`iconSync` options and multi-webview toolbar composition.

#### Scenario: Title follows, icon does not, by default

- **GIVEN** a URL application created without sync flags
- **WHEN** its config is parsed
- **THEN** `titleFollowsDocument` SHALL default to true and `iconFollowsDocument` to false
- **AND** an export invocation SHALL reproduce any explicit deviation from those defaults
