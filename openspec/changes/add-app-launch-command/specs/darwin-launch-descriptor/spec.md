<!--
Orthogonal intents (2026-07-20; original user request: remember the last launch
command in the stable app entry):
1. Define the durable descriptor separate from artifact compatibility metadata.
2. Make updates atomic and schema-validated.
3. Preserve managed/prebuilt bundle ownership semantics.
-->

## ADDED Requirements

### Requirement: Versioned Launch Descriptor

The Darwin app bundle SHALL store the latest launch vector at
`Contents/Resources/opentray-launch.json`. The descriptor SHALL be a strict versioned JSON
object with this schema:

```json
{
  "schemaVersion": 1,
  "command": "...",
  "args": ["..."],
  "cwd": "..."
}
```

`command` and `cwd` SHALL be non-empty strings, `args` SHALL be an array of strings, and unknown
fields SHALL be rejected by the descriptor parser. The descriptor SHALL remain physically
separate from `opentray-app-bundle.json`, which remains the immutable executable/template/icon
compatibility record.

#### Scenario: Descriptor survives bundle regeneration

- **GIVEN** the managed bundle is regenerated with the same or a newer broker artifact
- **WHEN** the generation transaction completes
- **THEN** the launch descriptor SHALL contain the current normalized command and the bundle
  manifest SHALL continue to hash only immutable carrier inputs

#### Scenario: Descriptor update is atomic

- **GIVEN** another process may read the stable bundle while a runtime starts
- **WHEN** OpenTray updates `opentray-launch.json`
- **THEN** it SHALL write a sibling temporary file and atomically rename it into place while
  holding the existing stable-bundle lock, never exposing a partially written JSON document

### Requirement: Prebuilt Bundle Launch State

`appBundle.reinitialize: false` SHALL keep the broker, `Info.plist`, icon, and compatibility
manifest read-only, but SHALL permit OpenTray to update the runtime-owned launch descriptor after
the prebuilt bundle passes validation. A missing or malformed descriptor SHALL be repaired by the
next successful runtime initialization.

#### Scenario: Prebuilt assets remain unchanged

- **GIVEN** a plugin-generated bundle is opened with `reinitialize: false`
- **WHEN** the runtime records a new launch command
- **THEN** the broker bytes, plist, icon, and `opentray-app-bundle.json` bytes SHALL remain
  unchanged while `opentray-launch.json` is replaced

#### Scenario: Incompatible prebuilt bundle cannot update launch state

- **GIVEN** a prebuilt bundle fails broker, target, identity, or icon validation
- **WHEN** the runtime attempts to initialize it
- **THEN** it SHALL fail before writing `opentray-launch.json`

