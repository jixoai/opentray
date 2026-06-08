use windows_core::Interface;

use crate::WebviewRuntimeError;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct WindowsWindowId {
    value: u64,
}

impl windows_core::TypeKind for WindowsWindowId {
    type TypeKind = windows_core::CopyType;
}

impl windows_core::RuntimeType for WindowsWindowId {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::from_slice(b"struct(Microsoft.UI.WindowId;u8)");
}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct WindowsAppWindow(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    WindowsAppWindow,
    windows_core::IUnknown,
    windows_core::IInspectable
);

impl windows_core::RuntimeType for WindowsAppWindow {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_class::<Self, IWindowsAppWindow>();
}

unsafe impl Interface for WindowsAppWindow {
    type Vtable = <IWindowsAppWindow as Interface>::Vtable;
    const IID: windows_core::GUID = <IWindowsAppWindow as Interface>::IID;
}

impl windows_core::RuntimeName for WindowsAppWindow {
    const NAME: &'static str = "Microsoft.UI.Windowing.AppWindow";
}

impl WindowsAppWindow {
    pub(super) fn get_from_window_id(
        window_id: WindowsWindowId,
    ) -> Result<Self, WebviewRuntimeError> {
        static FACTORY: windows_core::imp::FactoryCache<
            WindowsAppWindow,
            IWindowsAppWindowStatics,
        > = windows_core::imp::FactoryCache::new();
        FACTORY
            .call(|factory| unsafe {
                let mut result = core::mem::zeroed();
                (Interface::vtable(factory).get_from_window_id)(
                    Interface::as_raw(factory),
                    window_id,
                    &mut result,
                )
                .and_then(|| windows_core::Type::from_abi(result))
            })
            .map_err(|error| {
                WebviewRuntimeError::Unsupported(format!(
                    "Windows AppWindow could not be resolved: {error}"
                ))
            })
    }

    pub(super) fn titlebar(&self) -> Result<WindowsAppWindowTitleBar, WebviewRuntimeError> {
        unsafe {
            let mut result = core::mem::zeroed();
            (Interface::vtable(self).titlebar)(Interface::as_raw(self), &mut result)
                .and_then(|| windows_core::Type::from_abi(result))
        }
        .map_err(|error| {
            WebviewRuntimeError::Unsupported(format!(
                "Windows AppWindow titlebar could not be resolved: {error}"
            ))
        })
    }
}

unsafe impl Send for WindowsAppWindow {}
unsafe impl Sync for WindowsAppWindow {}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct WindowsAppWindowTitleBar(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    WindowsAppWindowTitleBar,
    windows_core::IUnknown,
    windows_core::IInspectable
);

impl windows_core::RuntimeType for WindowsAppWindowTitleBar {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_class::<Self, IWindowsAppWindowTitleBar>();
}

unsafe impl Interface for WindowsAppWindowTitleBar {
    type Vtable = <IWindowsAppWindowTitleBar as Interface>::Vtable;
    const IID: windows_core::GUID = <IWindowsAppWindowTitleBar as Interface>::IID;
}

impl windows_core::RuntimeName for WindowsAppWindowTitleBar {
    const NAME: &'static str = "Microsoft.UI.Windowing.AppWindowTitleBar";
}

impl WindowsAppWindowTitleBar {
    pub(super) fn set_extends_content_into_titlebar(
        &self,
        enabled: bool,
    ) -> Result<(), WebviewRuntimeError> {
        unsafe {
            (Interface::vtable(self).set_extends_content_into_titlebar)(
                Interface::as_raw(self),
                enabled,
            )
            .ok()
        }
        .map_err(|error| {
            WebviewRuntimeError::Unsupported(format!(
                "Windows AppWindow titlebar overlay could not be applied: {error}"
            ))
        })
    }
}

unsafe impl Send for WindowsAppWindowTitleBar {}
unsafe impl Sync for WindowsAppWindowTitleBar {}

windows_core::imp::define_interface!(
    IWindowsAppWindow,
    IWindowsAppWindow_Vtbl,
    0xcfa788b3_643b_5c5e_ad4e_321d48a82acd
);

impl windows_core::RuntimeType for IWindowsAppWindow {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
#[doc(hidden)]
pub struct IWindowsAppWindow_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    id: usize,
    is_shown_in_switchers: usize,
    set_is_shown_in_switchers: usize,
    is_visible: usize,
    owner_window_id: usize,
    position: usize,
    presenter: usize,
    size: usize,
    title: usize,
    set_title: usize,
    titlebar: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        *mut *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
}

windows_core::imp::define_interface!(
    IWindowsAppWindowStatics,
    IWindowsAppWindowStatics_Vtbl,
    0x3c315c24_d540_5d72_b518_b226b83627cb
);

impl windows_core::RuntimeType for IWindowsAppWindowStatics {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
#[doc(hidden)]
pub struct IWindowsAppWindowStatics_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    create: usize,
    create_with_presenter: usize,
    create_with_presenter_and_owner: usize,
    get_from_window_id: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        WindowsWindowId,
        *mut *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
}

windows_core::imp::define_interface!(
    IWindowsAppWindowTitleBar,
    IWindowsAppWindowTitleBar_Vtbl,
    0x5574efa2_c91c_5700_a363_539c71a7aaf4
);

impl windows_core::RuntimeType for IWindowsAppWindowTitleBar {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
#[doc(hidden)]
pub struct IWindowsAppWindowTitleBar_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    background_color: usize,
    set_background_color: usize,
    button_background_color: usize,
    set_button_background_color: usize,
    button_foreground_color: usize,
    set_button_foreground_color: usize,
    button_hover_background_color: usize,
    set_button_hover_background_color: usize,
    button_hover_foreground_color: usize,
    set_button_hover_foreground_color: usize,
    button_inactive_background_color: usize,
    set_button_inactive_background_color: usize,
    button_inactive_foreground_color: usize,
    set_button_inactive_foreground_color: usize,
    button_pressed_background_color: usize,
    set_button_pressed_background_color: usize,
    button_pressed_foreground_color: usize,
    set_button_pressed_foreground_color: usize,
    extends_content_into_titlebar: usize,
    set_extends_content_into_titlebar:
        unsafe extern "system" fn(*mut core::ffi::c_void, bool) -> windows_core::HRESULT,
}
