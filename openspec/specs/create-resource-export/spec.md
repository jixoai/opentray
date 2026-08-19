# create-resource-export Specification

## Purpose
TBD - created by archiving change unify-create-opentray-core. Update Purpose after archive.
## Requirements
### Requirement: Icon rendering SHALL preserve explicit sampling intent

The v1 icon model SHALL represent application and tray source resources independently and SHALL persist `imageSmoothingEnabled` as a rendering choice. When false, every Core-owned resize/composition path for the app-icon foreground and tray icon SHALL use nearest-neighbor/no-smoothing behavior so low-resolution pixel edges remain discrete. When true, the normal high-quality smoothing recipe SHALL apply. The choice SHALL participate in render/cache identity.

#### Scenario: Pixel icon is not blurred

- **GIVEN** a low-resolution uploaded icon and `imageSmoothingEnabled: false`
- **WHEN** Core renders application foreground and tray assets at larger sizes
- **THEN** both render paths SHALL preserve nearest-neighbor pixel boundaries
- **AND** a cache generated with smoothing enabled SHALL not be reused

### Requirement: Developer mode SHALL mean only WebView DevTools admission

The v1 `developerMode` option SHALL default to false. When true, generated WebView windows SHALL request the existing per-window DevTools capability. The option SHALL NOT imply verbose logging, remote debugging endpoints, startup terminal, address bar, app mode, shell execution, or any other development behavior. Platform-specific close/state controls SHALL remain capability-reported.

#### Scenario: Default application is not inspectable

- **GIVEN** a v1 configuration that omits or disables developer mode
- **WHEN** Core derives generated WebView options
- **THEN** it SHALL not request `devtools: true`

### Requirement: Core SHALL export commands and scripts from normalized desired state

Core SHALL provide an adapter-neutral export model for a complete create invocation and for POSIX shell and PowerShell script files. Export SHALL serialize the exact argv command vector and all create options with shell-appropriate quoting; it SHALL not translate the semantic meaning of an explicitly selected shell. Generated scripts SHALL use deterministic line endings/encoding for their target and SHALL fail clearly when a value cannot be represented safely.

#### Scenario: Spaces and quotes round-trip

- **GIVEN** arguments, paths, and environment values containing spaces, quotes, and shell metacharacters
- **WHEN** Core exports and the target shell executes the script
- **THEN** the create command SHALL receive the same logical values
- **AND** metacharacters SHALL not gain unintended shell meaning

### Requirement: Uploaded resources SHALL make script export self-contained

When desired state depends on user-uploaded bytes unavailable at a stable external path, script-file export SHALL embed those bytes and reconstruct validated temporary/source files before invoking create-opentray. Direct command copy MAY encode the bytes as a Data URL only after the adapter records an explicit force-copy choice; otherwise script export SHALL be the default. HTTP URLs MAY remain URLs in the exported input, while Apply still commits local snapshots into the registration.

#### Scenario: Uploaded icon defaults to file export

- **GIVEN** a WebUI-uploaded icon with no stable source path or URL
- **WHEN** an adapter requests export without force-copy
- **THEN** Core SHALL produce a self-contained script export option
- **AND** SHALL mark direct command copy as requiring explicit override

### Requirement: Environment export risk SHALL not use secret heuristics

Core SHALL determine only whether the exported desired state contains one or more environment entries. It SHALL NOT classify names or values as sensitive, safe, secret, token, password, or credential. A non-empty environment overlay SHALL set a risk-acknowledgement requirement in the export plan. Adapters MAY allow the user to edit, clear, or replace values before export, but SHALL provide explicit acknowledgement before emitting complete values. Core diagnostics and ordinary stdout SHALL not echo environment values.

#### Scenario: Unknown env name receives the same guard

- **GIVEN** an environment entry with an arbitrary name that matches no known keyword
- **WHEN** Core builds a complete export plan
- **THEN** the plan SHALL still require environment-risk acknowledgement
- **AND** Core SHALL make no claim about whether the value is sensitive

