# ext-badge

Use this reference when designing or implementing `@opentray/ext-badge`.

## Extension Law

Badge is an optional capability atom for platform status overlays such as badge counts, progress, overlay icons, and attention state. It must remain outside core and attach through extension host commands.

## Current State

- `packages/ext-badge` now ships a typed facade and shared contract helpers.
- `crates/opentray-ext-badge` exists as the native runtime atom.
- `packages/cli/examples/badge-panel.ts` provides a repo-local WebView IPC debug panel.

## Design Rules

- Start from capability detection. Do not fake badge/progress behavior on platforms without support.
- Keep commands scoped to space/tray and session ownership.
- Keep platform-specific implementation behind native extension or backend capability boundaries.
- Avoid coupling badge semantics to WebView or island semantics.

## Verified Surface

- Public facade operations: `setBadge`, `clearBadge`, `setProgress`, `setProgressState`, `setOverlayIcon`, `setAttention`, `getCapabilities`, `reset`.
- Debug panel proof surface: `pnpm --filter opentray example:badge`.
- Honest support model: macOS, Windows, and Linux all report capability truth rather than fake parity.
