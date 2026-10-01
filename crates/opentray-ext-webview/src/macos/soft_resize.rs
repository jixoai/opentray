// Orthogonal intents (2026-10-01; original user request: 尽量支持 macOS 的
// bindWindowRegion resize —— 元素绑定手柄把按压转成原生窗口操作):
// 1. Own the frameless soft-resize session state per bridge.
// 2. Translate edge-bound pointer sessions into native setFrame updates.
// 3. Keep the session bounded: it ends on mouse-up or replacement.
// Compromise: 无法在本仓的 Windows 实机上编译/运行验证；API 名均按
// objc2-app-kit 0.3.2 生成的绑定逐个核对，行为以 macOS 实机轮为准。

use std::{
    cell::{Cell, RefCell},
    ptr::NonNull,
    rc::Rc,
};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde_json::{json, Value};

use crate::WebviewRuntimeError;

use super::{
    bridge::{emit_window_event, submit_window_event_push, NavigatorWindowBridge},
    drag::queue_window_interaction_event,
};

/// Frame fallbacks when the window carries no meaningful `minSize` — the same
/// floors the public `resizeTo` command applies.
const SOFT_RESIZE_MIN_WIDTH: f64 = 120.0;
const SOFT_RESIZE_MIN_HEIGHT: f64 = 80.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SoftResizeEdge {
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl SoftResizeEdge {
    /// Mirrors the injected bridge's camelCase edge strings (`topLeft`, …).
    pub(super) fn parse(value: &str) -> Option<Self> {
        match value {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "top" => Some(Self::Top),
            "bottom" => Some(Self::Bottom),
            "topLeft" => Some(Self::TopLeft),
            "topRight" => Some(Self::TopRight),
            "bottomLeft" => Some(Self::BottomLeft),
            "bottomRight" => Some(Self::BottomRight),
            _ => None,
        }
    }

    fn adjusts_left(self) -> bool {
        matches!(self, Self::Left | Self::TopLeft | Self::BottomLeft)
    }

    fn adjusts_right(self) -> bool {
        matches!(self, Self::Right | Self::TopRight | Self::BottomRight)
    }

    fn adjusts_bottom(self) -> bool {
        matches!(self, Self::Bottom | Self::BottomLeft | Self::BottomRight)
    }

    fn adjusts_top(self) -> bool {
        matches!(self, Self::Top | Self::TopLeft | Self::TopRight)
    }
}

#[derive(Clone)]
pub(super) struct SoftResizeState {
    active: Rc<Cell<bool>>,
    monitor: Option<Retained<AnyObject>>,
    monitor_block: Option<RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent>>,
}

impl Default for SoftResizeState {
    fn default() -> Self {
        Self {
            active: Rc::new(Cell::new(false)),
            monitor: None,
            monitor_block: None,
        }
    }
}

impl SoftResizeState {
    /// Starts an edge-bound resize session. `NSWindow` has no public
    /// "begin resize from event" entry point, so the session tracks the mouse
    /// through a local event monitor and applies `setFrame` per drag event —
    /// the manual loop macOS custom-chrome shells use.
    pub(super) fn start(
        &mut self,
        window: &Retained<NSWindow>,
        bridge: &Rc<RefCell<NavigatorWindowBridge>>,
        edge: SoftResizeEdge,
    ) -> Result<Value, WebviewRuntimeError> {
        let (frameless, resizable) = {
            let state = bridge.borrow();
            (state.style.frameless, state.style.resizable)
        };
        if !frameless || !resizable {
            return Ok(json!({ "active": false }));
        }
        self.stop();
        let initial_mouse = NSEvent::mouseLocation();
        let initial_frame = window.frame();
        let min_size = window.minSize();
        let active = Rc::clone(&self.active);
        let weak_bridge = Rc::downgrade(bridge);
        let window = window.clone();
        let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            let event_ref = unsafe { event.as_ref() };
            if !active.get() || event_ref.windowNumber() != window.windowNumber() {
                return event.as_ptr();
            }

            match event_ref.r#type() {
                NSEventType::LeftMouseDragged => {
                    // Screen coordinates keep deltas stable while the frame's
                    // own origin moves under left/bottom-edge resizing.
                    let screen_point = window.convertPointToScreen(event_ref.locationInWindow());
                    apply_soft_resize_frame(
                        &window,
                        edge,
                        initial_mouse,
                        initial_frame,
                        min_size,
                        screen_point,
                    );
                    queue_window_interaction_event(&weak_bridge, false);
                    std::ptr::null_mut()
                }
                NSEventType::LeftMouseUp => {
                    active.set(false);
                    queue_window_interaction_event(&weak_bridge, false);
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
                        "macOS soft resize monitor could not be installed".into(),
                    )
                })?;
        self.monitor = Some(monitor);
        self.monitor_block = Some(block);
        self.active.set(true);
        queue_window_interaction_event(&Rc::downgrade(bridge), true);
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
}

