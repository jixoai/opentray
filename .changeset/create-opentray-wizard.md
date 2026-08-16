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
