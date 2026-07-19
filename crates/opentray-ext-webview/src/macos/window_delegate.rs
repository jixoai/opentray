// Orthogonal intents (2026-07-19; original user request: close an app-mode window and reveal it again from the tray):
// 1. Convert native AppKit close requests into retained-window hides.
// 2. Emit the same operational visibility events as programmatic close.

use std::{cell::RefCell, rc::Weak};

use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{NSObjectProtocol, ProtocolObject},
    DefinedClass, MainThreadMarker,
};
use objc2_app_kit::{NSWindow, NSWindowDelegate};
use objc2_foundation::NSObject;
use serde_json::json;

use super::{queue_window_event, NavigatorWindowBridge};

pub(super) struct RetainedWindowDelegateIvars {
    bridge: Weak<RefCell<NavigatorWindowBridge>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[ivars = RetainedWindowDelegateIvars]
    pub(super) struct RetainedWindowDelegate;

    unsafe impl NSObjectProtocol for RetainedWindowDelegate {}

    unsafe impl NSWindowDelegate for RetainedWindowDelegate {
        #[unsafe(method(windowShouldClose:))]
        fn window_should_close(&self, window: &NSWindow) -> bool {
            window.orderOut(None);
            queue_window_event(&self.ivars().bridge, "closed", json!({ "visible": false }));
            queue_window_event(
                &self.ivars().bridge,
                "visibleChange",
                json!({ "visible": false }),
            );
            false
        }
    }
);

impl RetainedWindowDelegate {
    pub(super) fn install(
        window: &NSWindow,
        bridge: Weak<RefCell<NavigatorWindowBridge>>,
        mtm: MainThreadMarker,
    ) -> Retained<Self> {
        let delegate = mtm
            .alloc::<RetainedWindowDelegate>()
            .set_ivars(RetainedWindowDelegateIvars { bridge });
        let delegate: Retained<Self> = unsafe { msg_send![super(delegate), init] };
        let delegate_protocol = ProtocolObject::from_ref(&*delegate);
        window.setDelegate(Some(delegate_protocol));
        delegate
    }
}
