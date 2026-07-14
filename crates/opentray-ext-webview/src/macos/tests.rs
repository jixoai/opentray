use super::bridge::{
    callback_script, emit_window_event, error_callback_script, exec_page_command,
    parse_set_icon_payload, NavigatorWindowRequest,
};
use super::drag::queue_window_interaction_event;
use super::policy::resolve_browser_permission_decision;
use super::style::{
    validate_style_request, MacosWindowStyleState, SetStyleMacosPayload, SetStylePayload,
    SetStylePlatformPayload, SetStyleWindowsPayload, WindowPlatformStyleState,
};
use super::*;
use crate::{
    MetadataSyncSettings, WebviewBackgroundEffectState, WebviewBackgroundInput,
    WebviewBrowserPermissionDecision, WebviewBrowserPermissionFamily, WebviewBrowserPermissionRule,
    WebviewNativeApiSource, WebviewPermissionManagerPolicy, WebviewWindowBackground,
    WebviewWindowIcon,
};
use std::process::Command;

fn bootstrap_script(
    window_settings: NavigatorWindowSettings,
    screen_settings: NavigatorScreenSettings,
    title_sync: MetadataSyncSettings,
    icon_sync: MetadataSyncSettings,
) -> String {
    bootstrap_script_with_policy(
        window_settings,
        screen_settings,
        NavigatorTraySettings::default(),
        title_sync,
        icon_sync,
        WebviewNativeApiPolicy::default(),
    )
}

fn bootstrap_script_with_policy(
    window_settings: NavigatorWindowSettings,
    screen_settings: NavigatorScreenSettings,
    tray_settings: NavigatorTraySettings,
    title_sync: MetadataSyncSettings,
    icon_sync: MetadataSyncSettings,
    native_api_policy: WebviewNativeApiPolicy,
) -> String {
    navigator_window_bootstrap_script(
        window_settings,
        false,
        screen_settings,
        tray_settings,
        title_sync,
        icon_sync,
        &native_api_policy,
        &Default::default(),
    )
}

fn bootstrap_script_with_permission_policy(
    default_src: Vec<WebviewNativeApiSource>,
    remote_origins: Vec<String>,
) -> String {
    navigator_window_bootstrap_script(
        NavigatorWindowSettings::default(),
        false,
        NavigatorScreenSettings::default(),
        NavigatorTraySettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
        &WebviewNativeApiPolicy::default(),
        &WebviewPermissionManagerPolicy {
            default_src,
            remote_origins,
        },
    )
}

#[test]
fn navigator_window_script_uses_private_ipc_internals() {
    let script = bootstrap_script(
        NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        NavigatorScreenSettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
    );

    assert!(script.contains("navigator, \"window\""));
    assert!(script.contains("\"opentray.window\""));
    assert!(script.contains("window.ipc.postMessage"));
    assert!(script.contains("invokeWithNamespace"));
    assert!(script.contains("listen(event, handler)"));
    assert!(script.contains("runCallback"));
    assert!(!script.contains("window.postMessage("));
}

#[test]
fn session_reuse_allows_same_bootstrap_and_same_explicit_content() {
    let bootstrap = WebviewShowSettings::default().session_bootstrap_settings();
    let current = WebviewContentDescriptor::Html("<main>panel</main>".to_string());
    let requested = WebviewContentDescriptor::Html("<main>panel</main>".to_string());

    assert!(
        ensure_session_reuse_allowed(bootstrap.clone(), bootstrap, &current, Some(&requested))
            .is_ok()
    );
}

#[test]
fn session_reuse_rejects_bootstrap_drift_and_implicit_content_replacement() {
    let current_settings = WebviewShowSettings::default();
    let mut requested_settings = WebviewShowSettings::default();
    requested_settings.navigator_screen.enabled = true;

    let bootstrap_error = ensure_session_reuse_allowed(
        current_settings.session_bootstrap_settings(),
        requested_settings.session_bootstrap_settings(),
        &WebviewContentDescriptor::DefaultHtml,
        None,
    )
    .expect_err("bootstrap drift should be rejected");

    assert_eq!(
        bootstrap_error.to_string(),
        "show cannot change bootstrap-level webview session settings; destroy the session and show again"
    );

    let content_error = ensure_session_reuse_allowed(
        WebviewShowSettings::default().session_bootstrap_settings(),
        WebviewShowSettings::default().session_bootstrap_settings(),
        &WebviewContentDescriptor::Html("<main>old</main>".to_string()),
        Some(&WebviewContentDescriptor::Html(
            "<main>new</main>".to_string(),
        )),
    )
    .expect_err("implicit content replacement should be rejected");

    assert_eq!(
        content_error.to_string(),
        "show cannot replace existing webview content; use setContent, navigate, or destroy then show again"
    );
}

#[test]
fn session_bootstrap_ignores_mutable_shell_state_differences() {
    let mut current_settings = WebviewShowSettings::default();
    current_settings.window.title = Some("Current".to_string());
    current_settings.window.style.keep_on_top = false;

    let mut requested_settings = WebviewShowSettings::default();
    requested_settings.window.title = Some("Updated".to_string());
    requested_settings.window.style.keep_on_top = true;
    requested_settings.window.style.background = WebviewWindowBackground::PlatformMaterial {
        material: "hudWindow".to_string(),
        state: WebviewBackgroundEffectState::FollowsWindowActiveState,
    };

    assert!(ensure_session_reuse_allowed(
        current_settings.session_bootstrap_settings(),
        requested_settings.session_bootstrap_settings(),
        &WebviewContentDescriptor::Html("<main>panel</main>".to_string()),
        Some(&WebviewContentDescriptor::Html(
            "<main>panel</main>".to_string()
        )),
    )
    .is_ok());
}

#[test]
fn navigator_window_script_installs_promoted_and_prefixed_api() {
    let script = bootstrap_script(
        NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        NavigatorScreenSettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
    );

    assert!(script.contains("defineBridgeProperty(navigator, \"window\""));
    assert!(script.contains("defineBridgeProperty(navigator, \"opentrayWindow\""));
    assert!(script.contains("value: api"));
}

