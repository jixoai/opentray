---
"opentray": patch
"@opentray/ext-webview": patch
"@opentray/ext-badge": patch
---

Fix native package publish correctness for the current OpenTray release line.

- broker runtime resolution now prefers installed `@opentray/<platform>` packages
  before workspace fallback
- POSIX runtime packages preserve executable permissions through `pnpm publish`
- fixed-line native release planning now stages and validates runtime,
  `@opentray/ext-webview`, and `@opentray/ext-badge` platform packages together
- native package validation now inspects the real `pnpm pack` tarball payload so
  empty platform packages fail before publish
