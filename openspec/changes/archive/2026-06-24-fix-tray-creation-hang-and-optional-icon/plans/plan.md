# Intent Document — Fix tray creation hang and optional icon

## Problem

Issue #3: `createTray()` never resolves — its promise hangs indefinitely. The
reporter's reproduction omits the tray `icon`. Two compounding bugs cause the
hang:

1. `TrayOptions.icon` was a required field on the broker side. A `create-tray`
   frame without an icon failed deserialization.
2. When a frame fails deserialization, the broker emits an `error` frame with
   `requestId: null`. The client matches error frames to pending requests by
   `requestId`; a `null` id matches nothing, so the pending `createTray` promise
   is never settled and hangs forever.

## Root Cause

The hang is a request-correlation failure, not a missing feature. Any malformed
frame — not just a missing icon — produces this hang, so fixing icon alone would
leave the class of bug latent.

## Intent

### Surface Intent

A `createTray()` call must always settle: either it resolves with a tray handle
or it rejects with a typed error. It must never hang.

### Underlying Drive

Make tray creation robust for the common case (no icon) and make broker error
correlation honest so no malformed frame can wedge a client promise.

### Final Visible Effect

- `createTray({ trayId, title })` without an icon creates a title-only tray.
- A malformed frame rejects the originating request with a typed error instead
  of hanging.

## Decisions

1. **Make `icon` optional end-to-end.** A tray without an icon is valid
   (title-only status item on all platforms). Updated `TrayOptions`,
   `TrayProjection`, the tray-icon backend, and the TS spec.
2. **Correlate deserialization errors.** The broker now extracts `requestId`
   from the raw JSON line before reporting a parse failure, so the error
   reaches the originating pending request.
3. **Defensive client.** An unmatched error frame (no `requestId` and no pending
   handshake) now rejects all pending requests instead of being swallowed.

## Survey of Current State

| Artifact | Before | After |
| -------- | ------ | ----- |
| `opentray-spec/model.rs` `TrayOptions.icon` | `Icon` (required) | `Option<Icon>` |
| `opentray-core/backend.rs` `TrayProjection.icon` | `Icon` | `Option<Icon>` |
| `opentray-backend-tray-icon` projection + native | required icon | optional icon, title-only tray valid |
| `opentray-bin` frame parse error | `requestId: None` | `requestId` extracted from raw line |
| `packages/spec` `TrayOptions.icon` | `Icon` | `Icon?` |
| `packages/cli` unmatched error | swallowed → hang | `rejectAll` |

## Trade-Off

Making icon optional means a title-only tray is now a supported configuration.
This is a desirable product behavior (many status items are text-only) and
matches platform conventions.

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [x] 5. Self-review against intent.

## Exit Conditions

- `createTray({ trayId, title })` (no icon) resolves to a tray handle.
- A malformed `create-tray` frame rejects the promise with a typed error.
- Full test suites green (Rust + TS + typecheck).