#[test]
fn navigator_window_script_exposes_tauri_like_async_methods() {
    let script = bootstrap_script(
        NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        NavigatorScreenSettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
    );

    assert!(
        script.contains("const invokeWithNamespace = (namespace, cmd, payload = {}, options) =>")
    );
    assert!(script.contains("async listen(event, handler)"));
    assert!(script.contains("async once(event, handler)"));
    assert!(script.contains("close()"));
    assert!(script.contains("show()"));
    assert!(script.contains("hide()"));
    assert!(script.contains("minimize()"));
    assert!(script.contains("maximize()"));
    assert!(script.contains("restore()"));
    assert!(script.contains("getWindowState()"));
    assert!(script.contains("isMaximized()"));
    assert!(script.contains("isMinimized()"));
    assert!(script.contains("moveTo(x, y)"));
    assert!(script.contains("resizeTo(width, height)"));
    assert!(script.contains("startAppRegionDrag(options)"));
    assert!(script.contains("stopAppRegionDrag()"));
    assert!(script.contains("getStyle()"));
    assert!(script.contains("setStyle(style)"));
    assert!(script.contains("getCapabilities()"));
    assert!(script.contains("openDevtools"));
    assert!(script.contains("closeDevtools"));
    assert!(script.contains("isDevtoolsOpen"));
    assert!(script.contains("getTitle()"));
    assert!(script.contains("setTitle(title)"));
    assert!(script.contains("getIcon()"));
    assert!(script.contains("setIcon(icon)"));
    assert!(script.contains("getTitlebarAreaRect()"));
}

#[test]
fn navigator_window_script_uses_scoped_invoke_request_shape() {
    let script = bootstrap_script(
        NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        NavigatorScreenSettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
    );

    assert!(script.contains("invokeWithNamespace(\"opentray.window\""));
    assert!(script.contains("invokeWithNamespace(\"opentray.screen\""));
    assert!(script.contains("cmd,"));
    assert!(script.contains("callback,"));
    assert!(script.contains("error,"));
    assert!(script.contains("payload,"));
    assert!(script.contains("options"));
}

#[test]
fn navigator_window_script_exposes_tray_namespace_when_enabled() {
    let script = bootstrap_script_with_policy(
        NavigatorWindowSettings::default(),
        NavigatorScreenSettings::default(),
        NavigatorTraySettings { enabled: true },
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
        WebviewNativeApiPolicy {
            tray: Some(vec![WebviewNativeApiSource::Local]),
            ..WebviewNativeApiPolicy::default()
        },
    );

    assert!(script.contains("\"opentray.tray\""));
    assert!(script.contains("navigator.opentray"));
    assert!(script.contains("getBounds()"));
}

#[test]
fn navigator_window_script_routes_dom_listener_compatibility_over_listen() {
    let script = bootstrap_script(
        NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        NavigatorScreenSettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
    );

    assert!(script.contains("addEventListener(event, handler)"));
    assert!(script.contains("api.listen(event, handler).then((unlisten) =>"));
    assert!(script.contains("removeEventListener(event, handler)"));
    assert!(script.contains("await invoke(\"unlisten\", { event, eventId });"));
}

#[test]
fn navigator_window_script_can_bind_window_globals() {
    let script = bootstrap_script(
        NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: true,
            window_controls_overlay: false,
        },
        NavigatorScreenSettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
    );

    assert!(script.contains("window.close = () =>"));
    assert!(script.contains("window.moveTo = (x, y) =>"));
    assert!(script.contains("window.resizeTo = (width, height) =>"));
}

#[test]
fn navigator_window_runtime_binds_window_globals_only_when_enabled() {
    let default_runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
const sameObject = navigator.window === navigator.opentrayWindow;
return {
  sameObject,
  closeSame: window.close === originalClose,
  moveSame: window.moveTo === originalMoveTo,
  resizeSame: window.resizeTo === originalResizeTo,
  screenSame: window.getScreenDetails === originalGetScreenDetails
};
"#,
    );

    assert_eq!(default_runtime["sameObject"], Value::Bool(true));
    assert_eq!(default_runtime["closeSame"], Value::Bool(true));
    assert_eq!(default_runtime["moveSame"], Value::Bool(true));
    assert_eq!(default_runtime["resizeSame"], Value::Bool(true));
    assert_eq!(default_runtime["screenSame"], Value::Bool(true));

    let bound_runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: true,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings {
                enabled: true,
                bind_screen_globals: true,
            },
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
return {
  closeChanged: window.close !== originalClose,
  moveChanged: window.moveTo !== originalMoveTo,
  resizeChanged: window.resizeTo !== originalResizeTo,
  screenChanged: window.getScreenDetails !== originalGetScreenDetails,
  screenObject: navigator.screen === navigator.opentrayScreen
};
"#,
    );

    assert_eq!(bound_runtime["closeChanged"], Value::Bool(true));
    assert_eq!(bound_runtime["moveChanged"], Value::Bool(true));
    assert_eq!(bound_runtime["resizeChanged"], Value::Bool(true));
    assert_eq!(bound_runtime["screenChanged"], Value::Bool(true));
    assert_eq!(bound_runtime["screenObject"], Value::Bool(true));
}

