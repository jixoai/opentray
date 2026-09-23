// win32 text-title icon shim (OpenTray alignment with the macOS NSStatusItem
// title). Windows has no text tray API, so a tray whose only visual identity
// is its title (the projection's `text-only` and fallback-title paths)
// registers no icon at all and renders as a transparent slot. This module
// rasterizes the title into an RGBA icon through GDI: measured advance width
// (so half-width pairs, full-width CJK, and arbitrary strings all size
// correctly), DPI-scaled metrics, grayscale antialiasing (ClearType subpixel
// AA writes an alpha-breaking subpixel pattern), and a glyph color that
// follows the system taskbar theme. The result goes through the crate's own
// `Icon::from_rgba`, so it rides the same AND-mask-corrected HICON path as
// every other icon.

use crate::icon::Icon;

// Logical metrics (96-dpi units); scaled by the screen DC's DPI at render.
const LOGICAL_ICON_HEIGHT: i32 = 16;
const LOGICAL_FONT_HEIGHT: i32 = 15;
const LOGICAL_MAX_WIDTH: i32 = 96;
const LOGICAL_SIDE_PADDING: i32 = 2;

const FW_SEMIBOLD: u32 = 600;
const ANTIALIASED_QUALITY: u32 = 4;
const DEFAULT_CHARSET: u32 = 1;
const DEFAULT_PITCH: u32 = 0;
const CLIP_DEFAULT_PRECIS: u32 = 0;
const OUT_DEFAULT_PRECIS: u32 = 0;
const BI_RGB: u32 = 0;
const DIB_RGB_COLORS: u32 = 0;
const TRANSPARENT_BK: i32 = 1;
const DT_CENTER: u32 = 0x1;
const DT_VCENTER: u32 = 0x4;
const DT_NOPREFIX: u32 = 0x800;
const DT_SINGLELINE: u32 = 0x20;
const DT_END_ELLIPSIS: u32 = 0x4000;

/// Renders one title into a tray [`Icon`]. `None` (GDI/font failure, empty
/// text) means "no synthesized icon" — callers keep their previous behavior.
pub(super) fn render_title_icon(title: &str) -> Option<Icon> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let (rgba, width, height) = unsafe { render_title_rgba(title)? };
    Icon::from_rgba(rgba, width, height).ok()
}

/// The glyph color for the current taskbar theme: the taskbar follows the
/// SYSTEM theme on Windows 11, so a light taskbar wants a black glyph and a
/// dark one wants white. Any registry failure degrades to the dark-taskbar
/// assumption (white glyph), which is also the safer default on a light room.
pub(super) fn taskbar_glyph_rgb() -> (u8, u8, u8) {
    glyph_rgb_for_light_taskbar(taskbar_uses_light_theme())
}

/// Pure decision seam: light taskbar → near-black glyph, dark → white.
fn glyph_rgb_for_light_taskbar(light: bool) -> (u8, u8, u8) {
    if light {
        (16, 16, 16)
    } else {
        (240, 240, 240)
    }

    // (body continues below with the registry + GDI halves; the seam above
    // exists so the mapping is unit-testable without a graphics session)
}

/// Reads `SystemUsesLightTheme` from the personalization key. `false` is also
/// the answer for pre-Win10 builds and any read failure.
fn taskbar_uses_light_theme() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    const SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
    const VALUE: &str = "SystemUsesLightTheme";

    let mut data: u32 = 0;
    let mut size: u32 = 4;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            super::util::encode_wide(SUBKEY).as_ptr(),
            super::util::encode_wide(VALUE).as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut data as *mut u32 as *mut std::ffi::c_void,
            &mut size,
        )
    };
    result == 0 && data == 1
}

/// Scales one 96-dpi logical unit by the DC's DPI.
fn scaled(logical: i32, dpi: i32) -> i32 {
    (logical as i64 * dpi as i64 / 96) as i32
}

