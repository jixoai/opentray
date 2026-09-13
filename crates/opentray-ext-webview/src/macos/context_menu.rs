//! Engine context-menu suppression for trusted shell UI (contract-5,
//! 2026-09-14 walkthrough P1-4).
//!
//! A bridged child webview is trusted shell UI (the toolbar page is the
//! canonical case): the engine's native right-click menu — Reload, Inspect
//! Element, Open Link… — must never leak engine commands onto it. WebKit has
//! no public per-webview toggle for the menu, and `objc2-web-kit` does not
//! generate any menu-related `WKUIDelegate` method, so this module goes
//! through the AppKit `NSView` hook instead: the established macOS technique
//! (subclassing `WKWebView` and overriding `willOpenMenu:withEvent:`) is
//! applied per instance through an isa-swizzle, because wry — not us —
//! instantiates the view.
//!
//! The swizzle contract (`AnyObject::set_class`): the registered subclass is
//! a subclass of the object's live class (wry's `WryWebView`), adds NO ivars
//! (instance sizes stay equal), and only ADDS the `willOpenMenu:withEvent:`
//! implementation — every existing method (wry's overrides, WebKit's own)
//! keeps its implementation. WebKit consults `respondsToSelector:` before
//! invoking the hook, and the added method makes the instance respond; the
//! menu is emptied before presentation, so an empty `NSMenu` opens nothing.

use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::NSMenu;
use wry::WryWebView;

/// The `willOpenMenu:withEvent:` implementation: clear every item before the
/// menu presents. An empty `NSMenu` presents nothing, so the engine menu
/// never becomes visible chrome on the trusted child.
///
/// The ABI is plain pointers (the objc2 `ClassBuilder` method form — same
/// receiver/argument shapes as objc2's own dynamic-class tests); the typed
/// view happens inside the body.
unsafe extern "C" fn will_open_menu(
    _this: *mut AnyObject,
    _cmd: Sel,
    menu: *mut AnyObject,
    _event: *mut AnyObject,
) {
    let _ = _cmd;
    if menu.is_null() {
        return;
    }
    // SAFETY: AppKit passes the live NSMenu for the about-to-present
    // context menu; the NSEvent (nullable) is deliberately unused.
    let menu: &NSMenu = unsafe { &*menu.cast::<NSMenu>() };
    menu.removeAllItems();
}

/// Lazily-registered menu-less subclass of the webview's live class. All
/// wry-built webviews share one runtime class, so a single registration
/// serves every menu-less child; keyed once (main-thread builds only).
static MENULESS_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

fn menuless_class(superclass: &AnyClass) -> &'static AnyClass {
    *MENULESS_CLASS.get_or_init(|| {
        let mut builder = ClassBuilder::new(c"OpenTrayMenulessWebView", superclass)
            .expect("register OpenTrayMenulessWebView subclass");
        // Type-erased fn pointer (the objc2 ClassBuilder form): the callee
        // type parameter infers AnyObject, and the ABI is AppKit's
        // `willOpenMenu:withEvent:` — id receiver, non-null menu object,
        // nullable event object, void return.
        let method: unsafe extern "C" fn(_, _, _, _) = will_open_menu;
        // SAFETY: the erased signature matches the selector's ABI above.
        unsafe {
            builder.add_method(sel!(willOpenMenu:withEvent:), method);
        }
        builder.register()
    })
}

/// Marks one built webview as menu-less: swaps its class to the menu-less
/// subclass (see the module docs for the swizzle-safety contract).
///
/// # Safety
///
/// `webview` must be a live, main-thread `WryWebView` instance whose class
/// was NOT already swapped; the subclass adds no ivars, so the instance size
/// stays equal (the `set_class` debug contract).
pub(super) unsafe fn suppress_native_context_menu(webview: &Retained<WryWebView>) {
    // `class` is the universal NSObject message; wry's view class is only
    // known at runtime (WryWebView), so query it instead of naming it.
    let superclass: &AnyClass = unsafe { msg_send![&*webview, class] };
    let class = menuless_class(superclass);
    let object: &AnyObject = unsafe { &*Retained::as_ptr(webview).cast::<AnyObject>() };
    // SAFETY: swizzle contract in the module docs (no added ivars; only the
    // one added method).
    let previous = unsafe { AnyObject::set_class(object, class) };
    debug_assert_eq!(
        previous.instance_size(),
        class.instance_size(),
        "menu-less subclass must not add ivars"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::runtime::NSObject;
    use objc2::ClassType;

    /// The registered subclass must sit under the requested superclass and
    /// answer `willOpenMenu:withEvent:` (the responder WebKit probes).
    #[test]
    fn menuless_class_adds_the_will_open_menu_hook() {
        let class = menuless_class(NSObject::class());
        assert!(class.responds_to(sel!(willOpenMenu:withEvent:)));
        assert!(
            !NSObject::class().responds_to(sel!(willOpenMenu:withEvent:)),
            "the hook is the subclass's addition, not NSObject's"
        );
    }
}