#[test]
fn navigator_window_runtime_exposes_overlay_drag_and_window_state_commands() {
    let runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: true,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
const takeMessage = (cmd) => {
  const index = messages.findIndex((message) => message.cmd === cmd);
  return messages.splice(index, 1)[0];
};
const rectPromise = navigator.opentrayWindow.overlay.getTitlebarAreaRect();
const rectRequest = takeMessage("getTitlebarAreaRect");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(rectRequest.callback, {
  x: 72,
  y: 0,
  width: 420,
  height: 44
});
const rect = await rectPromise;

const dragPromise = navigator.opentrayWindow.startAppRegionDrag({ pointerId: 1 });
const dragRequest = takeMessage("startAppRegionDrag");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(dragRequest.callback, { active: true });
await dragPromise;

const stopPromise = navigator.opentrayWindow.stopAppRegionDrag();
const stopRequest = takeMessage("stopAppRegionDrag");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(stopRequest.callback, { active: false });
await stopPromise;

const showPromise = navigator.opentrayWindow.show();
const showRequest = takeMessage("show");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(showRequest.callback, {
  state: "normal",
  minimized: false,
  maximized: false,
  visible: true
});
const shown = await showPromise;

const hidePromise = navigator.opentrayWindow.hide();
const hideRequest = takeMessage("hide");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(hideRequest.callback, {
  state: "hidden",
  minimized: false,
  maximized: false,
  visible: false
});
const hidden = await hidePromise;

const minimizePromise = navigator.opentrayWindow.minimize();
const minimizeRequest = takeMessage("minimize");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(minimizeRequest.callback, {
  state: "minimized",
  minimized: true,
  maximized: false,
  visible: true
});
const minimized = await minimizePromise;

const maximizePromise = navigator.opentrayWindow.maximize();
const maximizeRequest = takeMessage("maximize");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(maximizeRequest.callback, {
  state: "maximized",
  minimized: false,
  maximized: true,
  visible: true
});
const maximized = await maximizePromise;

const restorePromise = navigator.opentrayWindow.restore();
const restoreRequest = takeMessage("restore");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(restoreRequest.callback, {
  state: "normal",
  minimized: false,
  maximized: false,
  visible: true
});
const restored = await restorePromise;

const statePromise = navigator.opentrayWindow.getWindowState();
const stateRequest = takeMessage("getWindowState");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(stateRequest.callback, restored);
await statePromise;

const isMaximizedPromise = navigator.opentrayWindow.isMaximized();
const isMaximizedRequest = takeMessage("isMaximized");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(isMaximizedRequest.callback, false);
const isMaximized = await isMaximizedPromise;

const isMinimizedPromise = navigator.opentrayWindow.isMinimized();
const isMinimizedRequest = takeMessage("isMinimized");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(isMinimizedRequest.callback, false);
const isMinimized = await isMinimizedPromise;

return {
  overlayVisible: navigator.opentrayWindow.overlay.visible,
  rect,
  rectNamespace: rectRequest.namespace,
  dragPayload: dragRequest.payload.pointerId,
  stopCmd: stopRequest.cmd,
  showCmd: showRequest.cmd,
  shownVisible: shown.visible,
  hideCmd: hideRequest.cmd,
  hiddenVisible: hidden.visible,
  minimizeCmd: minimizeRequest.cmd,
  minimizedState: minimized.state,
  maximizeCmd: maximizeRequest.cmd,
  maximizedFlag: maximized.maximized,
  restoreCmd: restoreRequest.cmd,
  restoredState: restored.state,
  stateCmd: stateRequest.cmd,
  isMaximizedCmd: isMaximizedRequest.cmd,
  isMaximized,
  isMinimizedCmd: isMinimizedRequest.cmd,
  isMinimized
};
"#,
    );

    assert_eq!(runtime["overlayVisible"], Value::Bool(true));
    assert_eq!(runtime["rect"]["x"], Value::from(72));
    assert_eq!(
        runtime["rectNamespace"],
        Value::String("opentray.window".to_string())
    );
    assert_eq!(runtime["dragPayload"], Value::from(1));
    assert_eq!(
        runtime["stopCmd"],
        Value::String("stopAppRegionDrag".to_string())
    );
    assert_eq!(runtime["showCmd"], Value::String("show".to_string()));
    assert_eq!(runtime["shownVisible"], Value::Bool(true));
    assert_eq!(runtime["hideCmd"], Value::String("hide".to_string()));
    assert_eq!(runtime["hiddenVisible"], Value::Bool(false));
    assert_eq!(
        runtime["minimizeCmd"],
        Value::String("minimize".to_string())
    );
    assert_eq!(
        runtime["maximizeCmd"],
        Value::String("maximize".to_string())
    );
    assert_eq!(
        runtime["minimizedState"],
        Value::String("minimized".to_string())
    );
    assert_eq!(runtime["maximizedFlag"], Value::Bool(true));
    assert_eq!(runtime["restoreCmd"], Value::String("restore".to_string()));
    assert_eq!(
        runtime["restoredState"],
        Value::String("normal".to_string())
    );
    assert_eq!(
        runtime["stateCmd"],
        Value::String("getWindowState".to_string())
    );
    assert_eq!(
        runtime["isMaximizedCmd"],
        Value::String("isMaximized".to_string())
    );
    assert_eq!(runtime["isMaximized"], Value::Bool(false));
    assert_eq!(
        runtime["isMinimizedCmd"],
        Value::String("isMinimized".to_string())
    );
    assert_eq!(runtime["isMinimized"], Value::Bool(false));
}

#[test]
fn navigator_window_runtime_exposes_overlay_only_when_declared() {
    let overlay_enabled = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: true,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
return {
  hasOverlay: Boolean(navigator.opentrayWindow.overlay),
  visible: navigator.opentrayWindow.overlay?.visible === true
};
"#,
    );

    let overlay_disabled = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
return {
  hasOverlay: Boolean(navigator.opentrayWindow.overlay)
};
"#,
    );

    assert_eq!(overlay_enabled["hasOverlay"], Value::Bool(true));
    assert_eq!(overlay_enabled["visible"], Value::Bool(true));
    assert_eq!(overlay_disabled["hasOverlay"], Value::Bool(false));
}

#[test]
fn navigator_window_overlay_listener_maps_geometrychange_to_window_channel() {
    let runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: true,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
const events = [];
const listenPromise = navigator.window.overlay.listen("geometrychange", (event) => {
  events.push(event);
});
const listenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(listenRequest.callback, { eventId: 77 });
const unlisten = await listenPromise;
const handlerId = listenRequest.payload.handler;
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(handlerId, {
  event: "overlay.geometrychange",
  id: 77,
  payload: {
    titlebarAreaRect: { x: 8, y: 0, width: 300, height: 44 }
  }
});
await Promise.resolve();

const unlistenPromise = unlisten();
const unlistenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(unlistenRequest.callback, null);
await unlistenPromise;

return {
  listenCmd: listenRequest.cmd,
  listenEvent: listenRequest.payload.event,
  eventWidth: events[0].titlebarAreaRect.width,
  unlistenEvent: unlistenRequest.payload.event
};
"#,
    );

    assert_eq!(runtime["listenCmd"], Value::String("listen".to_string()));
    assert_eq!(
        runtime["listenEvent"],
        Value::String("overlay.geometrychange".to_string())
    );
    assert_eq!(runtime["eventWidth"], Value::from(300));
    assert_eq!(
        runtime["unlistenEvent"],
        Value::String("overlay.geometrychange".to_string())
    );
}

