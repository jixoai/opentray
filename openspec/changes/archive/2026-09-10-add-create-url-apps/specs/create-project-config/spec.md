## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: URL identity SHALL derive from the address when not supplied

Core SHALL provide a pure identity derivation for URL applications: the default appId SHALL be the URL's first non-empty path segment that is legal as an appId first segment (bare alphanumeric; hyphenated segments contribute the display name only) followed by the reversed hostname segments (e.g. `https://example.com/app` → `app.com.example`, `https://example.com` → `com.example`); the default appName SHALL be the Title Case of the first path segment or, absent a path, of the first hostname label. Callers MAY override both. Derivation SHALL NOT fetch the URL or read anything but the address text. A derived appId that is not a valid reverse-dotted identity (e.g. a single-label host like `localhost`) SHALL fall back to the shared default appId while still deriving the display name, rather than fail creation.

#### Scenario: Identity derives offline from the address

- **GIVEN** the address `https://dsh.example.com/app` and no explicit identity options
- **WHEN** identity is derived
- **THEN** the appId SHALL be `app.com.example.dsh` and the appName SHALL be `App`
- **AND** no network request SHALL have been made

#### Scenario: Root URL derives from the hostname alone

- **GIVEN** the address `https://example.com` and no explicit identity options
- **WHEN** identity is derived
- **THEN** the appId SHALL be `com.example` and the appName SHALL be `Example`

## ADDED Requirements

### Requirement: Window behavior options SHALL carry durable sync and toolbar defaults

The v1 `window` object SHALL accept optional `toolbar` (URL applications), `titleFollowsDocument` (default true — the window title follows the page's `document.title`, document→window one-way), and `iconFollowsDocument` (default false — runtime favicon→window-icon following is opt-in). These are desired-state facts: they round-trip through edit/export and are projected into the generated window's `titleSync`/`iconSync` options and toolbar layout.

#### Scenario: Title follows, icon does not, by default

- **GIVEN** a URL application created without sync flags
- **WHEN** its config is parsed
- **THEN** `titleFollowsDocument` SHALL default to true and `iconFollowsDocument` to false
- **AND** an export invocation SHALL reproduce any explicit deviation from those defaults
