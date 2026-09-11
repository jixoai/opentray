//! Windows box view: the View Registry's first non-webview member
//! (`add-webview-orchestration` D5/D21).
//!
//! A Win32 child window that paints `background` (solid color), `border`
//! (`width` + `color`), and `cornerRadius` through GDI regions, and is an
//! input pass-through: `WM_NCHITTEST` answers `HTTRANSPARENT` so mouse
//! messages over the box rect fall through to the sibling view below it in
//! stacking order — the Windows *parent-owns-hit-test* contract (the child
//! region does not swallow mouse messages). The window carries
//! `WS_EX_TRANSPARENT` so the box paints after the siblings beneath it while
//! z-order stays owned by the layout engine's restack pass.
//!
//! Boxes carry no web content and no bridge surface; they are pure decorative
//! paint primitives owned by the layout transaction
//! (`windows/orchestration.rs`). Layers themselves never paint (D5). GDI has
//! no alpha channel: `#RRGGBBAA` backgrounds paint with the RGB channels only
//! (documented behavior; the protocol accepts the same color spellings on
//! both platforms).

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use opentray_spec::webview::WebviewBoxStyle;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, CreateRectRgn, CreateRoundRectRgn, CreateSolidBrush, DeleteObject, EndPaint,
    FillRgn, FrameRgn, InvalidateRect, PAINTSTRUCT,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, LoadCursorW, RegisterClassW,
    SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW, HTTRANSPARENT, IDC_ARROW, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOW, WM_ERASEBKGND, WM_NCHITTEST, WM_PAINT, WNDCLASSW,
    WS_CHILD, WS_CLIPSIBLINGS, WS_EX_TRANSPARENT,
};

use super::WebviewRuntimeError;

const BOX_CLASS_NAME: &str = "OpenTrayWebBox";

thread_local! {
    /// Paint styles keyed by box HWND. The layout transaction is the only
    /// writer; the box WndProc is the only reader (both on the UI thread).
    static BOX_STYLES: RefCell<HashMap<isize, WebviewBoxStyle>> = RefCell::new(HashMap::new());
}

/// Physical-pixel child rect (host-client coordinates, top-left origin).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PhysicalBoxRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// One native box child window. Dropping the handle destroys the window and
/// unregisters its paint style. `pub(crate)`: the bridge stores these in a
/// crate-visible field, so the type's reachability must match the field's.
pub(crate) struct BoxHostWindow {
    hwnd: HWND,
}

impl BoxHostWindow {
    pub(super) fn hwnd(&self) -> HWND {
        self.hwnd
    }

