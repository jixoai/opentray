// Orthogonal intents (2026-07-14; original user request: Windows overlay controls need custom colors):
// 1. Box an opaque Rust color as the WinRT `IReference<Color>` required by AppWindowTitleBar.
// 2. Keep the short-lived COM object local to the HWND-owning native call.

use windows::{
    Foundation::{
        DateTime, IPropertyValue, IPropertyValue_Impl, IReference, IReference_Impl, Point,
        PropertyType, Rect, Size, TimeSpan,
    },
    Win32::Foundation::E_NOTIMPL,
    UI::Color,
};
use windows_core::{Array, ComObject, Error, HSTRING};

#[windows_core::implement(IReference<Color>, IPropertyValue)]
struct ColorReference {
    value: Color,
}

impl IReference_Impl<Color> for ColorReference_Impl {
    fn Value(&self) -> windows_core::Result<Color> {
        Ok(self.value)
    }
}

macro_rules! unsupported_property_value_methods {
    ($($method:ident($($argument:ident: $argument_ty:ty),*) -> $output:ty;)*) => {
        $(
            fn $method(&self, $($argument: $argument_ty),*) -> windows_core::Result<$output> {
                let _ = ($(&$argument),*);
                Err(Error::from(E_NOTIMPL))
            }
        )*
    };
}

impl IPropertyValue_Impl for ColorReference_Impl {
    fn Type(&self) -> windows_core::Result<PropertyType> {
        Ok(PropertyType::OtherType)
    }

    fn IsNumericScalar(&self) -> windows_core::Result<bool> {
        Ok(false)
    }

    unsupported_property_value_methods! {
        GetUInt8() -> u8;
        GetInt16() -> i16;
        GetUInt16() -> u16;
        GetInt32() -> i32;
        GetUInt32() -> u32;
        GetInt64() -> i64;
        GetUInt64() -> u64;
        GetSingle() -> f32;
        GetDouble() -> f64;
        GetChar16() -> u16;
        GetBoolean() -> bool;
        GetString() -> HSTRING;
        GetGuid() -> windows_core::GUID;
        GetDateTime() -> DateTime;
        GetTimeSpan() -> TimeSpan;
        GetPoint() -> Point;
        GetSize() -> Size;
        GetRect() -> Rect;
        GetUInt8Array(value: &mut Array<u8>) -> ();
        GetInt16Array(value: &mut Array<i16>) -> ();
        GetUInt16Array(value: &mut Array<u16>) -> ();
        GetInt32Array(value: &mut Array<i32>) -> ();
        GetUInt32Array(value: &mut Array<u32>) -> ();
        GetInt64Array(value: &mut Array<i64>) -> ();
        GetUInt64Array(value: &mut Array<u64>) -> ();
        GetSingleArray(value: &mut Array<f32>) -> ();
        GetDoubleArray(value: &mut Array<f64>) -> ();
        GetChar16Array(value: &mut Array<u16>) -> ();
        GetBooleanArray(value: &mut Array<bool>) -> ();
        GetStringArray(value: &mut Array<HSTRING>) -> ();
        GetInspectableArray(value: &mut Array<windows_core::IInspectable>) -> ();
        GetGuidArray(value: &mut Array<windows_core::GUID>) -> ();
        GetDateTimeArray(value: &mut Array<DateTime>) -> ();
        GetTimeSpanArray(value: &mut Array<TimeSpan>) -> ();
        GetPointArray(value: &mut Array<Point>) -> ();
        GetSizeArray(value: &mut Array<Size>) -> ();
        GetRectArray(value: &mut Array<Rect>) -> ();
    }
}

pub(super) fn box_color_reference(color: Color) -> IReference<Color> {
    let reference: IReference<Color> =
        ComObject::new(ColorReference { value: color }).into_interface();
    reference
}

#[cfg(test)]
mod tests {
    use windows::{Foundation::PropertyType, UI::Color};

    use super::box_color_reference;

    #[test]
    fn boxed_color_exposes_its_winrt_value() {
        let color = Color {
            A: 255,
            R: 15,
            G: 108,
            B: 189,
        };
        let reference = box_color_reference(color);

        assert_eq!(reference.Value().expect("boxed color value"), color);
        assert_eq!(
            reference.Type().expect("boxed color type"),
            PropertyType::OtherType
        );
    }
}
