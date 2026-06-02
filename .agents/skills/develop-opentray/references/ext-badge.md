# ext-badge

Use this reference when designing or implementing `@opentray/ext-badge`.

## Extension Law

Badge is an optional capability atom for platform status overlays such as badge counts, progress, overlay icons, and attention state. It must remain outside core and attach through extension host commands.

## Current State

- Package placeholder: `packages/ext-badge`.
- No stable runtime API has been committed.
- The package README defines the intended role only.

## Design Rules

- Start from capability detection. Do not fake badge/progress behavior on platforms without support.
- Keep commands scoped to space/tray and session ownership.
- Keep platform-specific implementation behind native extension or backend capability boundaries.
- Avoid coupling badge semantics to WebView or island semantics.

## First Implementation Shape

The first real API should likely define typed commands such as `setBadge`, `setProgress`, `setOverlayIcon`, and `clearBadge`, but only after platform evidence confirms the cross-platform capability shape.
