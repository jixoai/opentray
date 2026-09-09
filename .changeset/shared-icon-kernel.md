---
"@opentray/icon": minor
"opentray": minor
"@opentray/packaging": minor
"@opentray/vite-plugin": minor
"create-opentray": minor
---

Shared icon kernel and synthesized default app icons.

- New `@opentray/icon`: one app-icon generation kernel (glyph defaults, composition, squircle tiling, ICNS/ICO/Linux PNG encoding) on a WebAssembly image stack (jsquash + resvg). No sharp/libvips anywhere.
- The runtime now synthesizes a first-letter glyph default icon into the Darwin bundle when `appIcon` is omitted, cached under the runtime directory, with `appBundle.defaultAppIcon: false` as the explicit opt-out. Core declared-catalog semantics are unchanged.
- `@opentray/vite-plugin` and create-opentray now consume the shared kernel; the Vite plugin keeps its public API and drops sharp.