    pub(super) fn create(
        parent: HWND,
        style: &WebviewBoxStyle,
        rect: PhysicalBoxRect,
        visible: bool,
    ) -> Result<Self, WebviewRuntimeError> {
        register_box_window_class();
        let hinstance = unsafe { GetModuleHandleW(std::ptr::null()) };
        if hinstance.is_null() {
            return Err(WebviewRuntimeError::Internal(
                "failed to resolve current module handle".into(),
            ));
        }
        let class_name = wide_null(BOX_CLASS_NAME);
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TRANSPARENT,
                class_name.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_CLIPSIBLINGS,
                rect.x,
                rect.y,
                rect.width.max(1),
                rect.height.max(1),
                parent,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            )
        };
        if hwnd.is_null() {
            return Err(WebviewRuntimeError::Internal(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        BOX_STYLES.with(|styles| {
            styles.borrow_mut().insert(hwnd as isize, style.clone());
        });
        unsafe {
            ShowWindow(hwnd, if visible { SW_SHOW } else { SW_HIDE });
        }
        Ok(Self { hwnd })
    }

    /// Layout-commit update: paint style, geometry, and visibility. Layout
    /// commits are low-frequency by construction, so the repaint request is
    /// unconditional and Win32 coalesces. `z_insert_after` re-positions the
    /// box in the sibling z-order only when the restack pass asks for it.
    pub(super) fn update(
        &self,
        style: &WebviewBoxStyle,
        rect: PhysicalBoxRect,
        visible: bool,
        z_insert_after: Option<HWND>,
    ) {
        BOX_STYLES.with(|styles| {
            styles.borrow_mut().insert(self.hwnd as isize, style.clone());
        });
        let mut flags = SWP_NOACTIVATE;
        if z_insert_after.is_none() {
            flags |= SWP_NOMOVE | SWP_NOSIZE;
        }
        let after = z_insert_after.unwrap_or(std::ptr::null_mut());
        unsafe {
            SetWindowPos(
                self.hwnd,
                after,
                rect.x,
                rect.y,
                rect.width.max(1),
                rect.height.max(1),
                flags,
            );
            ShowWindow(self.hwnd, if visible { SW_SHOW } else { SW_HIDE });
            InvalidateRect(self.hwnd, std::ptr::null(), 1);
        }
    }
}

impl Drop for BoxHostWindow {
    fn drop(&mut self) {
        BOX_STYLES.with(|styles| {
            styles.borrow_mut().remove(&(self.hwnd as isize));
        });
        unsafe {
            DestroyWindow(self.hwnd);
        }
    }
}

/// RegisterClassW is idempotent for an already-registered class name; the
/// first box of the process registers it and later calls are no-ops whose
/// `ERROR_CLASS_ALREADY_EXISTS` result is intentionally ignored (the same
/// discipline as the host window class).
fn register_box_window_class() {
    let hinstance = unsafe { GetModuleHandleW(std::ptr::null()) };
    if hinstance.is_null() {
        return;
    }
    let class_name = wide_null(BOX_CLASS_NAME);
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(box_window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: std::ptr::null_mut(),
        hCursor: unsafe { LoadCursorW(std::ptr::null_mut(), IDC_ARROW) },
        hbrBackground: std::ptr::null_mut(),
        lpszMenuName: std::ptr::null(),
        lpszClassName: class_name.as_ptr(),
    };
    unsafe {
        RegisterClassW(&class);
    }
}

unsafe extern "system" fn box_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        // Parent-owns-hit-test contract (D21): the box never claims a hit.
        // HTTRANSPARENT on a child window hands the message to the sibling
        // HWND below it in z-order, so input over the box rect reaches the
        // webview beneath instead of being swallowed by the decoration.
        WM_NCHITTEST => HTTRANSPARENT as LRESULT,
        WM_ERASEBKGND => 1,
        WM_PAINT => {
            paint_box(hwnd);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn paint_box(hwnd: HWND) {
    let style = BOX_STYLES.with(|styles| {
        styles
            .borrow()
            .get(&(hwnd as isize))
            .cloned()
            .unwrap_or_default()
    });
    let mut paint = unsafe { std::mem::zeroed::<PAINTSTRUCT>() };
    let hdc = unsafe { BeginPaint(hwnd, &mut paint) };
    if hdc.is_null() {
        return;
    }
    let mut client = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe {
        GetClientRect(hwnd, &mut client);
    }
    let width = (client.right - client.left).max(1);
    let height = (client.bottom - client.top).max(1);
    let radius = (style.corner_radius.unwrap_or(0.0).max(0.0) as i32)
        .clamp(0, width.min(height) / 2);
    let region = unsafe {
        if radius > 0 {
            CreateRoundRectRgn(0, 0, width, height, radius * 2, radius * 2)
        } else {
            CreateRectRgn(0, 0, width, height)
        }
    };
    if !region.is_null() {
        if let Some(background) = parse_color_ref(style.background.as_deref()) {
            let brush = unsafe { CreateSolidBrush(background) };
            if !brush.is_null() {
                unsafe {
                    FillRgn(hdc, region, brush);
                    DeleteObject(brush as _);
                }
            }
        }
        if let Some(border) = &style.border {
            if let Some(color) = parse_color_ref(Some(border.color.as_str())) {
                let brush = unsafe { CreateSolidBrush(color) };
                let thickness = (border.width.max(0.0).round() as i32).clamp(0, width.min(height));
                if !brush.is_null() && thickness > 0 {
                    unsafe {
                        FrameRgn(hdc, region, brush, thickness, thickness);
                        DeleteObject(brush as _);
                    }
                }
            }
        }
        unsafe {
            DeleteObject(region as _);
        }
    }
    unsafe {
        EndPaint(hwnd, &paint);
    }
}

/// Parses `#RRGGBB` / `#RRGGBBAA` into a GDI `COLORREF`. The alpha channel is
/// documented as ignored (GDI is opaque-only), but it must still be valid
/// hex — an invalid spelling rejects the whole value; invalid values yield
/// `None` so that property simply does not paint — mirroring the macOS box
/// view's tolerance for color spelling at the paint layer.
fn parse_color_ref(value: Option<&str>) -> Option<u32> {
    let value = value?;
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 && hex.len() != 8 {
        return None;
    }
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |range: std::ops::Range<usize>| -> Option<u32> {
        u32::from_str_radix(hex.get(range)?, 16).ok()
    };
    let red = channel(0..2)?;
    let green = channel(2..4)?;
    let blue = channel(4..6)?;
    // COLORREF is 0x00BBGGRR.
    Some(blue << 16 | green << 8 | red)
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_refs_parse_rgb_and_ignore_alpha() {
        assert_eq!(parse_color_ref(Some("#FF8040")), Some(0x0040_80FF));
        assert_eq!(parse_color_ref(Some("#FF8040CC")), Some(0x0040_80FF));
        assert_eq!(parse_color_ref(Some("#333333AA")), Some(0x0033_3333));
    }

    #[test]
    fn color_refs_reject_invalid_spellings() {
        assert_eq!(parse_color_ref(None), None);
        assert_eq!(parse_color_ref(Some("FF8040")), None);
        assert_eq!(parse_color_ref(Some("#FF80")), None);
        assert_eq!(parse_color_ref(Some("#FF8040ZZ")), None);
    }

    #[test]
    fn box_rect_is_physical_and_plain() {
        let rect = PhysicalBoxRect {
            x: 8,
            y: 44,
            width: 320,
            height: 240,
        };
        assert_eq!(rect.x, 8);
        assert_eq!(rect.width, 320);
    }
}
