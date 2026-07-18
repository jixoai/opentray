# @opentray/ext-badge

Official status extension for OpenTray.

## Role

- Expose badge counts, progress bars, overlay icons, and attention state.
- Keep badge truth capability-gated and honest.
- Route badge commands through the normal tray extension ABI.

Windows and Linux support is intentionally reduced until a real native projection exists. Unsupported families reject explicitly.
On the current macOS Dock proof surface, progress and progress state are explicitly unsupported and should not be treated as a working Dock projection.

`BadgeExt.artifact` maps supported targets to platform packages relative to this facade and names the canonical Badge contract manifest. Consumers do not install or locate the native library manually.

## Debug Panel

The repository ships a macOS-facing proof surface at `pnpm --filter opentray example:badge`.
That panel uses `@opentray/ext-webview` IPC to drive the real badge contract and show capability state.