#[test]
fn navigator_window_runtime_denies_remote_injection_by_default() {
    let runtime = run_node_probe_at(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: true,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings {
                enabled: true,
                bind_screen_globals: true,
            },
            MetadataSyncSettings {
                page_to_native: true,
                native_to_page: true,
            },
            MetadataSyncSettings {
                page_to_native: true,
                native_to_page: true,
            },
        ),
        r#"
return {
  hasWindow: typeof navigator.window !== "undefined",
  hasScreen: typeof navigator.screen !== "undefined",
  closeSame: window.close === originalClose,
  screenSame: window.getScreenDetails === originalGetScreenDetails
};
"#,
        "https://example.com/dashboard",
    );

    assert_eq!(runtime["hasWindow"], Value::Bool(false));
    assert_eq!(runtime["hasScreen"], Value::Bool(false));
    assert_eq!(runtime["closeSame"], Value::Bool(true));
    assert_eq!(runtime["screenSame"], Value::Bool(true));
}

#[test]
fn navigator_window_runtime_can_allow_remote_window_without_globals() {
    let runtime = run_node_probe_at(
        &bootstrap_script_with_policy(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: true,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings::default(),
            NavigatorTraySettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
            WebviewNativeApiPolicy {
                default_src: vec![WebviewNativeApiSource::Local],
                window: Some(vec![WebviewNativeApiSource::Origin(
                    "https://example.com".to_string(),
                )]),
                tray: None,
                window_globals: Some(vec![WebviewNativeApiSource::None]),
                screen: None,
                screen_globals: None,
                title_sync: None,
                icon_sync: None,
            },
        ),
        r#"
return {
  hasWindow: typeof navigator.window !== "undefined",
  hasScreen: typeof navigator.screen !== "undefined",
  closeSame: window.close === originalClose
};
"#,
        "https://example.com/dashboard",
    );

    assert_eq!(runtime["hasWindow"], Value::Bool(true));
    assert_eq!(runtime["hasScreen"], Value::Bool(false));
    assert_eq!(runtime["closeSame"], Value::Bool(true));
}

#[test]
fn opentray_permissions_requires_remote_exact_origin_opt_in() {
    let denied = run_node_probe_at(
        &bootstrap_script_with_policy(
            NavigatorWindowSettings::default(),
            NavigatorScreenSettings::default(),
            NavigatorTraySettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
            WebviewNativeApiPolicy::default(),
        ),
        r#"
return {
  hasPermissions: typeof navigator.opentrayPermissions !== "undefined",
  hasNamespace: typeof navigator.opentray?.permissions !== "undefined"
};
"#,
        "https://example.com/dashboard",
    );
    assert_eq!(denied["hasPermissions"], Value::Bool(false));
    assert_eq!(denied["hasNamespace"], Value::Bool(false));

    let allowed = run_node_probe_at(
        &bootstrap_script_with_permission_policy(
            Default::default(),
            vec!["https://example.com".to_string()],
        ),
        r#"
const queryPromise = navigator.opentrayPermissions.query("camera");
const request = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(request.callback, {
  family: "camera",
  decision: "unsupported"
});
const result = await queryPromise;
return {
  hasPermissions: typeof navigator.opentrayPermissions !== "undefined",
  hasNamespace: typeof navigator.opentray?.permissions !== "undefined",
  namespace: request.namespace,
  action: request.cmd,
  family: request.payload.family,
  sourceType: request.payload.source.type,
  sourceOrigin: request.payload.source.origin,
  decision: result.decision
};
"#,
        "https://example.com/dashboard",
    );
    assert_eq!(allowed["hasPermissions"], Value::Bool(true));
    assert_eq!(allowed["hasNamespace"], Value::Bool(true));
    assert_eq!(
        allowed["namespace"],
        Value::String("opentray.permissions".to_string())
    );
    assert_eq!(allowed["action"], Value::String("query".to_string()));
    assert_eq!(allowed["family"], Value::String("camera".to_string()));
    assert_eq!(allowed["sourceType"], Value::String("origin".to_string()));
    assert_eq!(
        allowed["sourceOrigin"],
        Value::String("https://example.com".to_string())
    );
    assert_eq!(
        allowed["decision"],
        Value::String("unsupported".to_string())
    );
}

#[test]
fn navigator_tray_runtime_uses_prefixed_namespace_and_policy_gate() {
    let allowed = run_node_probe(
        &bootstrap_script_with_policy(
            NavigatorWindowSettings::default(),
            NavigatorScreenSettings::default(),
            NavigatorTraySettings { enabled: true },
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
            WebviewNativeApiPolicy {
                tray: Some(vec![WebviewNativeApiSource::Local]),
                ..WebviewNativeApiPolicy::default()
            },
        ),
        r#"
const trayPromise = navigator.opentray.tray.getBounds();
const trayRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(trayRequest.callback, {
  kind: "native",
  source: "host.trayBounds",
  rect: {
    x: 10,
    y: 20,
    width: 24,
    height: 24
  }
});
const bounds = await trayPromise;
return {
  hasTray: typeof navigator.opentray?.tray !== "undefined",
  namespace: trayRequest.namespace,
  width: bounds.rect.width
};
"#,
    );

    assert_eq!(allowed["hasTray"], Value::Bool(true));
    assert_eq!(
        allowed["namespace"],
        Value::String("opentray.tray".to_string())
    );
    assert_eq!(allowed["width"], Value::from(24));

    let denied = run_node_probe_at(
        &bootstrap_script_with_policy(
            NavigatorWindowSettings::default(),
            NavigatorScreenSettings::default(),
            NavigatorTraySettings { enabled: true },
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
            WebviewNativeApiPolicy::default(),
        ),
        r#"
return {
  hasTray: typeof navigator.opentray?.tray !== "undefined"
};
"#,
        "https://example.com/dashboard",
    );

    assert_eq!(denied["hasTray"], Value::Bool(false));
}

