// Copyright 2022-2022 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

// Orthogonal intent (2026-07-14; original user request: render the Windows tray icon):
// Preserve every RGBA pixel with alpha greater than zero in the native monochrome AND mask.
// Orthogonal intent (2026-10-01; original user request: tray 图标像 low-DPI 位图):
// 1. Area-average downscale oversized RGBA to the tray's physical slot so the
//    shell never cheap-stretches a full-resolution bitmap.
// 2. Retain the (post-downscale) RGBA so template icons can be re-tinted at
//    the current taskbar theme without re-decoding the source.

// taken from https://github.com/rust-windowing/winit/blob/92fdf5ba85f920262a61cee4590f4a11ad5738d1/src/platform_impl/windows/icon.rs

use std::{fmt, io, mem, path::Path, sync::Arc};

use windows_sys::{
    core::PCWSTR,
    Win32::UI::WindowsAndMessaging::{
        CreateIcon, DestroyIcon, LoadImageW, HICON, IMAGE_ICON, LR_DEFAULTSIZE, LR_LOADFROMFILE,
    },
};

use crate::icon::*;

use super::{text_icon, util};

impl Pixel {
    fn convert_to_bgra(&mut self) {
        mem::swap(&mut self.r, &mut self.b);
    }
}

fn and_mask_value(alpha: u8) -> u8 {
    if alpha == 0 { 1 } else { 0 }
}

impl RgbaIcon {
    fn into_windows_hicon(self) -> Result<HICON, BadIcon> {
        let mut rgba = self.rgba;
        let pixel_count = rgba.len() / PIXEL_SIZE;
        let mut and_mask = Vec::with_capacity(pixel_count);
        let pixels =
            unsafe { std::slice::from_raw_parts_mut(rgba.as_mut_ptr() as *mut Pixel, pixel_count) };
        for pixel in pixels {
            // AND mask: 0 = visible, non-zero = transparent. Only fully transparent (alpha==0)
            // pixels are masked out; partially transparent pixels are kept visible so the shell
            // blends them using the color bitmap's alpha channel.
            and_mask.push(and_mask_value(pixel.a));
            pixel.convert_to_bgra();
        }
        assert_eq!(and_mask.len(), pixel_count);
        let handle = unsafe {
            CreateIcon(
                std::ptr::null_mut(),
                self.width as i32,
                self.height as i32,
                1,
                (PIXEL_SIZE * 8) as u8,
                and_mask.as_ptr(),
                rgba.as_ptr(),
            )
        };
        if !handle.is_null() {
            Ok(handle)
        } else {
            Err(BadIcon::OsError(io::Error::last_os_error()))
        }
    }
}

/// Area-average downscale to fit `max_dim`, preserving aspect and premultiplied
/// color (a half-covered pure red stays pure red; straight averaging would
/// bleach it toward the background). No-op when the image already fits —
/// upscaling is the shell's job, never ours.
pub(super) fn downscale_rgba_to_fit(icon: &mut RgbaIcon, max_dim: u32) {
    let (w, h) = (icon.width as u64, icon.height as u64);
    if w == 0 || h == 0 || (w <= max_dim as u64 && h <= max_dim as u64) {
        return;
    }
    let (tw, th) = if w >= h {
        let tw = (max_dim as u64).min(w);
        (tw, ((h * tw) / w).max(1))
    } else {
        let th = (max_dim as u64).min(h);
        (((w * th) / h).max(1), th)
    };
    let mut out = vec![0u8; (tw * th * 4) as usize];
    for dy in 0..th {
        let y0 = dy * h / th;
        let y1 = ((dy + 1) * h / th).max(y0 + 1);
        for dx in 0..tw {
            let x0 = dx * w / tw;
            let x1 = ((dx + 1) * w / tw).max(x0 + 1);
            // Premultiplied accumulation; u64 headroom holds worst-case
            // 4096px sources averaged into a 16px slot without overflow.
            let (mut ar, mut ag, mut ab, mut aa, mut n) = (0u64, 0u64, 0u64, 0u64, 0u64);
            for y in y0..y1 {
                let row = (y * w) as usize;
                for x in x0..x1 {
                    let p = &icon.rgba[(row + x as usize) * 4..(row + x as usize) * 4 + 4];
                    let (r, g, b, a) = (p[0] as u64, p[1] as u64, p[2] as u64, p[3] as u64);
                    ar += r * a;
                    ag += g * a;
                    ab += b * a;
                    aa += a;
                    n += 1;
                }
            }
            let o = (dy * tw + dx) as usize * 4;
            if aa == 0 {
                continue;
            }
            out[o] = (ar / aa).min(255) as u8;
            out[o + 1] = (ag / aa).min(255) as u8;
            out[o + 2] = (ab / aa).min(255) as u8;
            out[o + 3] = (aa / n).min(255) as u8;
        }
    }
    icon.rgba = out;
    icon.width = tw as u32;
    icon.height = th as u32;
}

