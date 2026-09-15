# darwin-launch-descriptor delta

## ADDED Requirements

### Requirement: Launch-state lock SHALL use the shared owner-stamped helper

The mutable launch state (`opentray-launch.json` updates and the launch-state section of the stable bundle) SHALL be guarded by the same shared owner-stamped lock helper as bundle materialization. The descriptor update path SHALL NOT keep a second private lock implementation.

A stale, empty, or dead-owner lock on the launch-state path SHALL be reclaimable under the same bounded budget, and a `kill -9` during descriptor update SHALL never permanently block later starts.

#### Scenario: Kill during descriptor update is recoverable

- **GIVEN** a caller is killed with SIGKILL while updating the launch descriptor under its lock
- **WHEN** the app starts again
- **THEN** the next descriptor update reclaims the stale lock through the shared helper
- **AND** no second, divergent lock implementation exists on this path.