/// AppKit screen coordinates are bottom-left origin: dragging the top edge up
/// grows height; dragging the bottom edge down moves the origin down and grows
/// height. Minimum clamps keep the anchored corner fixed.
fn apply_soft_resize_frame(
    window: &Retained<NSWindow>,
    edge: SoftResizeEdge,
    initial_mouse: NSPoint,
    initial_frame: NSRect,
    min_size: NSSize,
    current_screen: NSPoint,
) {
    let dx = current_screen.x - initial_mouse.x;
    let dy = current_screen.y - initial_mouse.y;
    let mut x = initial_frame.origin.x;
    let mut y = initial_frame.origin.y;
    let mut width = initial_frame.size.width;
    let mut height = initial_frame.size.height;
    if edge.adjusts_left() {
        x += dx;
        width -= dx;
    }
    if edge.adjusts_right() {
        width += dx;
    }
    if edge.adjusts_bottom() {
        y += dy;
        height -= dy;
    }
    if edge.adjusts_top() {
        height += dy;
    }
    let min_width = if min_size.width > 1.0 {
        min_size.width
    } else {
        SOFT_RESIZE_MIN_WIDTH
    };
    let min_height = if min_size.height > 1.0 {
        min_size.height
    } else {
        SOFT_RESIZE_MIN_HEIGHT
    };
    if width < min_width {
        if edge.adjusts_left() {
            x -= min_width - width;
        }
        width = min_width;
    }
    if height < min_height {
        if edge.adjusts_bottom() {
            y -= min_height - height;
        }
        height = min_height;
    }
    // setFrame:display:animate: with animate NO is the documented equivalent of
    // setFrame:display:.
    window.setFrame_display_animate(
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
        true,
        false,
    );
}

#[cfg(test)]
mod tests {
    use super::{SoftResizeEdge, SOFT_RESIZE_MIN_HEIGHT, SOFT_RESIZE_MIN_WIDTH};

    #[test]
    fn soft_resize_edges_parse_the_bridge_camel_case_vocabulary() {
        assert_eq!(
            SoftResizeEdge::parse("topLeft"),
            Some(SoftResizeEdge::TopLeft)
        );
        assert_eq!(
            SoftResizeEdge::parse("bottomRight"),
            Some(SoftResizeEdge::BottomRight)
        );
        assert_eq!(SoftResizeEdge::parse("left"), Some(SoftResizeEdge::Left));
        assert_eq!(SoftResizeEdge::parse("top-left"), None);
        assert_eq!(SoftResizeEdge::parse("resize-top"), None);
    }

    #[test]
    fn soft_resize_edge_axis_coverage_is_complete() {
        for edge in [
            SoftResizeEdge::Left,
            SoftResizeEdge::Right,
            SoftResizeEdge::Top,
            SoftResizeEdge::Bottom,
            SoftResizeEdge::TopLeft,
            SoftResizeEdge::TopRight,
            SoftResizeEdge::BottomLeft,
            SoftResizeEdge::BottomRight,
        ] {
            let horizontal = edge.adjusts_left() || edge.adjusts_right();
            let vertical = edge.adjusts_top() || edge.adjusts_bottom();
            assert!(horizontal || vertical, "edge {edge:?} adjusts nothing");
        }
    }

    #[test]
    fn soft_resize_minimum_floors_stay_positive() {
        assert!(SOFT_RESIZE_MIN_WIDTH > 0.0);
        assert!(SOFT_RESIZE_MIN_HEIGHT > 0.0);
    }
}