#[cfg(test)]
mod tests {
    use super::{and_mask_value, downscale_rgba_to_fit};
    use crate::icon::RgbaIcon;

    #[test]
    fn and_mask_only_hides_fully_transparent_pixels() {
        assert_eq!(and_mask_value(0), 1);
        assert_eq!(and_mask_value(1), 0);
        assert_eq!(and_mask_value(128), 0);
        assert_eq!(and_mask_value(255), 0);
    }

    fn icon_of(pixels: &[[u8; 4]], width: u32, height: u32) -> RgbaIcon {
        RgbaIcon {
            rgba: pixels.iter().flat_map(|p| p.iter().copied()).collect(),
            width,
            height,
        }
    }

    fn pixel_at(icon: &RgbaIcon, x: u32, y: u32) -> [u8; 4] {
        let o = ((y * icon.width + x) * 4) as usize;
        icon.rgba[o..o + 4].try_into().unwrap()
    }

    #[test]
    fn downscale_is_noop_when_already_fitting() {
        let mut icon = icon_of(&[[255, 0, 0, 255]], 1, 1);
        downscale_rgba_to_fit(&mut icon, 16);
        assert_eq!((icon.width, icon.height), (1, 1));
        assert_eq!(icon.rgba, vec![255, 0, 0, 255]);

        // One dimension equal to the slot is still a fit.
        let mut icon = icon_of(&vec![[10, 20, 30, 255]; 16], 16, 1);
        downscale_rgba_to_fit(&mut icon, 16);
        assert_eq!((icon.width, icon.height), (16, 1));
    }

    #[test]
    fn downscale_area_averages_a_solid_block() {
        let mut icon = icon_of(&vec![[200, 100, 50, 255]; 16], 4, 4);
        downscale_rgba_to_fit(&mut icon, 2);
        assert_eq!((icon.width, icon.height), (2, 2));
        for y in 0..2 {
            for x in 0..2 {
                assert_eq!(pixel_at(&icon, x, y), [200, 100, 50, 255]);
            }
        }
    }

    #[test]
    fn downscale_averages_premultiplied_color() {
        // Half-covered pure red must stay pure red: straight averaging would
        // bleach (255+0)/2=127 toward whatever sits behind the tray.
        let mut icon = icon_of(&[[255, 0, 0, 255], [0, 0, 0, 0]], 2, 1);
        downscale_rgba_to_fit(&mut icon, 1);
        assert_eq!((icon.width, icon.height), (1, 1));
        // Integer-truncated half coverage (255/2): color stays pure red.
        assert_eq!(icon.rgba, vec![255, 0, 0, 127]);
    }

    #[test]
    fn downscale_preserves_aspect_via_the_longer_edge() {
        let mut icon = icon_of(&vec![[9, 9, 9, 255]; 8], 4, 2);
        downscale_rgba_to_fit(&mut icon, 2);
        assert_eq!((icon.width, icon.height), (2, 1));

        let mut icon = icon_of(&vec![[9, 9, 9, 255]; 8], 2, 4);
        downscale_rgba_to_fit(&mut icon, 2);
        assert_eq!((icon.width, icon.height), (1, 2));
    }

    #[test]
    fn downscale_of_fully_transparent_stays_transparent() {
        let mut icon = icon_of(&vec![[0, 0, 0, 0]; 36], 6, 6);
        downscale_rgba_to_fit(&mut icon, 3);
        assert_eq!(icon.rgba, vec![0u8; 4 * 9]);
    }
}

