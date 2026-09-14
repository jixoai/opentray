# darwin-runtime-carrier delta

## ADDED Requirements

### Requirement: Stable bundle lock SHALL be owner-stamped and self-healing

The single-writer lock guarding stable Darwin bundle materialization (`<App>.app.opentray.lock`) SHALL be acquired through one shared helper co-owned by the bundle path and the launch-descriptor path. The helper SHALL:

- write the owner record (PID plus a unique token) and flush it to disk before the lock is considered held;
- treat a lock file that is empty, unparseable, or whose recorded PID is dead as reclaimable within a bounded acquire budget;
- on release, remove the lock file only when its token still matches, so a delayed release cannot delete a replacement owner's lock.

A `kill -9` at any point of materialization SHALL leave a lock that the next start can reclaim; the user SHALL never need to delete a lock file by hand.

#### Scenario: Kill during materialization is recoverable

- **GIVEN** a caller is killed with SIGKILL while holding the bundle lock mid-materialization
- **WHEN** the same app starts again
- **THEN** the next acquisition reclaims the stale lock within the bounded budget
- **AND** materialization proceeds without a manual lock deletion
- **AND** the acquisition does not fail with `bundle_lock_timeout`.

#### Scenario: Empty lock file is reclaimable

- **GIVEN** a lock file exists with zero bytes and no live holder
- **WHEN** a caller acquires the lock
- **THEN** the empty file is treated as an unheld lock and replaced with an owner-stamped record.

#### Scenario: Release respects token ownership

- **GIVEN** lock holder A is delayed during release while holder B has already reclaimed and re-stamped the lock
- **WHEN** A completes its release
- **THEN** A does not remove B's lock file
- **AND** B's ownership survives.
