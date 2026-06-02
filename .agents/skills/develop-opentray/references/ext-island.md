# ext-island

Use this reference when designing or implementing `@opentray/ext-island`.

## Extension Law

Island/live-activity is a roadmap capability atom. It must not define global platform behavior until platform evidence exists for macOS, Windows, and Linux equivalents.

## Current State

- Package placeholder: `packages/ext-island`.
- No stable runtime API has been committed.
- The package README intentionally keeps semantics open.

## Design Rules

- Treat this as a capability-gated extension, not a universal space type.
- Do not import or depend on `@opentray/ext-webview` for core behavior.
- Do not add island-specific branches to `opentray-core`.
- Prefer a small event model that can degrade gracefully to tray menu/status updates where native island/live-activity concepts do not exist.

## Research Gate

Before implementation, collect platform evidence for native UI ownership, event-loop requirements, permission boundaries, and fallback behavior. If the evidence does not fit existing extension laws, propose a law upgrade before adding APIs.
