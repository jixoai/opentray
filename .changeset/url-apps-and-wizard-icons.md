---
"create-opentray": minor
"@opentray/icon": patch
---

URL apps and the wizard icon pipeline.

- `create --url <https://…>` builds a tray-first app whose appMode WebView points directly at the URL: no PTY/shell assets, identity derived from the address, optional `--toolbar` wrapping page (address bar + navigation shortcuts) that auto-falls-back to a direct window when the site refuses embedding.
- The wizard's URL mode scrapes the page once and presets title/favicon/embedding policy, with a live preview tab; app/tray icon candidates are separated (originals + AI subject extraction for the app icon, solid silhouettes for the macOS tray template).
- Subject extraction runs in the browser (@imgly/background-removal, isnet fp16) through a wizard-server model proxy backed by a persistent on-disk cache — the backend downloads from the CDN once, every later session (any random port) serves from loopback. Advanced settings (model precision, alpha threshold, edge shrink) apply on change and replace the prior subject and its derived silhouettes; thumbnails and any live selection re-fuse automatically across URL switches and re-extractions.
- `@opentray/icon`: auto-background honors a solid border ring (white-pad favicons keep their backdrop), and CJK-less hosts degrade to the neutral terminal mark instead of failing glyph generation.
