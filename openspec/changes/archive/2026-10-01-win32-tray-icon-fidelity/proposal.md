> Orthogonal intents (maintained 2026-09-29 Asia/Shanghai): win32 tray icons
> must render pixel-sharp at the tray's physical DPI slot, and the template
> (solid-color, theme-following) icon semantics that macOS has today must
> work on Windows too — tinted from the taskbar theme, re-rendered on flip.
>
> Original request (2026-09-29 Asia/Shanghai, skill-creator 联调轮): ① 系统托盘
> 渲染的图标像 low-DPI 图片——是否硬编码 16px？② opentray 已支持文字图标 +
> light/dark 双模式，macOS 独占的纯色（template）图标也应在 Windows 上按
> light/dark 绘制成不同颜色。

## Why

Real-machine evidence (Owner 2026-09-28/29, skill-creator passes a 618×618
monochrome PNG):

1. **Blurry tray icon**: `Icon::from_rgba` on win32 builds the HICON at the
   source's natural size (618×618); `Shell_NotifyIcon` then cheap-stretches it
   into the tray's physical slot (~20px at 125%). The title-icon shim already
   renders DPI-correct (`scaled(16, 144) == 24` is pinned); explicit image
   icons never got the same treatment.
2. **Template ignored on win32**: `is_template` flows from the backend on all
   platforms, but the vendored tray-icon crate drops it off-macOS
   (`let _ = icon_is_template` in the backend's non-macOS update path; the
   win32 platform impl has no `set_icon_as_template` behavior), and the wire
   contract has no way to even express template-ness for win32/linux
   candidates (`Win32Icon = IconImage`, only `DarwinIcon` carries
   `isTemplate`). macOS renders template images as a solid system glyph
   (black in light mode, white in dark); Windows consumers currently ship a
   fixed-color monochrome PNG that fights the taskbar theme.

## What Changes

- **vendor/tray-icon (win32 platform impl)**:
  - `Icon::from_rgba` downsamples RGBA larger than the tray's physical slot
    to `round(16 × dpi / 96)` with a premultiplied area-average filter
    (downscale-only; smaller sources pass through untouched) before creating
    the HICON. The slot math mirrors the title shim's screen-DC DPI scaling.
  - The win32 `Icon` retains its (post-downsample) RGBA so template recolors
    never re-rasterize from the oversized original.
  - `set_icon_as_template(true)` on win32 now recolors the icon's RGB to the
    theme-following solid glyph color (reusing the title shim's
    `taskbar_glyph_rgb()` seam) while preserving per-pixel alpha, and swaps
    the tray HICON; `WM_SETTINGCHANGE`/`ImmersiveColorSet` re-renders template
    icons exactly like title icons today.
- **opentray-spec**: `Win32Icon`/`LinuxIcon` become template-capable
  candidates (`isTemplate?: boolean` on the wire, default false) — same
  optional-key pattern as `DarwinIcon`. Backward compatible: plain `IconImage`
  payloads keep parsing.
- **opentray-backend-tray-icon projection**: win32/linux icon-only selections
  carry `is_template` through to the native layer (darwin already does).
- **skill-creator** (consumer validation): tray-host's win32 candidate passes
  `isTemplate: true` with the existing monochrome-mini asset.

## Capabilities

### Modified Capabilities

- tray icon projection & native rendering: win32 tray icons render
  DPI-sharp; template (solid-color) semantics work on win32 with
  light/dark theme following and flip re-render.

## Verification

- Vendor unit tests: area-average downscale (identity for small sources,
  exact averaging on synthetic boxes), template recolor seam (RGB→glyph
  color, alpha preserved), slot math pinned at 96/144 dpi.
- Spec round-trip tests: win32/linux candidates parse/serialize `isTemplate`
  and stay compatible with plain IconImage payloads.
- Real-machine acceptance (Owner): skill-creator tray icon renders sharp at
  125%+ scaling and follows the system light/dark taskbar theme as a solid
  glyph.
