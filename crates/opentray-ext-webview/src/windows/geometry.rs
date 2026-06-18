use opentray_spec::{
    geometry::{
        logical_to_physical_i32_for_dpi, physical_extent_to_logical_u32_for_dpi,
        physical_to_logical_i32_for_dpi,
    },
    Rect,
};
use windows_sys::Win32::Foundation::RECT;

// Windows host/page geometry uses one public contract: logical desktop pixels.
// Native Win32 calls stay physical at the boundary and are converted here only.
#[derive(Clone, Copy)]
pub(super) struct WindowsGeometry {
    dpi: u32,
}

impl WindowsGeometry {
    pub(super) fn from_dpi(dpi: u32) -> Self {
        Self {
            dpi: if dpi == 0 { 96 } else { dpi },
        }
    }

    pub(super) fn scale_factor(self) -> f64 {
        opentray_spec::geometry::dpi_scale_from_dpi(self.dpi)
    }

    pub(super) fn logical_to_physical_i32(self, value: i32) -> i32 {
        logical_to_physical_i32_for_dpi(self.dpi, value)
    }

    pub(super) fn physical_to_logical_i32(self, value: i32) -> i32 {
        physical_to_logical_i32_for_dpi(self.dpi, value)
    }

    pub(super) fn physical_extent_to_logical_u32(self, value: i32) -> u32 {
        physical_extent_to_logical_u32_for_dpi(self.dpi, value)
    }

    pub(super) fn physical_rect_to_logical_rect(self, rect: RECT) -> Rect {
        Rect {
            x: self.physical_to_logical_i32(rect.left),
            y: self.physical_to_logical_i32(rect.top),
            width: self.physical_extent_to_logical_u32((rect.right - rect.left).max(0)),
            height: self.physical_extent_to_logical_u32((rect.bottom - rect.top).max(0)),
        }
    }
}
