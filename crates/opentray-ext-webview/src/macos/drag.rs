use std::{
    cell::{Cell, RefCell},
    ptr::NonNull,
    rc::{Rc, Weak},
};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType, NSWindow};
use serde_json::{json, Value};

use crate::WebviewRuntimeError;

use super::NavigatorWindowBridge;

#[derive(Clone)]
pub(super) struct AppRegionDragState {
    active: Rc<Cell<bool>>,
    monitor: Option<Retained<AnyObject>>,
    monitor_block: Option<RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent>>,
}

impl Default for AppRegionDragState {
    fn default() -> Self {
        Self {
            active: Rc::new(Cell::new(false)),
            monitor: None,
            monitor_block: None,
        }
    }
}

impl AppRegionDragState {
    pub(super) fn start(
        &mut self,
        window: &Retained<NSWindow>,
        bridge: Weak<RefCell<NavigatorWindowBridge>>,
    ) -> Result<Value, WebviewRuntimeError> {
        if self.monitor.is_none() {
            self.install_monitor(window, bridge.clone())?;
        }
        self.active.set(true);
        Ok(json!({ "active": true }))
    }

    pub(super) fn stop(&mut self) -> Value {
        self.active.set(false);
        if let Some(monitor) = self.monitor.take() {
            unsafe { NSEvent::removeMonitor(&monitor) };
        }
        self.monitor_block = None;
        json!({ "active": false })
    }

    fn install_monitor(
        &mut self,
        window: &Retained<NSWindow>,
        bridge: Weak<RefCell<NavigatorWindowBridge>>,
    ) -> Result<(), WebviewRuntimeError> {
        let active = Rc::clone(&self.active);
        let window = window.clone();
        let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            let event_ref = unsafe { event.as_ref() };
            if !active.get() {
                return event.as_ptr();
            }

            match event_ref.r#type() {
                NSEventType::LeftMouseDragged => {
                    active.set(false);
                    perform_native_window_drag(&window, event_ref);
                    queue_window_interaction_message(&bridge, false);
                    std::ptr::null_mut()
                }
                NSEventType::LeftMouseUp => {
                    if active.replace(false) {
                        queue_window_interaction_message(&bridge, false);
                    }
                    event.as_ptr()
                }
                _ => event.as_ptr(),
            }
        });
        let mask = NSEventMask::LeftMouseDragged | NSEventMask::LeftMouseUp;
        let monitor =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) }
                .ok_or_else(|| {
                    WebviewRuntimeError::Unsupported(
                        "macOS app-region drag monitor could not be installed".into(),
                    )
                })?;
        self.monitor = Some(monitor);
        self.monitor_block = Some(block);
        Ok(())
    }
}

pub(super) fn queue_window_interaction_message(
    bridge: &Weak<RefCell<NavigatorWindowBridge>>,
    active: bool,
) {
    let Some(bridge) = bridge.upgrade() else {
        return;
    };
    let mut state = bridge.borrow_mut();
    let id = state.next_ipc_message_id;
    state.next_ipc_message_id = state.next_ipc_message_id.saturating_add(1).max(1);
    state.ipc_messages.push_back(json!({
        "id": id,
        "source": "native",
        "payload": { "type": "windowInteraction", "active": active }
    }));
}

fn perform_native_window_drag(window: &Retained<NSWindow>, event: &NSEvent) {
    // The page owns the custom region; AppKit still owns the drag physics. We synthesize
    // the mouse-down event shape AppKit expects instead of moving the window by hand.
    let Some(mouse_down) =
        NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            NSEventType::LeftMouseDown,
            event.locationInWindow(),
            event.modifierFlags(),
            event.timestamp(),
            event.windowNumber(),
            None,
            event.eventNumber(),
            event.clickCount(),
            event.pressure(),
        )
    else {
        return;
    };
    window.performWindowDragWithEvent(&mouse_down);
}
