## MODIFIED Requirements

### Requirement: Core SHALL export commands and scripts from normalized desired state

Core SHALL provide an adapter-neutral export model for a complete create invocation and for POSIX shell and PowerShell script files. Export SHALL serialize the application source — the exact argv command vector and cwd/env, or the `--url` address — plus all create options with shell-appropriate quoting; it SHALL not translate the semantic meaning of an explicitly selected shell. A URL application export SHALL carry `--url` and no command flags, and SHALL never require environment acknowledgement. Generated scripts SHALL use deterministic line endings/encoding for their target and SHALL fail clearly when a value cannot be represented safely.

#### Scenario: Spaces and quotes round-trip

- **GIVEN** arguments, paths, and environment values containing spaces, quotes, and shell metacharacters
- **WHEN** Core exports and the target shell executes the script
- **THEN** the create command SHALL receive the same logical values
- **AND** metacharacters SHALL not gain unintended shell meaning

#### Scenario: URL application exports as a URL invocation

- **GIVEN** a registered URL application
- **WHEN** its export plan is built in any format
- **THEN** the serialized invocation SHALL contain `--url <address>` and no `--exec`/`--arg`/`--cwd`/`--env` tokens
- **AND** re-running the export SHALL recreate the same desired state