/// One GDI render pass. Returns `(rgba bytes, width, height)`; BGRA DIB data
/// is converted to premultiplied-friendly straight RGBA with coverage-based
/// alpha (the text is drawn white-on-zero, so each pixel's stored red channel
/// IS its coverage; the glyph color is applied per coverage).
///
/// # Safety
/// Calls GDI on the current thread. GDI text rendering requires no apartment
/// and no message pump, so the owner-loop thread law is satisfied trivially.
unsafe fn render_title_rgba(title: &str) -> Option<(Vec<u8>, u32, u32)> {
    use windows_sys::Win32::Foundation::{RECT, SIZE};
    use windows_sys::Win32::Graphics::Gdi::*;

    let screen_dc = CreateCompatibleDC(std::ptr::null_mut());
    if screen_dc.is_null() {
        return None;
    }
    let dpi = GetDeviceCaps(screen_dc, LOGPIXELSX as i32).max(96);

    let font = CreateFontW(
        -scaled(LOGICAL_FONT_HEIGHT, dpi),
        0,
        0,
        0,
        FW_SEMIBOLD as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET as u32,
        OUT_DEFAULT_PRECIS as u32,
        CLIP_DEFAULT_PRECIS as u32,
        ANTIALIASED_QUALITY as u32,
        DEFAULT_PITCH as u32,
        super::util::encode_wide("Segoe UI").as_ptr(),
    );
    if font.is_null() {
        DeleteDC(screen_dc);
        return None;
    }
    let old_font = SelectObject(screen_dc, font);

    // util::encode_wide NUL-terminates; the measure/draw lengths must EXCLUDE
    // that terminator (DrawTextW with an explicit count would otherwise draw
    // the NUL as a glyph).
    let wide = super::util::encode_wide(title);
    let text_len = (wide.len() - 1) as i32;
    let mut extent = SIZE { cx: 0, cy: 0 };
    if GetTextExtentPoint32W(screen_dc, wide.as_ptr(), text_len, &mut extent) == 0 {
        SelectObject(screen_dc, old_font);
        DeleteObject(font);
        DeleteDC(screen_dc);
        return None;
    }

    // Measured advance, padded and capped; a capped render ellipsizes.
    let width = (extent.cx + 2 * scaled(LOGICAL_SIDE_PADDING, dpi))
        .min(scaled(LOGICAL_MAX_WIDTH, dpi))
        .max(scaled(LOGICAL_ICON_HEIGHT, dpi));
    let height = scaled(LOGICAL_ICON_HEIGHT, dpi).max(extent.cy);

    let mut header = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        // Negative height = top-down rows, matching the RGBA row order
        // `Icon::from_rgba` expects.
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..std::mem::zeroed()
    };
    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let dib = CreateDIBSection(screen_dc, &BITMAPINFO { bmiHeader: header, bmiColors: [std::mem::zeroed()] }, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
    if dib.is_null() || bits.is_null() {
        SelectObject(screen_dc, old_font);
        DeleteObject(font);
        DeleteDC(screen_dc);
        return None;
    }

    let mem_dc = CreateCompatibleDC(screen_dc);
    let old_dib = SelectObject(mem_dc, dib);
    // The font must be selected into the DRAWING dc too — measuring happened
    // on screen_dc; a bare mem_dc would fall back to GDI's default raster
    // font and overflow the measured rect.
    let old_mem_font = SelectObject(mem_dc, font);
    SetBkMode(mem_dc, TRANSPARENT_BK);
    SetTextColor(mem_dc, 0x00FF_FF_FF); // white glyph; coverage = per-pixel red
    let mut rect = RECT { left: 0, top: 0, right: width, bottom: height };
    let mut flags = DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX;
    if extent.cx + 2 * scaled(LOGICAL_SIDE_PADDING, dpi) > width {
        flags |= DT_END_ELLIPSIS;
    }
    DrawTextW(mem_dc, wide.as_ptr(), text_len, &mut rect, flags);

    let (glyph_r, glyph_g, glyph_b) = taskbar_glyph_rgb();
    let stride = width as usize * 4;
    let pixels = std::slice::from_raw_parts(bits as *const u8, stride * height as usize);
    let mut rgba = vec![0u8; stride * height as usize];
    for y in 0..height as usize {
        let row = &pixels[y * stride..y * stride + stride];
        let out = &mut rgba[y * stride..y * stride + stride];
        for x in 0..width as usize {
            // Top-down BGRA: B, G, R, A(unwritten). White text means R is
            // the coverage value.
            let coverage = row[x * 4 + 2] as u32;
            if coverage == 0 {
                continue;
            }
            out[x * 4] = (glyph_r as u32 * coverage / 255) as u8;
            out[x * 4 + 1] = (glyph_g as u32 * coverage / 255) as u8;
            out[x * 4 + 2] = (glyph_b as u32 * coverage / 255) as u8;
            out[x * 4 + 3] = coverage as u8;
        }
    }

    SelectObject(mem_dc, old_dib);
    SelectObject(mem_dc, old_mem_font);
    DeleteObject(dib);
    DeleteDC(mem_dc);
    SelectObject(screen_dc, old_font);
    DeleteObject(font);
    DeleteDC(screen_dc);
    // Silence a potential unused-mut if sizes change; header is consumed.
    let _ = &mut header;
    Some((rgba, width as u32, height as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_color_follows_the_taskbar_theme() {
        assert_eq!(glyph_rgb_for_light_taskbar(true), (16, 16, 16));
        assert_eq!(glyph_rgb_for_light_taskbar(false), (240, 240, 240));
    }

    #[test]
    fn dpi_scaling_never_shrinks_below_one_to_one() {
        assert_eq!(scaled(16, 96), 16);
        assert_eq!(scaled(16, 144), 24);
        assert_eq!(scaled(15, 192), 30);
    }

    /// Live GDI render, gated behind an env var so CI sessions without an
    /// interactive graphics stack skip it. Asserts the coverage/alpha shape:
    /// some visible pixels, all alpha <= 255, straight (non-premultiplied
    /// overflow impossible because each channel <= its coverage).
    #[test]
    fn live_render_produces_covered_glyph_pixels() {
        if std::env::var("TRAY_ICON_TEXT_LIVE").ok().as_deref() != Some("1") {
            return;
        }
        let Some((rgba, width, height)) = (unsafe { render_title_rgba("NR") }) else {
            panic!("live GDI render failed");
        };
        assert!(width >= 16 && height >= 16, "{width}x{height}");
        let visible = rgba.chunks_exact(4).filter(|p| p[3] > 0).count();
        assert!(visible > 8, "expected glyph coverage, got {visible} px");
        for pixel in rgba.chunks_exact(4) {
            assert!(pixel[0] <= pixel[3] && pixel[1] <= pixel[3] && pixel[2] <= pixel[3]);
        }
    }
}
