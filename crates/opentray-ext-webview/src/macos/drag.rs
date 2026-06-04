use std::{cell::Cell, ptr::NonNull, rc::Rc};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType, NSWindow};
use serde_json::{json, Value};

use crate::WebviewRuntimeError;

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
    ) -> Result<Value, WebviewRuntimeError> {
        self.active.set(true);
        if self.monitor.is_none() {
            self.install_monitor(window)?;
        }
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

    fn install_monitor(&mut self, window: &Retained<NSWindow>) -> Result<(), WebviewRuntimeError> {
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
                    std::ptr::null_mut()
                }
                NSEventType::LeftMouseUp => {
                    active.set(false);
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