#[test]
fn navigator_screen_runtime_uses_screen_namespace() {
    let runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings::default(),
            NavigatorScreenSettings {
                enabled: true,
                bind_screen_globals: true,
            },
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
const screenPromise = navigator.screen.getScreenDetails();
const screenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(screenRequest.callback, {
  currentScreen: null,
  screens: [],
  isExtended: false
});
await screenPromise;

const globalPromise = window.getScreenDetails();
const globalRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(globalRequest.callback, {
  currentScreen: null,
  screens: [],
  isExtended: false
});
await globalPromise;

return {
  sameObject: navigator.screen === navigator.opentrayScreen,
  namespace: screenRequest.namespace,
  cmd: screenRequest.cmd,
  globalNamespace: globalRequest.namespace,
  globalCmd: globalRequest.cmd
};
"#,
    );

    assert_eq!(runtime["sameObject"], Value::Bool(true));
    assert_eq!(
        runtime["namespace"],
        Value::String("opentray.screen".to_string())
    );
    assert_eq!(
        runtime["cmd"],
        Value::String("getScreenDetails".to_string())
    );
    assert_eq!(
        runtime["globalNamespace"],
        Value::String("opentray.screen".to_string())
    );
    assert_eq!(
        runtime["globalCmd"],
        Value::String("getScreenDetails".to_string())
    );
}

#[test]
fn navigator_screen_runtime_keeps_prefixed_api_when_standard_screen_is_locked() {
    let runtime = run_node_probe_at_with_setup(
        &bootstrap_script(
            NavigatorWindowSettings::default(),
            NavigatorScreenSettings {
                enabled: true,
                bind_screen_globals: true,
            },
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
Object.defineProperty(navigator, "screen", {
  value: { width: 1440, height: 900 },
  configurable: false
});
"#,
        r#"
const screenPromise = navigator.opentrayScreen.getScreenDetails();
const screenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(screenRequest.callback, {
  currentScreen: null,
  screens: [],
  isExtended: false
});
await screenPromise;

return {
  standardScreenWidth: navigator.screen.width,
  hasPrefixedScreen: typeof navigator.opentrayScreen.getScreenDetails === "function",
  namespace: screenRequest.namespace,
  globalChanged: window.getScreenDetails !== originalGetScreenDetails
};
"#,
        "about:blank",
    );

    assert_eq!(runtime["standardScreenWidth"], Value::from(1440));
    assert_eq!(runtime["hasPrefixedScreen"], Value::Bool(true));
    assert_eq!(
        runtime["namespace"],
        Value::String("opentray.screen".to_string())
    );
    assert_eq!(runtime["globalChanged"], Value::Bool(true));
}

#[test]
fn navigator_window_metadata_runtime_supports_title_and_favicon_helpers() {
    let runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings {
                page_to_native: true,
                native_to_page: true,
            },
            MetadataSyncSettings {
                page_to_native: true,
                native_to_page: true,
            },
        ),
        r#"
const takeMessage = (cmd) => {
  const index = messages.findIndex((message) => message.cmd === cmd);
  return messages.splice(index, 1)[0];
};
const titlePromise = navigator.window.setTitle("Native Title");
const titleRequest = takeMessage("setTitle");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(titleRequest.callback, "Native Title");
await titlePromise;

window.__OPENTRAY_WINDOW_INTERNALS__.setDocumentTitle("Projected Title");
window.__OPENTRAY_WINDOW_INTERNALS__.setPageIconHref("data:image/png;base64,abc");
window.__OPENTRAY_WINDOW_INTERNALS__.setPageIconHref(null);

const iconPromise = navigator.window.setIcon({ type: "href", href: "data:image/png;base64,abc" });
const iconRequest = takeMessage("setIcon");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(iconRequest.callback, iconRequest.payload);
await iconPromise;

const clearIconPromise = navigator.window.setIcon(null);
const clearIconRequest = takeMessage("setIcon");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(clearIconRequest.callback, null);
const clearedIcon = await clearIconPromise;

return {
  titleCmd: titleRequest.cmd,
  titlePayload: titleRequest.payload.title,
  documentTitle: document.title,
  iconCmd: iconRequest.cmd,
  iconHref: iconRequest.payload.href,
  clearIconPayload: clearIconRequest.payload,
  clearedIcon,
  faviconCountAfterClear: document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]').length,
  syncNamespacePresent: injectedScript.includes("opentray.window.sync"),
  mutationObserverPresent: injectedScript.includes("MutationObserver")
};
"#,
    );

    assert_eq!(runtime["titleCmd"], Value::String("setTitle".to_string()));
    assert_eq!(
        runtime["titlePayload"],
        Value::String("Native Title".to_string())
    );
    assert_eq!(
        runtime["documentTitle"],
        Value::String("Projected Title".to_string())
    );
    assert_eq!(runtime["iconCmd"], Value::String("setIcon".to_string()));
    assert_eq!(
        runtime["iconHref"],
        Value::String("data:image/png;base64,abc".to_string())
    );
    assert_eq!(runtime["clearIconPayload"], Value::Null);
    assert_eq!(runtime["clearedIcon"], Value::Null);
    assert_eq!(runtime["faviconCountAfterClear"], Value::from(0));
    assert_eq!(runtime["syncNamespacePresent"], Value::Bool(true));
    assert_eq!(runtime["mutationObserverPresent"], Value::Bool(true));
}

#[test]
fn navigator_window_set_icon_payload_accepts_null_and_structured_icon() {
    assert_eq!(parse_set_icon_payload(Value::Null).unwrap(), None);

    let icon = parse_set_icon_payload(json!({
        "type": "href",
        "href": "data:image/png;base64,abc"
    }))
    .unwrap();
    assert_eq!(
        icon,
        Some(WebviewWindowIcon::Href {
            href: "data:image/png;base64,abc".to_string()
        })
    );
}

#[test]
fn navigator_window_runtime_unlistens_handlers_and_resolves_first_callback() {
    let runtime = run_node_probe(
        &bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: false,
            },
            NavigatorScreenSettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
        ),
        r#"
const invokePromise = navigator.window.invoke("ping", { hello: "world" });
const invokeRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(invokeRequest.callback, { ok: 1 });
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(invokeRequest.callback, { ok: 2 });
const invokeResult = await invokePromise;

const events = [];
const listenPromise = navigator.window.listen("resized", (event) => {
  events.push(event);
});
const listenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(listenRequest.callback, { eventId: 77 });
const unlisten = await listenPromise;
const handlerId = listenRequest.payload.handler;

window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(handlerId, {
  event: "resized",
  id: 77,
  payload: { width: 320, height: 200 }
});
await Promise.resolve();

