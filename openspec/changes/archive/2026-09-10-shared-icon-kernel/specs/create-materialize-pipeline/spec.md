## ADDED Requirements

### Requirement: Create icon pipeline SHALL consume the shared icon kernel

The create pipeline's icon phases — tray icon derivation, app-icon composition (background selection, squircle clipping, macOS content variant), glyph fallback, and platform catalog generation — SHALL delegate to the shared `@opentray/icon` kernel. The create core SHALL NOT retain its own sharp-based composition or glyph implementation, and its glyph fallback SHALL use the kernel's default glyph generator so wizard-generated defaults and runtime-synthesized defaults are the same standard.

#### Scenario: Wizard glyph fallback matches runtime defaults

- **GIVEN** a create invocation that falls back to the glyph icon
- **WHEN** its generated app icon is compared with a runtime-synthesized default for the same `appName`
- **THEN** both icons come from the same kernel generator and follow the same squircle standard

#### Scenario: Composition analysis survives the kernel move

- **GIVEN** a user-provided foreground image with known luminance and coverage
- **WHEN** the create pipeline composes the app icon through the kernel
- **THEN** background auto-selection, foreground pixel preservation, and the macOS content variant preserve their create-round-12 semantics
