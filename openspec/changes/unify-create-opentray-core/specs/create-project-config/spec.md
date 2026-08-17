## ADDED Requirements

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

#### Scenario: Metacharacters remain ordinary arguments

- **GIVEN** a command vector whose argument contains `&&`
- **WHEN** Core executes or exports the vector without an explicit shell executable
- **THEN** `&&` SHALL remain one literal argument
- **AND** Core SHALL NOT synthesize a shell process

### Requirement: V1 parsing SHALL reject incompatible or ambiguous state before mutation

Core SHALL strictly validate schema version, identity, command vector, path/resource references, option domains, and cross-field invariants before producing an executable Apply plan. Unknown future schema versions, absolute references for registration-owned resources, missing required default icon projections, malformed environment entries, and paths escaping the registration envelope SHALL produce typed validation failures with no mutation.

#### Scenario: Future configuration is read-only evidence

- **GIVEN** a registration containing a configuration version newer than `1`
- **WHEN** Core scans or applies it
- **THEN** the registration MAY be reported as incompatible diagnostic evidence
- **BUT** Core SHALL NOT modify, downgrade, or apply it

