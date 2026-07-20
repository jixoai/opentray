// Orthogonal intents (2026-07-21; original user request: clicking a running
// app-mode Dock entry must reopen its retained window without launching a
// second consumer):
// 1. Attach the missing applicationShouldHandleReopen selector to winit's delegate.
// 2. Forward the native callback into the broker event loop without owning policy.

use std::sync::OnceLock;

use objc2::{
    ffi,
    runtime::{AnyObject, Bool, Imp, ProtocolObject, Sel},
    sel, MainThreadMarker,
};
use objc2_app_kit::{NSApplication, NSApplicationDelegate};

type ReopenHandler = Box<dyn Fn() + Send + Sync + 'static>;

static REOPEN_HANDLER: OnceLock<ReopenHandler> = OnceLock::new();

pub(crate) fn install(
    handler: impl Fn() + Send + Sync + 'static,
) -> Result<(), Box<dyn std::error::Error>> {
    REOPEN_HANDLER
        .set(Box::new(handler))
        .map_err(|_| "Darwin reopen handler is already installed")?;

    let mtm = MainThreadMarker::new().ok_or("Darwin reopen bridge requires the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    let delegate = app
        .delegate()
        .ok_or("winit did not install an app delegate")?;
    let delegate: &ProtocolObject<dyn NSApplicationDelegate> = delegate.as_ref();
    let delegate: &AnyObject = delegate.as_ref();
    let class = delegate.class();
    let selector = sel!(applicationShouldHandleReopen:hasVisibleWindows:);
    if class.instance_method(selector).is_some() {
        return Err("winit app delegate already implements applicationShouldHandleReopen".into());
    }

    let implementation: Imp = unsafe {
        std::mem::transmute(
            application_should_handle_reopen
                as extern "C" fn(&AnyObject, Sel, &NSApplication, Bool) -> Bool,
        )
    };
    #[cfg(target_arch = "aarch64")]
    let types = c"B@:@B";
    #[cfg(target_arch = "x86_64")]
    let types = c"c@:@c";
    let added = unsafe {
        ffi::class_addMethod(
            class as *const _ as *mut _,
            selector,
            implementation,
            types.as_ptr(),
        )
    };
    if !added.as_bool() {
        return Err("unable to attach applicationShouldHandleReopen to winit delegate".into());
    }
    Ok(())
}

extern "C" fn application_should_handle_reopen(
    _delegate: &AnyObject,
    _selector: Sel,
    _application: &NSApplication,
    _has_visible_windows: Bool,
) -> Bool {
    if let Some(handler) = REOPEN_HANDLER.get() {
        handler();
    }
    Bool::YES
}