const unlistenPromise = unlisten();
const unlistenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(unlistenRequest.callback, null);
await unlistenPromise;
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(handlerId, {
  event: "resized",
  id: 77,
  payload: { width: 640, height: 400 }
});
await Promise.resolve();

return {
  invokePayload: invokeResult,
  unlistenCmd: unlistenRequest.cmd,
  unlistenEventId: unlistenRequest.payload.eventId,
  eventCount: events.length,
  eventPayload: events[0]?.payload ?? null
};
"#,
    );

    assert_eq!(runtime["invokePayload"]["ok"], Value::from(1));
    assert_eq!(
        runtime["unlistenCmd"],
        Value::String("unlisten".to_string())
    );
    assert_eq!(runtime["unlistenEventId"], Value::from(77));
    assert_eq!(runtime["eventCount"], Value::from(1));
    assert_eq!(runtime["eventPayload"]["width"], Value::from(320));
    assert_eq!(runtime["eventPayload"]["height"], Value::from(200));
}

#[test]
fn navigator_window_request_shape_parses_inside_extension_runtime() {
    let request: NavigatorWindowRequest = serde_json::from_value(json!({
        "namespace": "opentray.window",
        "cmd": "resizeTo",
        "callback": 12,
        "error": 18,
        "payload": { "width": 420, "height": 280 },
        "options": { "source": "test" }
    }))
    .expect("navigator request");

    assert_eq!(request.namespace, "opentray.window");
    assert_eq!(request.cmd, "resizeTo");
    assert_eq!(request.callback, 12);
    assert_eq!(request.error, 18);
    assert_eq!(request.payload["width"], Value::from(420));
    assert_eq!(
        request.options.expect("options")["source"],
        Value::String("test".to_string())
    );
}

#[test]
fn macos_exec_command_accepts_windows_artifact_command_as_noop() {
    exec_page_command("clearWhiteBlock")
        .expect("macOS should accept the cross-platform low-level command channel");
    exec_page_command("clear-window-artifacts")
        .expect("macOS should accept command aliases used by the shared page bridge");

    let error = exec_page_command("unknownCommand").expect_err("unknown commands stay rejected");
    assert_eq!(
        error.to_string(),
        "unsupported page command: unknownCommand"
    );
}

#[test]
fn navigator_window_callback_scripts_use_private_run_callback() {
    let success = callback_script(7, &json!({ "ok": true })).expect("success callback");
    assert_eq!(
        success,
        format!("{WINDOW_INTERNALS_GLOBAL}.runCallback(7, {{\"ok\":true}});")
    );

    let rejected = error_callback_script(
        9,
        &WebviewRuntimeError::Unsupported(
            "background effect blur is not supported on macOS".into(),
        ),
    )
    .expect("error callback");
    assert!(rejected.contains(&format!("{WINDOW_INTERNALS_GLOBAL}.runCallback(9,")));
    assert!(rejected.contains("\"code\":\"unsupported\""));
    assert!(rejected.contains("\"message\":\"background effect blur is not supported on macOS\""));
}

#[test]
fn validate_style_request_accepts_transparency_and_rejects_unknown_effects() {
    validate_style_request(&SetStylePayload {
        frameless: None,
        resizable: None,
        keep_on_top: Some(true),
        opacity: Some(0.82),
        background: Some(WebviewBackgroundInput::Keyword("transparent".to_string())),
        platform: None,
    })
    .expect("transparent should be supported");

    validate_style_request(&SetStylePayload {
        frameless: None,
        resizable: None,
        keep_on_top: None,
        opacity: None,
        background: Some(WebviewBackgroundInput::Keyword("hudWindow".to_string())),
        platform: Some(SetStylePlatformPayload {
            macos: Some(SetStyleMacosPayload {
                corner_radius: Some(Some(18.0)),
            }),
            windows: None,
            linux: None,
        }),
    })
    .expect("known effect should be supported");

    let blur_error = validate_style_request(&SetStylePayload {
        frameless: None,
        resizable: None,
        keep_on_top: None,
        opacity: None,
        background: Some(WebviewBackgroundInput::Keyword("mica".to_string())),
        platform: None,
    })
    .expect_err("Windows material should be unsupported on macOS");
    assert_eq!(
        blur_error.to_string(),
        "background material mica is not supported on macOS"
    );

    let windows_error = validate_style_request(&SetStylePayload {
        frameless: None,
        resizable: None,
        keep_on_top: None,
        opacity: None,
        background: None,
        platform: Some(SetStylePlatformPayload {
            macos: None,
            windows: Some(SetStyleWindowsPayload {
                corner_preference: Some(Some("round".to_string())),
                show_in_switchers: None,
            }),
            linux: None,
        }),
    })
    .expect_err("windows platform style should be unsupported on macOS");
    assert_eq!(
        windows_error.to_string(),
        "platform.windows window style is not supported on macOS"
    );
}

#[test]
fn validate_initial_style_ignores_default_placeholder_platform_families() {
    validate_initial_style(&WebviewShowSettings::default())
        .expect("default placeholder platform families should not be rejected");
}

#[test]
fn window_style_state_serializes_keep_on_top() {
    let value = serde_json::to_value(WindowStyleState {
        frameless: false,
        resizable: true,
        resizable_override: None,
        keep_on_top: true,
        opacity: 0.82,
        background: WebviewWindowBackground::PlatformMaterial {
            material: "hudWindow".to_string(),
            state: WebviewBackgroundEffectState::Active,
        },
        platform: WindowPlatformStyleState {
            macos: MacosWindowStyleState {
                corner_radius: Some(18.0),
            },
        },
    })
    .expect("style state should serialize");

    assert_eq!(value["keepOnTop"], Value::Bool(true));
    assert_eq!(value["opacity"], Value::from(0.82));
    assert_eq!(
        value["background"]["kind"],
        Value::String("platformMaterial".to_string())
    );
    assert_eq!(
        value["background"]["material"],
        Value::String("hudWindow".to_string())
    );
    assert_eq!(
        value["background"]["state"],
        Value::String("active".to_string())
    );
    assert_eq!(
        value["platform"]["macos"]["cornerRadius"],
        Value::from(18.0)
    );
}