#[derive(Debug)]
struct RaiiIcon {
    handle: HICON,
}

#[derive(Clone)]
pub(crate) struct WinIcon {
    inner: Arc<RaiiIcon>,
    /// The retained post-downscale RGBA when built from pixels. Template
    /// re-tinting (theme flips) reads this instead of re-decoding the source.
    rgba: Option<Arc<RgbaIcon>>,
}

unsafe impl Send for WinIcon {}

impl WinIcon {
    pub fn as_raw_handle(&self) -> HICON {
        self.inner.handle
    }

    /// The retained RGBA (post-downscale), when this icon was built from
    /// pixels. `None` for handle/path/resource origins — template tinting
    /// degrades to the un-tinted artwork there.
    pub(crate) fn rgba_icon(&self) -> Option<RgbaIcon> {
        self.rgba.as_deref().cloned()
    }

    pub fn from_rgba(rgba: Vec<u8>, width: u32, height: u32) -> Result<Self, BadIcon> {
        let mut rgba_icon = RgbaIcon::from_rgba(rgba, width, height)?;
        // Tray slot sizing happens here, at the single HICON creation boundary,
        // so every pixel-sourced icon (app artwork and synthesized text alike)
        // registers at the physical size the shell displays.
        downscale_rgba_to_fit(&mut rgba_icon, text_icon::tray_physical_slot_px());
        let retained = Arc::new(rgba_icon.clone());
        let handle = rgba_icon.into_windows_hicon()?;
        Ok(WinIcon {
            inner: Arc::new(RaiiIcon { handle }),
            rgba: Some(retained),
        })
    }

    pub(crate) fn from_handle(handle: HICON) -> Self {
        Self {
            #[allow(clippy::arc_with_non_send_sync)]
            inner: Arc::new(RaiiIcon { handle }),
            rgba: None,
        }
    }

    pub(crate) fn from_path<P: AsRef<Path>>(
        path: P,
        size: Option<(u32, u32)>,
    ) -> Result<Self, BadIcon> {
        // width / height of 0 along with LR_DEFAULTSIZE tells windows to load the default icon size
        let (width, height) = size.unwrap_or((0, 0));

        let wide_path = util::encode_wide(path.as_ref());

        let handle = unsafe {
            LoadImageW(
                std::ptr::null_mut(),
                wide_path.as_ptr(),
                IMAGE_ICON,
                width as i32,
                height as i32,
                LR_DEFAULTSIZE | LR_LOADFROMFILE,
            )
        };
        if !handle.is_null() {
            Ok(WinIcon::from_handle(handle as HICON))
        } else {
            Err(BadIcon::OsError(io::Error::last_os_error()))
        }
    }

    fn from_resource_inner_name(name: PCWSTR, size: Option<(u32, u32)>) -> Result<Self, BadIcon> {
        // width / height of 0 along with LR_DEFAULTSIZE tells windows to load the default icon size
        let (width, height) = size.unwrap_or((0, 0));
        let handle = unsafe {
            LoadImageW(
                util::get_instance_handle(),
                name,
                IMAGE_ICON,
                width as i32,
                height as i32,
                LR_DEFAULTSIZE,
            )
        };
        if !handle.is_null() {
            Ok(WinIcon::from_handle(handle as HICON))
        } else {
            Err(BadIcon::OsError(io::Error::last_os_error()))
        }
    }

    pub(crate) fn from_resource(
        resource_id: u16,
        size: Option<(u32, u32)>,
    ) -> Result<Self, BadIcon> {
        Self::from_resource_inner_name(resource_id as PCWSTR, size)
    }

    pub(crate) fn from_resource_name(
        resource_name: &str,
        size: Option<(u32, u32)>,
    ) -> Result<Self, BadIcon> {
        let wide_name = util::encode_wide(resource_name);
        Self::from_resource_inner_name(wide_name.as_ptr(), size)
    }
}

impl Drop for RaiiIcon {
    fn drop(&mut self) {
        unsafe { DestroyIcon(self.handle) };
    }
}

impl fmt::Debug for WinIcon {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> Result<(), fmt::Error> {
        (*self.inner).fmt(formatter)
    }
}
