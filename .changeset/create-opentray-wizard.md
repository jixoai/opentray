---
"create-opentray": minor
---

Add the `create-opentray` npm initializer. `npx create-opentray` opens a local
React + shadcn/ui wizard that runs a start command once in a real interactive
terminal (ghostty-web renderer over a prebuilt `@lydell/node-pty` PTY, chunks
transported verbatim with zero server-side interpretation, read-only pipe
fallback), presents the terminal and confirmed HTTP services in one
Chrome-style tabs panel (tab strip above the context nav bar; editable URL
with back/forward on iframe tabs; terminal status bar with cursor, selection,
and clickable service jumps; service tabs kept alive across switches and
auto-focused when sniffed), shows auto-derived identity defaults as input
placeholders plus a square icon picker with clarity-ranked, deduplicated
scraped favicon candidates (SVG, apple-touch-icon, sized sets, ICO frames),
and materializes a
self-contained OpenTray-hosted app project (tray + appMode WebView window +
generated platform icon catalog + absolute shell-free launch vector) with a
pending-log pipeline and a success dialog that can open the app and hints at
taskbar/Dock pinning.

Round 9: the wizard gains an advanced panel — a tray-icon picker (defaults to
the app icon choice, additionally offers alpha-derived solid black/white
silhouettes deduplicated by perceptual hash) and two generated-app window
options, both off by default: `showStartupTerminal` opens a DEDICATED terminal
window streaming the command's PTY (command bar, ghostty canvas, status bar
with live listened ports), and `showAddressBar` wraps each service window in
an address-bar page managed through the Web Navigation API (same-origin
pseudo-routes drive the iframe; history fallback where the API is absent).
Every listened HTTP port opens its own dedicated window; a port that stops
listening marks its window title `(detached)` and recovers when it returns.
Generated entries always launch with Node (a native PTY requires it even when
the wizard itself runs under Bun), and generated apps ship the prebuilt shell
UI plus `@lydell/node-pty` only when the terminal window is enabled.

Round 11: generated projects default to `~/.opentray/create/<name>/`
(stable per app, never pollutes the invocation directory; CLI positional
overrides), the advanced panel shows the resolved location and warns when
it is already occupied, and a 强制覆盖 toggle (plus `--force`) now CLEARS
the existing tree before regenerating instead of layering over stale
files. The list pane reorganizes into two cards (command + 命令选项;
应用配置 with a merged 高级选项), the page animates list→detail through
grid-template interpolation, scrollbars are thin with transparent tracks
and stable gutters, the tabs panel fills the pane with its status bar at
panel level, and icon previews sit on transparency checkerboards.