#[test]
fn navigator_window_bridge_tracks_listener_ids() {
    let mut bridge = NavigatorWindowBridge {
        webview: None,
        content_view: None,
        listeners: HashMap::new(),
        ipc_messages: VecDeque::new(),
        permission_messages: VecDeque::new(),
        window_events: VecDeque::new(),
        next_event_id: 1,
        next_ipc_message_id: 1,
        next_permission_message_id: 1,
        style: WindowStyleState {
            frameless: false,
            resizable: true,
            resizable_override: None,
            keep_on_top: false,
            opacity: 1.0,
            background: WebviewWindowBackground::Opaque,
            platform: WindowPlatformStyleState {
                macos: MacosWindowStyleState {
                    corner_radius: None,
                },
            },
        },
        navigator_window: NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        navigator_screen: NavigatorScreenSettings::default(),
        navigator_tray: NavigatorTraySettings::default(),
        metadata: WindowMetadataState {
            title: DEFAULT_WINDOW_TITLE.to_string(),
            icon: None,
            sync_title: MetadataSyncSettings::default(),
            sync_icon: MetadataSyncSettings::default(),
        },
        app_region_drag: AppRegionDragState::default(),
        devtools_enabled: false,
        download: WebviewDownloadSettings::default(),
        native_api_policy: WebviewNativeApiPolicy::default(),
        browser_permission_policy: WebviewBrowserPermissionPolicy::default(),
        permission_manager_policy: WebviewPermissionManagerPolicy::default(),
        page_source: PageSourceState::default(),
        page_access: PageCapabilityAccess::default(),
        tray_bounds: None,
        size_constraints: WindowSizeConstraints::default(),
    };

    let event_id = bridge.add_listener("resized".to_string(), 42);
    assert_eq!(event_id, 1);
    assert_eq!(bridge.listeners_for("resized").len(), 1);
    assert!(bridge.has_listener("resized"));
    assert!(!bridge.has_listener("overlay.geometrychange"));

    bridge.remove_listener("resized", event_id);
    assert!(bridge.listeners_for("resized").is_empty());
    assert!(!bridge.has_listener("resized"));
}

#[test]
fn multiple_downloads_policy_defaults_local_allow_and_remote_deny_on_macos() {
    assert_eq!(
        resolve_browser_permission_decision(
            &WebviewBrowserPermissionPolicy::default(),
            WebviewBrowserPermissionFamily::MultipleDownloads,
            &PageSourceState {
                url: None,
                host_html: true,
            },
        ),
        WebviewBrowserPermissionDecision::Allow
    );
    assert_eq!(
        resolve_browser_permission_decision(
            &WebviewBrowserPermissionPolicy::default(),
            WebviewBrowserPermissionFamily::MultipleDownloads,
            &PageSourceState {
                url: Some("https://tools.example/export".to_string()),
                host_html: false,
            },
        ),
        WebviewBrowserPermissionDecision::Deny
    );
}

#[test]
fn multiple_downloads_policy_respects_exact_remote_allow_rule_on_macos() {
    let policy = WebviewBrowserPermissionPolicy {
        rules: vec![WebviewBrowserPermissionRule {
            family: WebviewBrowserPermissionFamily::MultipleDownloads,
            sources: vec![WebviewNativeApiSource::Origin(
                "https://tools.example".to_string(),
            )],
            decision: WebviewBrowserPermissionDecision::Allow,
            prompt: false,
        }],
    };

    assert_eq!(
        resolve_browser_permission_decision(
            &policy,
            WebviewBrowserPermissionFamily::MultipleDownloads,
            &PageSourceState {
                url: Some("https://tools.example/export".to_string()),
                host_html: false,
            },
        ),
        WebviewBrowserPermissionDecision::Allow
    );
    assert_eq!(
        resolve_browser_permission_decision(
            &policy,
            WebviewBrowserPermissionFamily::MultipleDownloads,
            &PageSourceState {
                url: Some("https://other.example/export".to_string()),
                host_html: false,
            },
        ),
        WebviewBrowserPermissionDecision::Deny
    );
}

#[test]
fn emit_window_event_ignores_unlistened_download_events_on_macos() {
    let bridge = Rc::new(RefCell::new(NavigatorWindowBridge {
        webview: None,
        content_view: None,
        listeners: HashMap::new(),
        ipc_messages: VecDeque::new(),
        permission_messages: VecDeque::new(),
        window_events: VecDeque::new(),
        next_event_id: 1,
        next_ipc_message_id: 1,
        next_permission_message_id: 1,
        style: WindowStyleState {
            frameless: false,
            resizable: true,
            resizable_override: None,
            keep_on_top: false,
            opacity: 1.0,
            background: WebviewWindowBackground::Opaque,
            platform: WindowPlatformStyleState {
                macos: MacosWindowStyleState {
                    corner_radius: None,
                },
            },
        },
        navigator_window: NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        navigator_screen: NavigatorScreenSettings::default(),
        navigator_tray: NavigatorTraySettings::default(),
        metadata: WindowMetadataState {
            title: DEFAULT_WINDOW_TITLE.to_string(),
            icon: None,
            sync_title: MetadataSyncSettings::default(),
            sync_icon: MetadataSyncSettings::default(),
        },
        app_region_drag: AppRegionDragState::default(),
        devtools_enabled: false,
        download: WebviewDownloadSettings::default(),
        native_api_policy: WebviewNativeApiPolicy::default(),
        browser_permission_policy: WebviewBrowserPermissionPolicy::default(),
        permission_manager_policy: WebviewPermissionManagerPolicy::default(),
        page_source: PageSourceState::default(),
        page_access: PageCapabilityAccess::default(),
        tray_bounds: None,
        size_constraints: WindowSizeConstraints::default(),
    }));

    emit_window_event(
        &bridge,
        "downloadcompleted",
        serde_json::json!({
            "url": "https://tools.example/export",
            "filename": "report.json",
            "suggestedFilename": "report.json",
            "success": true,
        }),
    )
    .expect("unlistened events should be ignored before any bridge eval");
}

