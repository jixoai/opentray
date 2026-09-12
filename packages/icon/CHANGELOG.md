# @opentray/icon

## 0.25.0

### Patch Changes

- @opentray/spec@0.25.0

## 0.24.0

### Patch Changes

- @opentray/spec@0.24.0

## 0.23.0

### Patch Changes

- 2541354: URL apps and the wizard icon pipeline.

  - `create --url <https://…>` builds a tray-first app whose appMode WebView points directly at the URL: no PTY/shell assets, identity derived from the address, optional `--toolbar` wrapping page (address bar + navigation shortcuts) that auto-falls-back to a direct window when the site refuses embedding.
  - The wizard's URL mode scrapes the page once and presets title/favicon/embedding policy, with a live preview tab; app/tray icon candidates are separated (originals + AI subject extraction for the app icon, solid silhouettes for the macOS tray template).
  - Subject extraction runs in the browser (@imgly/background-removal, isnet fp16) through a wizard-server model proxy backed by a persistent on-disk cache — the backend downloads from the CDN once, every later session (any random port) serves from loopback. Advanced settings (model precision, alpha threshold, edge shrink) apply on change and replace the prior subject and its derived silhouettes; thumbnails and any live selection re-fuse automatically across URL switches and re-extractions.
  - `@opentray/icon`: auto-background honors a solid border ring (white-pad favicons keep their backdrop), and CJK-less hosts degrade to the neutral terminal mark instead of failing glyph generation.
  - @opentray/spec@0.23.0

## 0.22.0

### Minor Changes

- 255d312: Shared icon kernel and synthesized default app icons.

  - New `@opentray/icon`: one app-icon generation kernel (glyph defaults, composition, squircle tiling, ICNS/ICO/Linux PNG encoding) on a WebAssembly image stack (jsquash + resvg). No sharp/libvips anywhere.
  - The runtime now synthesizes a first-letter glyph default icon into the Darwin bundle when `appIcon` is omitted, cached under the runtime directory, with `appBundle.defaultAppIcon: false` as the explicit opt-out. Core declared-catalog semantics are unchanged.
  - `@opentray/vite-plugin` and create-opentray now consume the shared kernel; the Vite plugin keeps its public API and drops sharp.

### Patch Changes

- @opentray/spec@0.22.0
