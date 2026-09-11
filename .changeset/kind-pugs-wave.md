---
"create-opentray": minor
---

Comprehensive multilingual support for the create wizard UI and its server-emitted guidance.

- The web UI now ships complete, type-checked message catalogs for 9 locales (zh-CN, en, ja, ko, ar, fr, es, de, ru) with `{token}` placeholder parity enforced by tests; Arabic renders right-to-left. All previously hardcoded Chinese strings across the wizard shell, command families, icon picker, advanced settings, dialogs, tabs, URL flow, applications, help, and export surfaces are localized, and locale persists via `?lang=`.
- Server-emitted user-facing strings are localized through a locale channel: the web UI sends `x-opentray-locale` with every API request and `lang=` on the event stream, so validation errors (invalid URL, unsupported scheme, occupied directory, argv program required), pin hints per platform, and PTY-unavailability guidance arrive in the selected language. PTY-unavailable events now carry machine reason codes (`pty_bun_terminal_missing` / `pty_node_pty_missing`) so messages localize client-side instead of relaying a fixed-language string.
- Fixed packaged-runtime icon generation: the glyph font (`inter-glyph.ttf` + OFL notice) and the icon-composition background PNGs are now staged into the published package's root `assets/` (where the bundled icon kernel actually resolves them), and the WASM image codec runtime dependencies (`@jsquash/*`, `@resvg/resvg-wasm`, `exifr`, `@shockpkg/icon-encoder`, `figma-squircle`) are declared, so a registry install can generate default and composed app icons without a local checkout.