#[test]
fn app_region_drag_interaction_window_event_conserves_native_source() {
    let bridge = Rc::new(RefCell::new(NavigatorWindowBridge {
        webview: None,
        content_view: None,
        listeners: HashMap::new(),
        ipc_messages: VecDeque::new(),
        permission_messages: VecDeque::new(),
        window_events: VecDeque::new(),
        next_event_id: 1,
        next_ipc_message_id: 1,
        next_permission_message_id: 1,
        style: WindowStyleState {
            frameless: false,
            resizable: true,
            resizable_override: None,
            keep_on_top: false,
            opacity: 1.0,
            background: WebviewWindowBackground::Opaque,
            platform: WindowPlatformStyleState {
                macos: MacosWindowStyleState {
                    corner_radius: None,
                },
            },
        },
        navigator_window: NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        navigator_screen: NavigatorScreenSettings::default(),
        navigator_tray: NavigatorTraySettings::default(),
        metadata: WindowMetadataState {
            title: DEFAULT_WINDOW_TITLE.to_string(),
            icon: None,
            sync_title: MetadataSyncSettings::default(),
            sync_icon: MetadataSyncSettings::default(),
        },
        app_region_drag: AppRegionDragState::default(),
        devtools_enabled: false,
        download: WebviewDownloadSettings::default(),
        native_api_policy: WebviewNativeApiPolicy::default(),
        browser_permission_policy: WebviewBrowserPermissionPolicy::default(),
        permission_manager_policy: WebviewPermissionManagerPolicy::default(),
        page_source: PageSourceState::default(),
        page_access: PageCapabilityAccess::default(),
        tray_bounds: None,
        size_constraints: WindowSizeConstraints::default(),
    }));

    queue_window_interaction_event(&Rc::downgrade(&bridge), true);

    let state = bridge.borrow();
    assert_eq!(state.next_ipc_message_id, 1);
    assert!(state.ipc_messages.is_empty());
    assert_eq!(state.window_events.len(), 1);
    let message = &state.window_events[0];
    assert_eq!(
        message["type"],
        Value::String("windowinteractionchange".to_string())
    );
    assert_eq!(message["active"], Value::Bool(true));
}

#[test]
fn macos_initial_window_origin_uses_appkit_logical_points_directly() {
    let origin = initial_window_origin(
        NSSize::new(360.0, 240.0),
        opentray_spec::Rect {
            x: 320,
            y: 840,
            width: 40,
            height: 24,
        },
        &[ScreenPlacement {
            frame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1440.0, 900.0)),
            visible_frame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1440.0, 876.0)),
        }],
    )
    .expect("origin should resolve");

    assert_eq!(origin.x, 160.0);
    assert_eq!(origin.y, 592.0);
}

#[test]
fn initial_window_origin_places_panel_below_tray_in_global_macos_space() {
    let origin = initial_window_origin(
        NSSize::new(360.0, 248.0),
        opentray_spec::Rect {
            x: 0,
            y: 2490,
            width: 196,
            height: 60,
        },
        &[ScreenPlacement {
            frame: NSRect::new(NSPoint::new(0.0, 1440.0), NSSize::new(1728.0, 1117.0)),
            visible_frame: NSRect::new(NSPoint::new(0.0, 1440.0), NSSize::new(1728.0, 1085.0)),
        }],
    )
    .expect("origin should resolve");

    assert_eq!(origin.x, 0.0);
    assert_eq!(origin.y, 2234.0);
}

#[test]
fn initial_window_origin_clamps_to_visible_frame() {
    let origin = initial_window_origin(
        NSSize::new(360.0, 248.0),
        opentray_spec::Rect {
            x: 1500,
            y: 2490,
            width: 196,
            height: 60,
        },
        &[ScreenPlacement {
            frame: NSRect::new(NSPoint::new(0.0, 1440.0), NSSize::new(1728.0, 1117.0)),
            visible_frame: NSRect::new(NSPoint::new(0.0, 1440.0), NSSize::new(1728.0, 1085.0)),
        }],
    )
    .expect("origin should resolve");

    assert_eq!(origin.x, 1368.0);
    assert_eq!(origin.y, 2234.0);
}

fn run_node_probe(script: &str, probe: &str) -> Value {
    run_node_probe_at(script, probe, "about:blank")
}

fn run_node_probe_at(script: &str, probe: &str, location_href: &str) -> Value {
    run_node_probe_at_with_setup(script, "", probe, location_href)
}

fn run_node_probe_at_with_setup(
    script: &str,
    setup: &str,
    probe: &str,
    location_href: &str,
) -> Value {
    let injected_script = serde_json::to_string(script).expect("serialize injected script");
    let location_href = serde_json::to_string(location_href).expect("serialize location href");
    let program = format!(
        r#"
const messages = [];
const originalClose = () => "close";
const originalMoveTo = () => "move";
const originalResizeTo = () => "resize";
const originalGetScreenDetails = () => "screen";
let nextRandom = 1;
const windowObject = {{
  close: originalClose,
  moveTo: originalMoveTo,
  resizeTo: originalResizeTo,
  getScreenDetails: originalGetScreenDetails,
  location: {{
    href: {location_href}
  }},
  ipc: {{
    postMessage(payload) {{
      messages.push(JSON.parse(payload));
    }}
  }},
  crypto: {{
    getRandomValues(values) {{
      values[0] = nextRandom++;
      return values;
    }}
  }}
}};
try {{
  delete globalThis.navigator;
}} catch (_error) {{}}
globalThis.document = {{
  readyState: "complete",
  title: "OpenTray",
  head: {{
    querySelector() {{
      return null;
    }},
    appendChild() {{}}
  }},
  documentElement: {{}},
  querySelectorAll() {{
    return [];
  }},
  createElement() {{
    return {{
      setAttribute() {{}},
      href: null,
      getAttribute() {{
        return null;
      }}
    }};
  }},
  addEventListener() {{}},
  removeEventListener() {{}}
}};
globalThis.MutationObserver = class {{
  constructor(callback) {{
    this.callback = callback;
  }}
  observe() {{}}
  disconnect() {{}}
}};
Object.defineProperty(globalThis, "navigator", {{
  value: {{}},
  configurable: true,
  writable: true
}});
globalThis.window = windowObject;
globalThis.messages = messages;
{setup}
const injectedScript = {injected_script};
eval(injectedScript);
const result = await (async () => {{
{probe}
}})();
process.stdout.write(JSON.stringify(result));
"#,
    );

    let output = Command::new("node")
        .arg("--input-type=module")
        .arg("--eval")
        .arg(program)
        .output()
        .expect("node must be available to validate injected navigator runtime behavior");
    assert!(
        output.status.success(),
        "node probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("node probe returned JSON")
}
