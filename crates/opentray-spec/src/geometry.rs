#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Shared DPI helper for logical-desktop geometry.
pub struct DpiScale {
    dpi: u32,
}

impl DpiScale {
    pub const fn from_dpi(dpi: u32) -> Self {
        Self {
            dpi: if dpi == 0 { 96 } else { dpi },
        }
    }

    pub const fn dpi(self) -> u32 {
        self.dpi
    }

    pub fn logical_to_physical_i32(self, value: i32) -> i32 {
        logical_to_physical_i32_for_dpi(self.dpi, value)
    }

    pub fn physical_to_logical_i32(self, value: i32) -> i32 {
        physical_to_logical_i32_for_dpi(self.dpi, value)
    }

    pub fn physical_extent_to_logical_u32(self, value: i32) -> u32 {
        physical_extent_to_logical_u32_for_dpi(self.dpi, value)
    }
}

pub fn dpi_scale_from_dpi(dpi: u32) -> f64 {
    (dpi.max(1) as f64) / 96.0
}

pub fn logical_to_physical_i32_for_dpi(dpi: u32, value: i32) -> i32 {
    scale_i32(value, dpi_scale_from_dpi(dpi))
}

pub fn physical_to_logical_i32_for_dpi(dpi: u32, value: i32) -> i32 {
    scale_i32(value, 1.0 / dpi_scale_from_dpi(dpi))
}

pub fn physical_extent_to_logical_u32_for_dpi(dpi: u32, value: i32) -> u32 {
    physical_to_logical_i32_for_dpi(dpi, value.max(0)).max(0) as u32
}

pub fn scale_i32(value: i32, scale: f64) -> i32 {
    ((value as f64) * scale)
        .round()
        .clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpi_scale_normalizes_zero_to_system_default() {
        let scale = DpiScale::from_dpi(0);
        assert_eq!(scale.dpi(), 96);
        assert_eq!(scale.logical_to_physical_i32(120), 120);
    }

    #[test]
    fn dpi_scale_converts_logical_and_physical_values_symmetrically() {
        let scale = DpiScale::from_dpi(144);
        assert_eq!(scale.logical_to_physical_i32(420), 630);
        assert_eq!(scale.logical_to_physical_i32(300), 450);
        assert_eq!(scale.physical_to_logical_i32(630), 420);
        assert_eq!(scale.physical_to_logical_i32(450), 300);
        assert_eq!(scale.physical_extent_to_logical_u32(630), 420);
        assert_eq!(scale.physical_extent_to_logical_u32(450), 300);
    }
}
