//! Box view: the View Registry's first non-webview member (D5).
//!
//! A layer-backed `NSView` that paints `background` (solid color), `border`
//! (`width` + `color`), and `cornerRadius` through its Core Animation layer,
//! and is an input pass-through: `hitTest:` returns `nil` so pointer events
//! over the box rect reach the view below it in stacking order, and the view
//! never accepts first responder. Boxes carry no web content and no bridge
//! surface — they are pure decorative paint primitives owned by the layout
//! engine (`macos/layout.rs`).

use objc2::{define_class, msg_send, rc::Retained, MainThreadMarker};
use objc2_app_kit::NSView;
use objc2_core_foundation::CFRetained;
use objc2_core_graphics::CGColor;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use opentray_spec::webview::WebviewBoxStyle;

use crate::layout::LogicalRect;

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = objc2::MainThreadOnly]
    pub(super) struct BoxBackgroundView;

    impl BoxBackgroundView {
        /// Input pass-through (D5): the box never claims a hit, so input over
        /// its rect falls through to the view below in stacking order.
        /// (`Option<&NSView>` is the encodable nullable-object return form;
        /// the box always answers "not hit".)
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> Option<&NSView> {
            None
        }

        /// Boxes are decorative; they never become first responder.
        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool {
            false
        }
    }
);

impl BoxBackgroundView {
    /// Creates the layer-backed box view and applies its first style and
    /// frame. Top-left-origin logical rects flip here into AppKit's
    /// bottom-left content-view space.
    pub(super) fn create(
        style: &WebviewBoxStyle,
        rect: LogicalRect,
        content_height: f64,
        mtm: MainThreadMarker,
    ) -> Retained<Self> {
        // No custom ivars: allocate and initialize directly.
        let view: Retained<Self> = unsafe { msg_send![mtm.alloc::<BoxBackgroundView>(), init] };
        view.setWantsLayer(true);
        view.apply_style(style);
        view.apply_frame(rect, content_height);
        view
    }

    /// Updates paint + geometry when a layout commit repositions the box or
    /// replaces its style. Layout commits are low-frequency, so the layer
    /// setters run unconditionally and AppKit coalesces the no-op writes.
    pub(super) fn update(&self, style: &WebviewBoxStyle, rect: LogicalRect, content_height: f64) {
        self.apply_style(style);
        self.apply_frame(rect, content_height);
    }

    fn apply_style(&self, style: &WebviewBoxStyle) {
        let Some(layer) = self.layer() else {
            return;
        };
        layer.setBackgroundColor(
            style
                .background
                .as_deref()
                .and_then(parse_hex_color)
                .as_deref(),
        );
        match &style.border {
            Some(border) => {
                layer.setBorderWidth(border.width);
                layer.setBorderColor(parse_hex_color(&border.color).as_deref());
            }
            None => {
                layer.setBorderWidth(0.0);
                layer.setBorderColor(None);
            }
        }
        layer.setCornerRadius(style.corner_radius.unwrap_or(0.0));
        self.setNeedsDisplay(true);
    }

    fn apply_frame(&self, rect: LogicalRect, content_height: f64) {
        // The window content view is not flipped; the protocol's top-left
        // origin converts to AppKit's bottom-left space here.
        let flipped_y = content_height - rect.y - rect.height;
        self.setFrame(NSRect::new(
            NSPoint::new(rect.x, flipped_y),
            NSSize::new(rect.width, rect.height),
        ));
    }
}

/// Parses `#RRGGBB` / `#RRGGBBAA` into a generic-RGB color with components
/// in `0..=1`. Invalid spellings yield `None` (no paint for that property)
/// instead of a runtime failure — protocol validation already rejects
/// non-finite measures; color spelling is the paint layer's concern.
fn parse_hex_color(value: &str) -> Option<CFRetained<CGColor>> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 && hex.len() != 8 {
        return None;
    }
    let channel = |range: std::ops::Range<usize>| -> Option<f64> {
        u8::from_str_radix(hex.get(range)?, 16)
            .ok()
            .map(|byte| byte as f64 / 255.0)
    };
    let alpha = if hex.len() == 8 {
        channel(6..8)?
    } else {
        1.0
    };
    Some(CGColor::new_generic_rgb(
        channel(0..2)?,
        channel(2..4)?,
        channel(4..6)?,
        alpha,
    ))
}
