use opentray_spec::webview::WebviewBridgePolicy;
use serde_json::json;

use crate::{
    MetadataSyncSettings, NavigatorScreenSettings, NavigatorTraySettings, NavigatorWindowSettings,
    WebviewNativeApiPolicy, WebviewNativeApiSource, WebviewPermissionManagerPolicy,
};

/// Per-webview bridge bootstrap (add-webview-orchestration D2): a child
/// webview's navigator surfaces are injected only when its frozen
/// per-webview bridge policy enables them. A policy-less child (every field
/// defaults to false) gets no script at all — the arbitrary-content webview
/// is bridgeless by default. The policy is bootstrap-immutable for the
/// webview's lifetime, mirroring the session compatibility law.
///
/// The `navigator.opentrayWebview` surface (D9/D2) joins here: `id` when
/// `webviewId` is enabled, and the message-channel methods
/// (`createMessageChannel` / `onCreatedMessageChannel` /
/// `listMessageChannels`, plus the per-endpoint `post` / `onMessage` /
/// `onClose` / `close` / `destroy` objects) when `messageChannels` is
/// enabled. The script still projects the `navigatorWindow`/
/// `navigatorScreen` fields onto the existing bootstrap.
pub(crate) fn webview_bridge_bootstrap_script(
    policy: WebviewBridgePolicy,
    webview_id: &str,
    favicon_observer: bool,
) -> Option<String> {
    let has_bridge_surface = policy.webview_id
        || policy.message_channels
        || policy.navigator_window
        || policy.navigator_screen
        || policy.native_api;
    if !has_bridge_surface {
        return None;
    }
    Some(navigator_window_bootstrap_script(
        NavigatorWindowSettings {
            enabled: policy.navigator_window,
            bind_window_globals: false,
            window_controls_overlay: false,
        },
        false,
        false,
        NavigatorScreenSettings {
            enabled: policy.navigator_screen,
            bind_screen_globals: false,
        },
        NavigatorTraySettings::default(),
        MetadataSyncSettings::default(),
        MetadataSyncSettings::default(),
        &WebviewNativeApiPolicy::default(),
        &WebviewPermissionManagerPolicy::default(),
        policy.message_channels,
        policy.webview_id,
        webview_id,
        favicon_observer,
    ))
}

/// Favicon observation for a bridgeless webview whose create options enable
/// `favicon`: a self-contained initialization script that only watches the
/// icon link elements and reports through the private sync namespace. It
/// exposes no bridge surface — no `navigator.opentray*` property, no channel
/// or id surface — so the arbitrary-content default of the per-view bridge
/// policy is preserved; the host opted into exactly one observation.
pub(crate) fn favicon_observe_only_script() -> String {
    r#"(function () {
  let faviconObserver;
  let faviconDomReadyListener;
  let lastObservedFaviconHref;
  const readActiveFaviconHref = () => {
    const links = Array.from(
      document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')
    );
    const iconLink = links[links.length - 1];
    if (!iconLink) return null;
    return iconLink.href || iconLink.getAttribute("href") || null;
  };
  const reportFavicon = () => {
    const href = readActiveFaviconHref();
    if (href === lastObservedFaviconHref) return;
    lastObservedFaviconHref = href;
    window.ipc.postMessage(JSON.stringify({
      namespace: "opentray.window.sync",
      cmd: "pageIconChanged",
      callback: 0,
      error: 0,
      payload: { href }
    }));
  };
  const start = () => {
    reportFavicon();
    if (faviconObserver) return;
    faviconObserver = new MutationObserver(reportFavicon);
    faviconObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["rel", "href"]
    });
  };
  if (document.readyState === "loading") {
    faviconDomReadyListener = () => {
      faviconDomReadyListener = undefined;
      start();
    };
    document.addEventListener("DOMContentLoaded", faviconDomReadyListener, { once: true });
    return;
  }
  start();
})();"#
        .to_string()
}

pub(crate) fn navigator_window_bootstrap_script(
    window_settings: NavigatorWindowSettings,
    soft_resize_enabled: bool,
    window_region_resize_enabled: bool,
    screen_settings: NavigatorScreenSettings,
    tray_settings: NavigatorTraySettings,
    title_sync: MetadataSyncSettings,
    icon_sync: MetadataSyncSettings,
    native_api_policy: &WebviewNativeApiPolicy,
    permission_manager_policy: &WebviewPermissionManagerPolicy,
    message_channels_enabled: bool,
    webview_id_enabled: bool,
    webview_id: &str,
    favicon_observer: bool,
) -> String {
    let window_enabled = js_bool(window_settings.enabled);
    let soft_resize_enabled = js_bool(soft_resize_enabled);
    let window_region_resize = js_bool(window_region_resize_enabled);
    let bind_window_globals = js_bool(window_settings.bind_window_globals);
    let window_controls_overlay = js_bool(window_settings.window_controls_overlay);
    let screen_enabled = js_bool(screen_settings.enabled);
    let bind_screen_globals = js_bool(screen_settings.bind_screen_globals);
    let tray_enabled = js_bool(tray_settings.enabled);
    let title_page_to_native = js_bool(title_sync.page_to_native);
    let title_native_to_page = js_bool(title_sync.native_to_page);
    let icon_page_to_native = js_bool(icon_sync.page_to_native);
    let icon_native_to_page = js_bool(icon_sync.native_to_page);
    let favicon_observer = js_bool(favicon_observer);
    let message_channels_enabled = js_bool(message_channels_enabled);
    let webview_id_enabled = js_bool(webview_id_enabled);
    let webview_id_json =
        serde_json::to_string(webview_id).expect("webview id serialization should not fail");
    let native_api_policy_json = native_api_policy_json(native_api_policy);
    let permission_manager_policy_json = permission_manager_policy_json(permission_manager_policy);
    r#"(function () {
  const requestedWindowEnabled = __OPENTRAY_WINDOW_ENABLED__;
  const requestedSoftResizeEnabled = __OPENTRAY_SOFT_RESIZE_ENABLED__;
  const requestedWindowRegionResize = __OPENTRAY_WINDOW_REGION_RESIZE__;
  const requestedBindWindowGlobals = __OPENTRAY_BIND_GLOBALS__;
  const requestedWindowControlsOverlay = __OPENTRAY_WINDOW_CONTROLS_OVERLAY__;
  const requestedScreenEnabled = __OPENTRAY_SCREEN_ENABLED__;
  const requestedBindScreenGlobals = __OPENTRAY_BIND_SCREEN_GLOBALS__;
  const requestedTrayEnabled = __OPENTRAY_TRAY_ENABLED__;
  const requestedTitleSyncPageToNative = __OPENTRAY_TITLE_PAGE_TO_NATIVE__;
  const requestedTitleSyncNativeToPage = __OPENTRAY_TITLE_NATIVE_TO_PAGE__;
  const requestedIconSyncPageToNative = __OPENTRAY_ICON_PAGE_TO_NATIVE__;
  const requestedIconSyncNativeToPage = __OPENTRAY_ICON_NATIVE_TO_PAGE__;
  const requestedFaviconObserver = __OPENTRAY_FAVICON_OBSERVER__;
  const requestedMessageChannelsEnabled = __OPENTRAY_MESSAGE_CHANNELS_ENABLED__;
  const requestedWebviewIdEnabled = __OPENTRAY_WEBVIEW_ID_ENABLED__;
  const channelWebviewId = __OPENTRAY_WEBVIEW_ID__;
  const capabilityPolicy = __OPENTRAY_NATIVE_API_POLICY__;
  const permissionManagerPolicy = __OPENTRAY_PERMISSION_MANAGER_POLICY__;
  const INTERNALS_KEY = "__OPENTRAY_WINDOW_INTERNALS__";
  const WINDOW_API_KEY = "__OPENTRAY_WINDOW_API__";
  const SCREEN_API_KEY = "__OPENTRAY_SCREEN_API__";
  const TRAY_API_KEY = "__OPENTRAY_TRAY_API__";
  const PERMISSIONS_API_KEY = "__OPENTRAY_PERMISSIONS_API__";
  const isLoopbackHost = (host) =>
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  const resolvePageSource = () => {
    const href = typeof window.location?.href === "string" ? window.location.href : "";
    try {
      const url = new URL(href);
      const scheme = url.protocol.replace(/:$/, "");
      if (scheme === "file" || scheme === "data" || scheme === "about") {
        return { kind: "local", origin: null };
      }
      if ((scheme === "http" || scheme === "https") && isLoopbackHost(url.hostname)) {
        return { kind: "local", origin: null };
      }
      if (scheme === "http" || scheme === "https") {
        return { kind: "remote", origin: url.origin };
      }
      return { kind: "remote", origin: null };
    } catch (_error) {
      return { kind: "remote", origin: null };
    }
  };
  const ruleMatches = (rule, source) => {
    if (rule === "'none'") return false;
    if (rule === "*") return true;
    if (rule === "'local'") return source.kind === "local";
    if (rule === "'remote'") return source.kind === "remote";
    return source.kind === "remote" && source.origin === rule;
  };
  const directiveAllows = (directive) => {
    const rules = capabilityPolicy[directive] ?? capabilityPolicy.defaultSrc ?? ["'local'"];
    const source = resolvePageSource();
    return Array.isArray(rules) && rules.some((rule) => ruleMatches(rule, source));
  };
  const permissionManagerAllows = () => {
    const source = resolvePageSource();
    if (source.kind === "remote") {
      return Array.isArray(permissionManagerPolicy.remoteOrigins) &&
        source.origin !== null &&
        permissionManagerPolicy.remoteOrigins.includes(source.origin);
    }
    const rules = permissionManagerPolicy.defaultSrc ?? ["'local'"];
    return Array.isArray(rules) && rules.some((rule) => ruleMatches(rule, source));
  };
  const windowEnabled = requestedWindowEnabled && directiveAllows("window");
      let windowControlsOverlay = requestedWindowControlsOverlay && windowEnabled;
  const bindWindowGlobals =
    requestedBindWindowGlobals && windowEnabled && directiveAllows("windowGlobals");
  const screenEnabled = requestedScreenEnabled && directiveAllows("screen");
  const bindScreenGlobals =
    requestedBindScreenGlobals && screenEnabled && directiveAllows("screenGlobals");
  const trayEnabled = requestedTrayEnabled && directiveAllows("tray");
  const titleSyncPageToNative =
    requestedTitleSyncPageToNative && directiveAllows("titleSync");
  const titleSyncNativeToPage =
    requestedTitleSyncNativeToPage && directiveAllows("titleSync");
  const iconSyncPageToNative =
    requestedIconSyncPageToNative && directiveAllows("iconSync");
  // add-navigation-favicon-surface: the per-view `favicon` create option is
  // an explicit host opt-in independent of the window-icon metadata sync
  // (and of any page directive): it only reports the observation, never
  // mutates the window icon.
  const faviconObserverEnabled = requestedFaviconObserver;
  const iconSyncNativeToPage =
    requestedIconSyncNativeToPage && directiveAllows("iconSync");
  const permissionManagerEnabled = permissionManagerAllows();
  if (!window[INTERNALS_KEY]) {
    const callbacks = new Map();
    const windowDomListeners = Object.create(null);
    let fallbackId = 1;
    let lastObservedFaviconHref;
    let faviconObserver;
    let faviconDomReadyListener;
    let softResizeEnabled = false;
    const softResizeEdgeAt = (event) => {
      if (!softResizeEnabled) return null;
      const x = finiteNumber(event?.clientX);
      const y = finiteNumber(event?.clientY);
      const width = finiteNumber(window.innerWidth);
      const height = finiteNumber(window.innerHeight);
      if (x === undefined || y === undefined || !width || !height) return null;
      const left = x <= 6;
      const right = x >= width - 6;
      const top = y <= 6;
      const bottom = y >= height - 6;
      if (top) {
        if (left) return 'topLeft';
        if (right) return 'topRight';
        return 'top';
      }
      if (bottom) {
        if (left) return 'bottomLeft';
        if (right) return 'bottomRight';
        return 'bottom';
      }
      if (left) return 'left';
      if (right) return 'right';
      return null;
    };
    const softResizeCursor = (edge) => {
      if (edge === 'topLeft' || edge === 'bottomRight') return 'nwse-resize';
      if (edge === 'topRight' || edge === 'bottomLeft') return 'nesw-resize';
      if (edge === 'left' || edge === 'right') return 'ew-resize';
      if (edge === 'top' || edge === 'bottom') return 'ns-resize';
      return '';
    };
    const setSoftResizeCursor = (edge) => {
      const root = document.documentElement;
      if (!root || !root.style) return;
      root.style.cursor = softResizeCursor(edge);
    };
    const postSoftResizeStart = (edge) => {
      window.ipc.postMessage(JSON.stringify({
        namespace: 'opentray.window.internal',
        cmd: 'startSoftResize',
        callback: 0,
        error: 0,
        payload: { edge }
      }));
    };
    // ---- declarative window region binding (bindWindowRegion) ----
    // Behaviors: 'auto' (platform caption semantics: move+zoom), 'none',
    // 'move', 'zoom', and `resize-<edge>` handles. Element-bound only: a press
    // triggers behavior when its target IS a bound element (strict match), so
    // descendants stay ordinary page content unless independently bound.
    const windowRegionResizeSupported = requestedWindowRegionResize;
    const WINDOW_REGION_DOUBLE_CLICK_MS = 500;
    const WINDOW_REGION_DOUBLE_CLICK_SLOP_PX = 6;
    const WINDOW_REGION_RESIZE_EDGE = /^(top|right|bottom|left|top-left|top-right|bottom-left|bottom-right)$/;
    const windowRegionBoundElements = new WeakMap();
    const normalizeWindowRegionBehavior = (input) => {
      const normalizedInput = input === undefined || input === null ? "auto" : input;
      const list = Array.isArray(normalizedInput) ? normalizedInput : [normalizedInput];
      const raw = Array.isArray(normalizedInput) ? normalizedInput : list[0];
      if (list.length === 0) {
        throw new TypeError("bindWindowRegion requires at least one behavior");
      }
      if (list.length === 1 && (list[0] === "auto" || list[0] === "none")) {
        return { raw, behaviors: list[0] === "auto" ? ["move", "zoom"] : [] };
      }
      if (list.includes("auto") || list.includes("none")) {
        throw new TypeError("'auto' and 'none' cannot combine with other window region behaviors");
      }
      const behaviors = [];
      let resizeEdge = null;
      for (const item of list) {
        if (typeof item !== "string") {
          throw new TypeError("window region behaviors must be strings");
        }
        if (item === "move" || item === "zoom") {
          if (!behaviors.includes(item)) behaviors.push(item);
          continue;
        }
        const resizeMatch = /^resize-(.+)$/.exec(item);
        if (resizeMatch) {
          if (!WINDOW_REGION_RESIZE_EDGE.test(resizeMatch[1])) {
            throw new TypeError(`unsupported resize edge: ${resizeMatch[1]}`);
          }
          if (!windowRegionResizeSupported) {
            throw new TypeError("resize window region behaviors are not supported on this platform");
          }
          if (resizeEdge !== null) {
            throw new TypeError("bindWindowRegion accepts at most one resize edge");
          }
          resizeEdge = resizeMatch[1];
          continue;
        }
        throw new TypeError(`unsupported window region behavior: ${item}`);
      }
      if (resizeEdge !== null) behaviors.push(`resize:${resizeEdge}`);
      return { raw, behaviors };
    };
    const isWindowRegionElement = (value) =>
      value !== null &&
      typeof value === "object" &&
      typeof value.addEventListener === "function" &&
      typeof value.removeEventListener === "function";
    const queryWindowRegionSelector = (root, selector) => {
      if (!root || typeof root.querySelectorAll !== "function") {
        throw new TypeError("window region root must provide querySelectorAll");
      }
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch (_error) {
        throw new TypeError(`invalid window region selector: ${selector}`);
      }
    };
    const resolveWindowRegionTargets = (target) => {
      if (isWindowRegionElement(target)) return [target];
      if (Array.isArray(target)) {
        if (target.length === 0) {
          throw new TypeError("bindWindowRegion target array must not be empty");
        }
        if (target.some((item) => !isWindowRegionElement(item))) {
          throw new TypeError("window region target arrays must contain only elements");
        }
        return Array.from(new Set(target));
      }
      if (typeof target === "string") {
        return queryWindowRegionSelector(document, target);
      }
      if (target !== null && typeof target === "object" && typeof target.selector === "string") {
        return queryWindowRegionSelector(target.root === undefined ? document : target.root, target.selector);
      }
      throw new TypeError(
        "bindWindowRegion requires an element, element array, selector, or { root, selector }"
      );
    };
    const windowRegionSoftResizeEdge = (edge) =>
      edge.replace(/-(.)/g, (_match, char) => char.toUpperCase());
    document.addEventListener('pointermove', (event) => {
      setSoftResizeCursor(softResizeEdgeAt(event));
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (event.isTrusted !== true || event.isPrimary === false || event.button !== 0) return;
      const edge = softResizeEdgeAt(event);
      if (!edge) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      postSoftResizeStart(edge);
    }, true);
    const originalWindowFns = {
      close: window.close,
      moveTo: window.moveTo,
      resizeTo: window.resizeTo,
      getScreenDetails: window.getScreenDetails
    };
    const nextCallbackId = () => {
      if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        return window.crypto.getRandomValues(new Uint32Array(1))[0];
      }
      return fallbackId++;
    };
    const registerCallback = (callback, once = false) => {
      const id = nextCallbackId();
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id);
        if (typeof callback === "function") callback(data);
      });
      return id;
    };
    const unregisterCallback = (id) => {
      callbacks.delete(id);
    };
    const runCallback = (id, data) => {
      const callback = callbacks.get(id);
      if (callback) callback(data);
    };
    const invokeWithNamespace = (namespace, cmd, payload = {}, options) =>
      new Promise((resolve, reject) => {
        const callback = registerCallback((response) => {
          unregisterCallback(error);
          resolve(response);
        }, true);
        const error = registerCallback((response) => {
          unregisterCallback(callback);
          reject(response);
        }, true);
        window.ipc.postMessage(
          JSON.stringify({
            namespace,
            cmd,
            callback,
            error,
            payload,
            options
          })
        );
      });
    const normalizeBackground = (background, options) => {
      const state =
        options && typeof options === "object" && typeof options.state === "string"
          ? options.state
          : undefined;
      if (typeof background === "string") {
        if (background === "opaque" || background === "default" || background === "none") {
          return { kind: "opaque" };
        }
        if (background === "transparent") {
          return { kind: "transparent" };
        }
        if (background === "blur") {
          return state ? { kind: "semantic", token: "blur", state } : { kind: "semantic", token: "blur" };
        }
        return state
          ? { kind: "platformMaterial", material: background, state }
          : { kind: "platformMaterial", material: background };
      }
      if (background && typeof background === "object") {
        return state ? { ...background, state } : background;
      }
      return { kind: "opaque" };
    };
    const invoke = (cmd, payload = {}, options) =>
      invokeWithNamespace("opentray.window", cmd, payload, options);
    const finiteNumber = (value) =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const overlayCssScaleForPhysicalPayload = (rect) => {
      const clientWidth = finiteNumber(rect?.clientWidth);
      const innerWidth = finiteNumber(window.innerWidth);
      if (clientWidth && clientWidth > 0 && innerWidth && innerWidth > 0) {
        return innerWidth / clientWidth;
      }
      const dpr = finiteNumber(window.devicePixelRatio);
      return dpr && dpr > 0 ? 1 / dpr : 1;
    };
    const normalizeOverlayTitlebarAreaRect = (rect) => {
      if (!rect || typeof rect !== "object" || rect.unit !== "physical") {
        return rect;
      }
      const scale = overlayCssScaleForPhysicalPayload(rect);
      const rawX = finiteNumber(rect.x) ?? 0;
      const rawY = finiteNumber(rect.y) ?? 0;
      const rawWidth = finiteNumber(rect.width) ?? 0;
      const rawHeight = finiteNumber(rect.height) ?? 0;
      const x = Math.max(0, Math.ceil(rawX * scale));
      const y = Math.max(0, Math.floor(rawY * scale));
      const right = Math.max(x, Math.floor((rawX + rawWidth) * scale));
      return {
        x,
        y,
        width: Math.max(0, right - x),
        height: rawHeight > 0 ? Math.max(1, Math.ceil(rawHeight * scale)) : 0
      };
    };
    const normalizeOverlayEventData = (eventData) => {
      const payload =
        eventData && typeof eventData === "object" && "payload" in eventData
          ? eventData.payload
          : eventData;
      if (payload && typeof payload === "object" && payload.titlebarAreaRect) {
        return {
          ...payload,
          titlebarAreaRect: normalizeOverlayTitlebarAreaRect(payload.titlebarAreaRect)
        };
      }
      return payload;
    };
    const createOverlayApi = (windowApi) => {
      const overlayDomListeners = Object.create(null);
      const overlayEventName = (event) => `overlay.${event}`;
      const overlay = {
        get visible() {
          return windowControlsOverlay;
        },
        getTitlebarAreaRect() {
          return invoke("getTitlebarAreaRect").then(normalizeOverlayTitlebarAreaRect);
        },
        async listen(event, handler) {
          return windowApi.listen(overlayEventName(event), (eventData) => {
            if (typeof handler !== "function") return;
            handler(normalizeOverlayEventData(eventData));
          });
        },
        async once(event, handler) {
          let unlisten = async () => {};
          unlisten = await overlay.listen(event, async (eventData) => {
            await unlisten();
            if (typeof handler === "function") handler(eventData);
          });
          return unlisten;
        },
        addEventListener(event, handler) {
          const eventListeners = (overlayDomListeners[event] ??= new Map());
          if (eventListeners.has(handler)) return;
          const pending = overlay.listen(event, handler).then((unlisten) => {
            eventListeners.set(handler, unlisten);
            return unlisten;
          });
          eventListeners.set(handler, pending);
        },
        removeEventListener(event, handler) {
          const eventListeners = overlayDomListeners[event];
          if (!eventListeners) return;
          const unlisten = eventListeners.get(handler);
          eventListeners.delete(handler);
          if (typeof unlisten === "function") {
            void unlisten();
            return;
          }
          if (unlisten && typeof unlisten.then === "function") {
            void unlisten.then((resolved) => {
              if (typeof resolved === "function") {
                return resolved();
              }
            });
          }
        }
      };
      return Object.freeze(overlay);
    };
      const createWindowApi = (config = {}) => {
        if (window[WINDOW_API_KEY]) return window[WINDOW_API_KEY];
        const overlayEnabled = Boolean(config.windowControlsOverlay);
        const api = {
        invoke,
        devtools: Object.freeze({
          open() {
            return invoke("openDevtools");
          },
          close() {
            return invoke("closeDevtools");
          },
          isOpen() {
            return invoke("isDevtoolsOpen");
          }
        }),
        async listen(event, handler) {
          const handlerId = registerCallback((eventData) => {
            if (typeof handler === "function") handler(eventData);
          });
          const result = await invoke("listen", { event, handler: handlerId });
          const eventId =
            result && typeof result.eventId === "number" ? result.eventId : handlerId;
          return async () => {
            unregisterCallback(handlerId);
            await invoke("unlisten", { event, eventId });
          };
        },
        async once(event, handler) {
          let unlisten = async () => {};
          unlisten = await api.listen(event, async (eventData) => {
            await unlisten();
            if (typeof handler === "function") handler(eventData);
          });
          return unlisten;
        },
        close() {
          return invoke("close");
        },
        show() {
          return invoke("show");
        },
        hide() {
          return invoke("hide");
        },
        isClosed() {
          return invoke("isClosed");
        },
        isVisible() {
          return invoke("isVisible");
        },
        toVisible() {
          return invoke("toVisible");
        },
        focus() {
          return invoke("focus");
        },
        minimize() {
          return invoke("minimize");
        },
        maximize() {
          return invoke("maximize");
        },
        restore() {
          return invoke("restore");
        },
        getWindowState() {
          return invoke("getWindowState");
        },
        isMaximized() {
          return invoke("isMaximized");
        },
        isMinimized() {
          return invoke("isMinimized");
        },
        move(x, y) {
          return invoke("move", { x, y });
        },
        moveTo(x, y) {
          return invoke("moveTo", { x, y });
        },
        resize(width, height) {
          return invoke("resize", { width, height });
        },
        resizeTo(width, height) {
          return invoke("resizeTo", { width, height });
        },
        getBounds() {
          return invoke("getBounds");
        },
        setMinimumWidth(width) {
          return invoke("setMinimumSize", { width });
        },
        setMinimumHeight(height) {
          return invoke("setMinimumSize", { height });
        },
        setMinimumSize(width, height) {
          const payload = {};
          if (width !== undefined) payload.width = width;
          if (height !== undefined) payload.height = height;
          return invoke("setMinimumSize", payload);
        },
        setMaximumWidth(width) {
          return invoke("setMaximumSize", { width });
        },
        setMaximumHeight(height) {
          return invoke("setMaximumSize", { height });
        },
        setMaximumSize(width, height) {
          const payload = {};
          if (width !== undefined) payload.width = width;
          if (height !== undefined) payload.height = height;
          return invoke("setMaximumSize", payload);
        },
        startAppRegionDrag(options) {
          return invoke("startAppRegionDrag", options ?? {});
        },
        stopAppRegionDrag() {
          return invoke("stopAppRegionDrag");
        },
        bindWindowRegion(target, options) {
          const behaviorInput =
            options !== null && typeof options === "object" && !Array.isArray(options)
              ? options.behavior
              : options;
          const initial = normalizeWindowRegionBehavior(behaviorInput);
          const state = { raw: initial.raw, behaviors: initial.behaviors, lastPress: null };
          const targets = resolveWindowRegionTargets(target);
          const entries = targets.map((element) => {
            const listener = (event) => {
              if (event.target !== element) return;
              if (event.isTrusted !== true || event.isPrimary === false || event.button !== 0) return;
              const behaviors = state.behaviors;
              if (behaviors.length === 0) return;
              const resizeEntry = behaviors.find((item) => item.startsWith("resize:"));
              if (resizeEntry !== undefined) {
                event.preventDefault();
                postSoftResizeStart(windowRegionSoftResizeEdge(resizeEntry.slice("resize:".length)));
                return;
              }
              const now =
                window.performance && typeof window.performance.now === "function"
                  ? window.performance.now()
                  : Date.now();
              if (behaviors.includes("zoom")) {
                const previous = state.lastPress;
                state.lastPress = null;
                if (
                  previous !== null &&
                  now - previous.t <= WINDOW_REGION_DOUBLE_CLICK_MS &&
                  Math.abs(event.clientX - previous.x) <= WINDOW_REGION_DOUBLE_CLICK_SLOP_PX &&
                  Math.abs(event.clientY - previous.y) <= WINDOW_REGION_DOUBLE_CLICK_SLOP_PX
                ) {
                  invoke("getWindowState")
                    .then((snapshot) =>
                      snapshot && snapshot.state === "maximized"
                        ? invoke("restore")
                        : invoke("maximize")
                    )
                    .catch(() => {});
                  return;
                }
                state.lastPress = { t: now, x: event.clientX, y: event.clientY };
              }
              if (behaviors.includes("move")) {
                invoke("startAppRegionDrag", {
                  x: event.clientX,
                  y: event.clientY,
                  pointerId: event.pointerId
                }).catch(() => {});
              }
            };
            element.addEventListener("pointerdown", listener);
            const detachElement = () => {
              if (windowRegionBoundElements.get(element) === detachElement) {
                windowRegionBoundElements.delete(element);
              }
              element.removeEventListener("pointerdown", listener);
            };
            const previousDetach = windowRegionBoundElements.get(element);
            if (typeof previousDetach === "function") previousDetach();
            windowRegionBoundElements.set(element, detachElement);
            return detachElement;
          });
          let detached = false;
          const detach = () => {
            if (detached) return;
            detached = true;
            for (const detachElement of entries) detachElement();
          };
          return Object.freeze({
            unbind() {
              detach();
            },
            setBehavior(input) {
              const next = normalizeWindowRegionBehavior(input);
              state.raw = next.raw;
              state.behaviors = next.behaviors;
              state.lastPress = null;
            },
            get behavior() {
              return state.raw;
            }
          });
        },
        getStyle() {
          return invoke("getStyle");
        },
        setStyle(style) {
          return invoke("setStyle", style ?? {});
        },
        setBackground(background, options) {
          return invoke("setStyle", { background: normalizeBackground(background, options) });
        },
        getCapabilities() {
          return invoke("getCapabilities");
        },
        getTitle() {
          return invoke("getTitle");
        },
        setTitle(title) {
          return invoke("setTitle", { title });
        },
        getIcon() {
          return invoke("getIcon");
        },
        setIcon(icon) {
          return invoke("setIcon", icon ?? null);
        },
        addEventListener(event, handler) {
          const eventListeners = (windowDomListeners[event] ??= new Map());
          if (eventListeners.has(handler)) return;
          const pending = api.listen(event, handler).then((unlisten) => {
            eventListeners.set(handler, unlisten);
            return unlisten;
          });
          eventListeners.set(handler, pending);
        },
        removeEventListener(event, handler) {
          const eventListeners = windowDomListeners[event];
          if (!eventListeners) return;
          const unlisten = eventListeners.get(handler);
          eventListeners.delete(handler);
          if (typeof unlisten === "function") {
            void unlisten();
            return;
          }
          if (unlisten && typeof unlisten.then === "function") {
            void unlisten.then((resolved) => {
              if (typeof resolved === "function") {
                return resolved();
              }
            });
          }
        }
      };
      if (overlayEnabled) {
        Object.defineProperty(api, "overlay", {
          value: createOverlayApi(api),
          enumerable: true,
          configurable: false
        });
      }
      Object.freeze(api);
      Object.defineProperty(window, WINDOW_API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const createScreenApi = () => {
      if (window[SCREEN_API_KEY]) return window[SCREEN_API_KEY];
      const api = {
        getScreenDetails() {
          return invokeWithNamespace("opentray.screen", "getScreenDetails");
        }
      };
      Object.freeze(api);
      Object.defineProperty(window, SCREEN_API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const createTrayApi = () => {
      if (window[TRAY_API_KEY]) return window[TRAY_API_KEY];
      const api = {
        getBounds() {
          return invokeWithNamespace("opentray.tray", "getBounds");
        }
      };
      Object.freeze(api);
      Object.defineProperty(window, TRAY_API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const createIpcApi = () => {
      const api = {
        postMessage(payload) {
          return invokeWithNamespace("opentray.ipc", "postMessage", payload ?? null);
        }
      };
      return Object.freeze(api);
    };
    const currentPermissionSource = () => {
      const source = resolvePageSource();
      return source.kind === "local"
        ? { type: "local" }
        : { type: "origin", origin: source.origin || "" };
    };
    const createPermissionsApi = () => {
      if (window[PERMISSIONS_API_KEY]) return window[PERMISSIONS_API_KEY];
      const invokePermission = (action, family, options = {}) =>
        invokeWithNamespace("opentray.permissions", action, {
          source: currentPermissionSource(),
          family,
          ...options
        });
      const api = {
        query(family) {
          return invokePermission("query", family);
        },
        request(family) {
          return invokePermission("request", family, {
            sourceAction: "opentrayPermissions.request"
          });
        },
        set(family, decision) {
          return invokePermission("set", family, {
            decision,
            sourceAction: "opentrayPermissions.set"
          });
        },
        clear(family) {
          return invokePermission("clear", family);
        }
      };
      Object.freeze(api);
      Object.defineProperty(window, PERMISSIONS_API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const createCommandApi = () => {
      const execCommand = (command) => {
        if (typeof command !== "string" || command.length === 0) return;
        window.ipc.postMessage(
          JSON.stringify({
            namespace: "opentray.command",
            cmd: "execCommand",
            callback: 0,
            error: 0,
            payload: { command }
          })
        );
      };
      return execCommand;
    };
    // Message channels (D9-D11/D20): page-side endpoint state. The broker
    // is the transport root; every push arrives through the internals
    // entry points below so pages never poll. Lifecycle pushes that land
    // before the page registers its handlers stay buffered (bounded by the
    // broker-side queue budget) and flush on registration.
    let channelSurfaceWebviewId = "";
    const channelEndpoints = new Map();
    const pendingChannelCreated = [];
    let channelCreatedHandler;
    const channelEndpointState = (channelId) => {
      let state = channelEndpoints.get(channelId);
      if (!state) {
        state = {
          messageHandlers: [],
          closeHandlers: [],
          // Port-style buffering (the model D11 rehabilitates from
          // MessageChannel): pushes that outrun the page's subscription
          // queue here in FIFO order and flush through the first
          // onMessage/onClose registration, so a fast peer posting right
          // after create can never silently drop.
          pendingMessages: [],
          pendingClose: null
        };
        channelEndpoints.set(channelId, state);
      }
      return state;
    };
    const deliverChannelMessages = (state) => {
      if (state.messageHandlers.length === 0 || state.pendingMessages.length === 0) return;
      const pending = state.pendingMessages.splice(0, state.pendingMessages.length);
      for (const payload of pending) {
        const handlers = state.messageHandlers.slice();
        for (const handler of handlers) {
          try {
            handler(payload);
          } catch (_error) {}
        }
      }
    };
    // Single-observation cardinality: at most one close notice per
    // endpoint; handlers registered after the transition observe the
    // buffered notice exactly once, later transitions stay silent.
    const settleChannelClose = (channelId, state) => {
      if (state.pendingClose === null || state.closeHandlers.length === 0) return;
      const reason = state.pendingClose;
      state.pendingClose = null;
      channelEndpoints.delete(channelId);
      const handlers = state.closeHandlers.slice();
      for (const handler of handlers) {
        try {
          handler({ reason });
        } catch (_error) {}
      }
    };
    const makeChannelEndpoint = (channelId) => {
      channelEndpointState(channelId);
      const invokeChannel = (cmd, payload) =>
        invokeWithNamespace("opentray.webview", cmd, payload);
      return Object.freeze({
        id: channelId,
        post(payload) {
          return invokeChannel("postMessage", { channelId, payload });
        },
        onMessage(handler) {
          const state = channelEndpointState(channelId);
          if (typeof handler !== "function") return () => {};
          state.messageHandlers.push(handler);
          deliverChannelMessages(state);
          let active = true;
          return () => {
            if (!active) return;
            active = false;
            state.messageHandlers = state.messageHandlers.filter((h) => h !== handler);
          };
        },
        onClose(handler) {
          const state = channelEndpointState(channelId);
          if (typeof handler !== "function") return () => {};
          state.closeHandlers.push(handler);
          settleChannelClose(channelId, state);
          let active = true;
          return () => {
            if (!active) return;
            active = false;
            state.closeHandlers = state.closeHandlers.filter((h) => h !== handler);
          };
        },
        close() {
          return invokeChannel("closeMessageChannel", { channelId });
        },
        destroy() {
          return invokeChannel("destroyMessageChannel", { channelId });
        }
      });
    };
    const flushChannelCreated = () => {
      // Without a registered handler the endpoints stay buffered — a
      // created push that lands early must not be lost with the drain.
      if (typeof channelCreatedHandler !== "function") return;
      while (pendingChannelCreated.length > 0) {
        const endpoint = pendingChannelCreated.shift();
        try {
          channelCreatedHandler(endpoint);
        } catch (_error) {}
      }
    };
    const createWebviewChannelApi = (config = {}) => {
      const api = {};
      if (config.webviewIdEnabled) {
        Object.defineProperty(api, "id", {
          get: () => channelSurfaceWebviewId,
          enumerable: true
        });
      }
      if (config.messageChannelsEnabled) {
        api.createMessageChannel = (options) => {
          const target = options && typeof options === "object" ? options.target : options;
          if (typeof target !== "string" || target.length === 0) {
            return Promise.reject({
              code: "unknown_view",
              message: "createMessageChannel requires a target webview id"
            });
          }
          return invokeWithNamespace("opentray.webview", "createMessageChannel", { target })
            .then((result) =>
              makeChannelEndpoint(
                result && typeof result.channelId === "string" ? result.channelId : ""
              )
            );
        };
        api.onCreatedMessageChannel = (handler) => {
          if (typeof handler !== "function") return;
          channelCreatedHandler = handler;
          flushChannelCreated();
        };
        api.listMessageChannels = () =>
          invokeWithNamespace("opentray.webview", "listMessageChannels", {}).then((result) =>
            Array.isArray(result && result.channels) ? result.channels : []
          );
      }
      return Object.freeze(api);
    };
    const readActiveFaviconHref = () => {
      const links = Array.from(
        document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')
      );
      const iconLink = links[links.length - 1];
      if (!iconLink) return null;
      return iconLink.href || iconLink.getAttribute("href") || null;
    };
    const pageIconSelector = 'link[rel~="icon"], link[rel="shortcut icon"]';
    const setPageIconHref = (href) => {
      const head = document.head || document.documentElement;
      if (!head) return;
      if (!href) {
        for (const iconLink of Array.from(document.querySelectorAll(pageIconSelector))) {
          iconLink.remove();
        }
        return;
      }
      let iconLink =
        head.querySelector('link[rel~="icon"]') ||
        head.querySelector('link[rel="shortcut icon"]');
      if (!iconLink) {
        iconLink = document.createElement("link");
        iconLink.setAttribute("rel", "icon");
        head.appendChild(iconLink);
      }
      iconLink.setAttribute("href", href);
    };
    const emitPageIconIfNeeded = () => {
      if (!iconSyncPageToNative && !faviconObserverEnabled) return;
      const href = readActiveFaviconHref();
      if (href === lastObservedFaviconHref) return;
      lastObservedFaviconHref = href;
      void invokeWithNamespace("opentray.window.sync", "pageIconChanged", { href });
    };
    const teardownFaviconObserver = () => {
      if (faviconObserver) {
        faviconObserver.disconnect();
        faviconObserver = undefined;
      }
      if (faviconDomReadyListener) {
        document.removeEventListener("DOMContentLoaded", faviconDomReadyListener);
        faviconDomReadyListener = undefined;
      }
    };
    const ensureFaviconObserver = () => {
      if (!iconSyncPageToNative && !faviconObserverEnabled) {
        teardownFaviconObserver();
        return;
      }
      if (faviconObserver) {
        emitPageIconIfNeeded();
        return;
      }
      const start = () => {
        emitPageIconIfNeeded();
        if (faviconObserver) return;
        faviconObserver = new MutationObserver(() => {
          emitPageIconIfNeeded();
        });
        faviconObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["rel", "href"]
        });
      };
      if (document.readyState === "loading") {
        faviconDomReadyListener = () => {
          faviconDomReadyListener = undefined;
          start();
        };
        document.addEventListener("DOMContentLoaded", faviconDomReadyListener, { once: true });
        return;
      }
      start();
    };
    const restoreGlobals = () => {
      try {
        window.close = originalWindowFns.close;
        window.moveTo = originalWindowFns.moveTo;
        window.resizeTo = originalWindowFns.resizeTo;
        window.getScreenDetails = originalWindowFns.getScreenDetails;
      } catch (_) {}
    };
    const defineBridgeProperty = (target, key, descriptor) => {
      try {
        Object.defineProperty(target, key, descriptor);
        return true;
      } catch (_error) {
        return false;
      }
    };
    const install = (config) => {
      restoreGlobals();
      let opentrayApi;
      if (config && config.windowEnabled) {
        windowControlsOverlay = Boolean(config.windowControlsOverlay);
        const api = createWindowApi(config);
        defineBridgeProperty(navigator, "opentrayWindow", {
          value: api,
          configurable: true
        });
        defineBridgeProperty(navigator, "window", {
          value: api,
          configurable: true
        });
        opentrayApi ??= {};
        defineBridgeProperty(opentrayApi, "window", {
          value: api,
          configurable: true
        });
        if (config.bindWindowGlobals) {
          // Global overrides are opt-in because they intentionally change standard browser behavior.
          try {
            window.close = () => {
              void api.close();
            };
            window.moveTo = (x, y) => {
              void api.moveTo(Number(x), Number(y));
            };
            window.resizeTo = (width, height) => {
              void api.resizeTo(Number(width), Number(height));
            };
          } catch (_) {}
        }
      }
      if (config && config.screenEnabled) {
        const screenApi = createScreenApi();
        defineBridgeProperty(navigator, "opentrayScreen", {
          value: screenApi,
          configurable: true
        });
        defineBridgeProperty(navigator, "screen", {
          value: screenApi,
          configurable: true
        });
        opentrayApi ??= {};
        defineBridgeProperty(opentrayApi, "screen", {
          value: screenApi,
          configurable: true
        });
        if (config.bindScreenGlobals) {
          try {
            window.getScreenDetails = () => screenApi.getScreenDetails();
          } catch (_) {}
        }
      }
      if (config && config.trayEnabled) {
        const trayApi = createTrayApi();
        opentrayApi ??= {};
        defineBridgeProperty(opentrayApi, "tray", {
          value: trayApi,
          configurable: true
        });
      }
      opentrayApi ??= {};
      defineBridgeProperty(opentrayApi, "ipc", {
        value: createIpcApi(),
        configurable: true
      });
      defineBridgeProperty(opentrayApi, "execCommand", {
        value: createCommandApi(),
        configurable: true
      });
      if (config && (config.webviewIdEnabled || config.messageChannelsEnabled)) {
        defineBridgeProperty(navigator, "opentrayWebview", {
          value: createWebviewChannelApi(config),
          configurable: true
        });
      }
      if (config && config.permissionManagerEnabled) {
        const permissionsApi = createPermissionsApi();
        defineBridgeProperty(navigator, "opentrayPermissions", {
          value: permissionsApi,
          configurable: true
        });
        defineBridgeProperty(opentrayApi, "permissions", {
          value: permissionsApi,
          configurable: true
        });
      }
      if (opentrayApi) {
        defineBridgeProperty(navigator, "opentray", {
          value: Object.freeze(opentrayApi),
          configurable: true
        });
      }
      ensureFaviconObserver();
    };
    const uninstall = () => {
      try {
        delete navigator.window;
        delete navigator.opentrayWindow;
        delete navigator.screen;
        delete navigator.opentrayScreen;
        delete navigator.opentray;
        delete navigator.opentrayPermissions;
        delete navigator.opentrayWebview;
      } catch (_) {}
      teardownFaviconObserver();
      restoreGlobals();
    };
    Object.defineProperty(window, INTERNALS_KEY, {
      value: Object.freeze({
        registerCallback,
        unregisterCallback,
        runCallback,
        invoke,
        invokeWithNamespace,
        setDocumentTitle(title) {
          if (!titleSyncNativeToPage || typeof title !== "string") return;
          document.title = title;
        },
        setSoftResizeEnabled(enabled) {
          softResizeEnabled = enabled === true;
          if (!softResizeEnabled) setSoftResizeCursor(null);
        },
        setPageIconHref,
        setChannelSurface(enabled, webviewId) {
          channelSurfaceWebviewId = typeof webviewId === "string" ? webviewId : "";
          void enabled;
        },
        channelCreated(channelId) {
          if (typeof channelId !== "string") return;
          pendingChannelCreated.push(makeChannelEndpoint(channelId));
          flushChannelCreated();
        },
        channelMessage(channelId, payload) {
          if (typeof channelId !== "string") return;
          const state = channelEndpointState(channelId);
          // A closed endpoint never delivers new messages; pre-closure
          // buffered ones still flush in order on subscription.
          if (state.pendingClose !== null) return;
          state.pendingMessages.push(payload);
          deliverChannelMessages(state);
        },
        channelClosed(channelId, reason) {
          if (typeof channelId !== "string") return;
          const state = channelEndpointState(channelId);
          if (state.pendingClose !== null) return;
          // Buffered pre-closure messages stay queued in order — a late
          // subscriber still observes `m1, m2, close`; only messages after
          // the notice (blocked above) never deliver.
          state.pendingClose = reason;
          settleChannelClose(channelId, state);
        },
        install,
        uninstall
      }),
      configurable: false
    });
  }
  const internals = window[INTERNALS_KEY];
  internals.setSoftResizeEnabled(requestedSoftResizeEnabled);
  internals.setChannelSurface(requestedMessageChannelsEnabled, channelWebviewId);
  if (
    windowEnabled ||
    screenEnabled ||
    trayEnabled ||
    permissionManagerEnabled ||
    titleSyncPageToNative ||
    titleSyncNativeToPage ||
    iconSyncPageToNative ||
    iconSyncNativeToPage ||
    requestedMessageChannelsEnabled ||
    requestedWebviewIdEnabled
  ) {
    internals.install({
      windowEnabled,
      bindWindowGlobals,
      windowControlsOverlay,
      screenEnabled,
      bindScreenGlobals,
      trayEnabled,
      permissionManagerEnabled,
      messageChannelsEnabled: requestedMessageChannelsEnabled,
      webviewIdEnabled: requestedWebviewIdEnabled
    });
  } else {
    internals.uninstall();
  }
})();"#
        .replace("__OPENTRAY_WINDOW_ENABLED__", window_enabled)
        .replace("__OPENTRAY_SOFT_RESIZE_ENABLED__", soft_resize_enabled)
        .replace("__OPENTRAY_WINDOW_REGION_RESIZE__", window_region_resize)
        .replace("__OPENTRAY_BIND_GLOBALS__", bind_window_globals)
        .replace("__OPENTRAY_WINDOW_CONTROLS_OVERLAY__", window_controls_overlay)
        .replace("__OPENTRAY_SCREEN_ENABLED__", screen_enabled)
        .replace("__OPENTRAY_BIND_SCREEN_GLOBALS__", bind_screen_globals)
        .replace("__OPENTRAY_TRAY_ENABLED__", tray_enabled)
        .replace("__OPENTRAY_TITLE_PAGE_TO_NATIVE__", title_page_to_native)
        .replace("__OPENTRAY_TITLE_NATIVE_TO_PAGE__", title_native_to_page)
        .replace("__OPENTRAY_ICON_PAGE_TO_NATIVE__", icon_page_to_native)
        .replace("__OPENTRAY_ICON_NATIVE_TO_PAGE__", icon_native_to_page)
        .replace("__OPENTRAY_FAVICON_OBSERVER__", favicon_observer)
        .replace("__OPENTRAY_MESSAGE_CHANNELS_ENABLED__", message_channels_enabled)
        .replace("__OPENTRAY_WEBVIEW_ID_ENABLED__", webview_id_enabled)
        .replace("__OPENTRAY_WEBVIEW_ID__", &webview_id_json)
        .replace("__OPENTRAY_NATIVE_API_POLICY__", &native_api_policy_json)
        .replace(
            "__OPENTRAY_PERMISSION_MANAGER_POLICY__",
            &permission_manager_policy_json,
        )
}

fn js_bool(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn native_api_policy_json(policy: &WebviewNativeApiPolicy) -> String {
    serde_json::to_string(&json!({
        "defaultSrc": native_api_sources_json(&policy.default_src),
        "window": policy.window.as_ref().map(|rules| native_api_sources_json(rules)),
        "screen": policy.screen.as_ref().map(|rules| native_api_sources_json(rules)),
        "tray": policy.tray.as_ref().map(|rules| native_api_sources_json(rules)),
        "windowGlobals": policy.window_globals.as_ref().map(|rules| native_api_sources_json(rules)),
        "screenGlobals": policy.screen_globals.as_ref().map(|rules| native_api_sources_json(rules)),
        "titleSync": policy.title_sync.as_ref().map(|rules| native_api_sources_json(rules)),
        "iconSync": policy.icon_sync.as_ref().map(|rules| native_api_sources_json(rules)),
    }))
    .expect("native api policy serialization should not fail")
}

fn permission_manager_policy_json(policy: &WebviewPermissionManagerPolicy) -> String {
    serde_json::to_string(&json!({
        "defaultSrc": native_api_sources_json(&policy.default_src),
        "remoteOrigins": policy.remote_origins,
    }))
    .expect("permission manager policy serialization should not fail")
}

fn native_api_sources_json(rules: &[WebviewNativeApiSource]) -> Vec<String> {
    rules.iter().map(native_api_source_token).collect()
}

fn native_api_source_token(rule: &WebviewNativeApiSource) -> String {
    match rule {
        WebviewNativeApiSource::None => "'none'".to_string(),
        WebviewNativeApiSource::Any => "*".to_string(),
        WebviewNativeApiSource::Local => "'local'".to_string(),
        WebviewNativeApiSource::Remote => "'remote'".to_string(),
        WebviewNativeApiSource::Origin(origin) => origin.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::Value;

    use super::*;

    #[test]
    fn overlay_rect_normalizes_windows_physical_payload_to_css_px() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const takeMessage = (cmd) => {
  const index = messages.findIndex((message) => message.cmd === cmd);
  return messages.splice(index, 1)[0];
};
const rectPromise = navigator.opentrayWindow.overlay.getTitlebarAreaRect();
const rectRequest = takeMessage("getTitlebarAreaRect");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(rectRequest.callback, {
  unit: "physical",
  x: 20,
  y: 0,
  width: 730,
  height: 64,
  clientWidth: 1000,
  clientHeight: 700
});
return {
  rect: await rectPromise,
  namespace: rectRequest.namespace
};
"#,
        );

        assert_eq!(
            runtime["namespace"],
            Value::String("opentray.window".to_string())
        );
        assert_eq!(runtime["rect"]["x"], Value::from(10));
        assert_eq!(runtime["rect"]["y"], Value::from(0));
        assert_eq!(runtime["rect"]["width"], Value::from(365));
        assert_eq!(runtime["rect"]["height"], Value::from(32));
    }

    #[test]
    fn overlay_geometry_event_normalizes_windows_physical_payload_to_css_px() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const takeMessage = (cmd) => {
  const index = messages.findIndex((message) => message.cmd === cmd);
  return messages.splice(index, 1)[0];
};
let eventPayload = null;
const listenPromise = navigator.opentrayWindow.overlay.listen("geometrychange", (event) => {
  eventPayload = event;
});
const listenRequest = takeMessage("listen");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(listenRequest.callback, { eventId: 7 });
await listenPromise;
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(listenRequest.payload.handler, {
  event: "overlay.geometrychange",
  id: 7,
  payload: {
    titlebarAreaRect: {
      unit: "physical",
      x: 0,
      y: 0,
      width: 800,
      height: 60,
      clientWidth: 1000,
      clientHeight: 700
    }
  }
});
return eventPayload;
"#,
        );

        assert_eq!(runtime["titlebarAreaRect"]["x"], Value::from(0));
        assert_eq!(runtime["titlebarAreaRect"]["width"], Value::from(400));
        assert_eq!(runtime["titlebarAreaRect"]["height"], Value::from(30));
    }

    #[test]
    fn overlay_rect_keeps_legacy_css_payload_unchanged() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
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
return await rectPromise;
"#,
        );

        assert_eq!(runtime["x"], Value::from(72));
        assert_eq!(runtime["width"], Value::from(420));
        assert_eq!(runtime["height"], Value::from(44));
    }

    #[test]
    fn overlay_rect_keeps_zero_physical_geometry_empty() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const takeMessage = (cmd) => {
  const index = messages.findIndex((message) => message.cmd === cmd);
  return messages.splice(index, 1)[0];
};
const rectPromise = navigator.opentrayWindow.overlay.getTitlebarAreaRect();
const rectRequest = takeMessage("getTitlebarAreaRect");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(rectRequest.callback, {
  unit: "physical",
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  clientWidth: 0,
  clientHeight: 0
});
return await rectPromise;
"#,
        );

        assert_eq!(runtime["width"], Value::from(0));
        assert_eq!(runtime["height"], Value::from(0));
    }

    #[test]
    fn window_region_default_behavior_moves_on_direct_press() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
};
const element = makeElement();
const handle = navigator.opentrayWindow.bindWindowRegion(element);
const press = (target) => {
  for (const { listener } of element.listeners) {
    listener({
      isTrusted: true,
      isPrimary: true,
      button: 0,
      target,
      clientX: 120,
      clientY: 16,
      pointerId: 3,
      preventDefault() {}
    });
  }
};
press(element);
press({ child: true });
return {
  behavior: handle.behavior,
  dragRequests: messages
    .filter((message) => message.cmd === "startAppRegionDrag")
    .map((message) => ({ namespace: message.namespace, payload: message.payload }))
};
"#,
        );

        // Default 'auto' resolves to the caption pair; only the press whose
        // target IS the bound element triggers behavior.
        assert_eq!(runtime["behavior"], Value::String("auto".to_string()));
        let requests = runtime["dragRequests"]
            .as_array()
            .expect("drag requests array");
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0]["namespace"],
            Value::String("opentray.window".to_string())
        );
        assert_eq!(requests[0]["payload"]["x"], Value::from(120));
        assert_eq!(requests[0]["payload"]["pointerId"], Value::from(3));
    }

    #[test]
    fn window_region_double_click_pairs_into_zoom_toggle() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
};
const element = makeElement();
navigator.opentrayWindow.bindWindowRegion(element, { behavior: "auto" });
let clock = 0;
window.performance = { now: () => clock };
const press = (x, y) => {
  for (const { listener } of element.listeners) {
    listener({
      isTrusted: true,
      isPrimary: true,
      button: 0,
      target: element,
      clientX: x,
      clientY: y,
      pointerId: 1,
      preventDefault() {}
    });
  }
};
press(40, 10);
clock += 200;
press(42, 12);
const stateRequest = messages.find((message) => message.cmd === "getWindowState");
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(stateRequest.callback, { state: "normal" });
await new Promise((resolve) => setTimeout(resolve, 20));
return {
  dragCount: messages.filter((message) => message.cmd === "startAppRegionDrag").length,
  stateAsked: Boolean(stateRequest),
  maximized: messages.some((message) => message.cmd === "maximize"),
  restored: messages.some((message) => message.cmd === "restore")
};
"#,
        );

        // First press of the pair drags; the second zooms via state dispatch.
        assert_eq!(runtime["dragCount"], Value::from(1));
        assert_eq!(runtime["stateAsked"], Value::Bool(true));
        assert_eq!(runtime["maximized"], Value::Bool(true));
        assert_eq!(runtime["restored"], Value::Bool(false));
    }

    #[test]
    fn window_region_expired_or_moved_press_does_not_pair() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener(type, listener) {}
  };
};
const element = makeElement();
navigator.opentrayWindow.bindWindowRegion(element, "auto");
let clock = 0;
window.performance = { now: () => clock };
const press = (x, y) => {
  for (const { listener } of element.listeners) {
    listener({
      isTrusted: true, isPrimary: true, button: 0, target: element,
      clientX: x, clientY: y, pointerId: 1, preventDefault() {}
    });
  }
};
press(10, 10);
clock += 900;
press(12, 10);
press(500, 10);
return {
  dragCount: messages.filter((message) => message.cmd === "startAppRegionDrag").length,
  stateAsked: messages.some((message) => message.cmd === "getWindowState")
};
"#,
        );

        // Expired pair and far-away press both stay plain moves; no zoom query.
        assert_eq!(runtime["dragCount"], Value::from(3));
        assert_eq!(runtime["stateAsked"], Value::Bool(false));
    }

    #[test]
    fn window_region_resize_handle_posts_internal_soft_resize() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener(type, listener) {}
  };
};
const element = makeElement();
const handle = navigator.opentrayWindow.bindWindowRegion(element, "resize-bottom-right");
let prevented = false;
for (const { listener } of element.listeners) {
  listener({
    isTrusted: true, isPrimary: true, button: 0, target: element,
    clientX: 8, clientY: 300, pointerId: 1,
    preventDefault() { prevented = true; }
  });
}
return {
  behavior: handle.behavior,
  prevented,
  softResize: messages
    .filter((message) => message.cmd === "startSoftResize")
    .map((message) => ({ namespace: message.namespace, edge: message.payload.edge }))
};
"#,
        );

        assert_eq!(
            runtime["behavior"],
            Value::String("resize-bottom-right".to_string())
        );
        assert_eq!(runtime["prevented"], Value::Bool(true));
        let requests = runtime["softResize"].as_array().expect("soft resize array");
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0]["namespace"],
            Value::String("opentray.window.internal".to_string())
        );
        // kebab-case behavior edges normalize to the bridge's camelCase vocabulary.
        assert_eq!(
            requests[0]["edge"],
            Value::String("bottomRight".to_string())
        );
    }

    #[test]
    fn window_region_resize_rejected_where_unsupported() {
        let runtime = run_node_probe(
            &window_region_bootstrap_script(false),
            r#"
const element = {
  listeners: [],
  addEventListener(type, listener) { this.listeners.push(listener); },
  removeEventListener() {}
};
try {
  navigator.opentrayWindow.bindWindowRegion(element, ["move", "resize-top-left"]);
  return { error: null };
} catch (error) {
  return { error: String(error) };
}
"#,
        );

        let error = runtime["error"].as_str().expect("bind error message");
        assert!(error.contains("not supported"), "unexpected error: {error}");
    }

    #[test]
    fn window_region_behavior_validation_rejects_bad_input() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const element = {
  addEventListener() {},
  removeEventListener() {}
};
const attempt = (input) => {
  try {
    navigator.opentrayWindow.bindWindowRegion(element, input);
    return null;
  } catch (error) {
    return String(error);
  }
};
return {
  bareResize: attempt("resize"),
  badEdge: attempt("resize-middle"),
  mixedNone: attempt(["move", "none"]),
  mixedAuto: attempt(["auto", "zoom"]),
  emptyArray: attempt([]),
  nonString: attempt([42])
};
"#,
        );

        for key in [
            "bareResize",
            "badEdge",
            "mixedNone",
            "mixedAuto",
            "emptyArray",
            "nonString",
        ] {
            let error = runtime[key]
                .as_str()
                .unwrap_or_else(|| panic!("bindWindowRegion accepted invalid input for {key}"));
            assert!(
                error.contains("TypeError"),
                "unexpected error for {key}: {error}"
            );
        }
    }

    #[test]
    fn window_region_set_behavior_none_pauses_and_restores() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener() {}
  };
};
const element = makeElement();
const handle = navigator.opentrayWindow.bindWindowRegion(element, "auto");
const press = () => {
  for (const { listener } of element.listeners) {
    listener({
      isTrusted: true, isPrimary: true, button: 0, target: element,
      clientX: 5, clientY: 5, pointerId: 1, preventDefault() {}
    });
  }
};
press();
handle.setBehavior("none");
press();
handle.setBehavior("move");
press();
return {
  behavior: handle.behavior,
  dragCount: messages.filter((message) => message.cmd === "startAppRegionDrag").length
};
"#,
        );

        assert_eq!(runtime["behavior"], Value::String("move".to_string()));
        assert_eq!(runtime["dragCount"], Value::from(2));
    }

    #[test]
    fn window_region_rebind_replaces_previous_binding() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
};
const element = makeElement();
const first = navigator.opentrayWindow.bindWindowRegion(element, "auto");
const second = navigator.opentrayWindow.bindWindowRegion(element, "move");
const press = () => {
  for (const { listener } of element.listeners) {
    listener({
      isTrusted: true, isPrimary: true, button: 0, target: element,
      clientX: 7, clientY: 7, pointerId: 1, preventDefault() {}
    });
  }
};
press();
first.unbind();
return {
  listenerCount: element.listeners.length,
  dragCount: messages.filter((message) => message.cmd === "startAppRegionDrag").length
};
"#,
        );

        // The second bind detached the first element listener; one press posts once.
        assert_eq!(runtime["listenerCount"], Value::from(1));
        assert_eq!(runtime["dragCount"], Value::from(1));
    }

    #[test]
    fn window_region_selector_targets_snapshot_and_rejects_invalid_selectors() {
        let runtime = run_node_probe(
            &overlay_bootstrap_script(),
            r#"
const makeElement = () => ({
  listeners: [],
  addEventListener(type, listener) { this.listeners.push(listener); },
  removeEventListener() {}
});
const strip = makeElement();
const icon = makeElement();
document.querySelectorAll = (selector) => {
  if (selector === ".bad[") {
    // The real DOM rejects unparsable selectors; the stub must model that.
    throw new Error("not a valid selector");
  }
  return selector === ".titlebar > *" ? [strip, icon] : [];
};
const handle = navigator.opentrayWindow.bindWindowRegion(".titlebar > *", "move");
const noMatch = navigator.opentrayWindow.bindWindowRegion(".missing", "move");
let invalidError = null;
try {
  navigator.opentrayWindow.bindWindowRegion(".bad[", "move");
} catch (error) {
  invalidError = String(error);
}
return {
  boundCount: strip.listeners.length + icon.listeners.length,
  noMatchBehavior: noMatch.behavior,
  invalidError
};
"#,
        );

        assert_eq!(runtime["boundCount"], Value::from(2));
        assert_eq!(
            runtime["noMatchBehavior"],
            Value::String("move".to_string())
        );
        let error = runtime["invalidError"]
            .as_str()
            .expect("invalid selector error");
        assert!(
            error.contains("invalid window region selector"),
            "unexpected: {error}"
        );
    }

    fn window_region_bootstrap_script(window_region_resize: bool) -> String {
        navigator_window_bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: true,
            },
            false,
            window_region_resize,
            NavigatorScreenSettings::default(),
            NavigatorTraySettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
            &WebviewNativeApiPolicy::default(),
            &Default::default(),
            false,
            false,
            "default",
            false,
        )
    }

    fn overlay_bootstrap_script() -> String {
        window_region_bootstrap_script(true)
    }

    fn channel_bootstrap_script() -> String {
        webview_bridge_bootstrap_script(
            WebviewBridgePolicy {
                webview_id: true,
                message_channels: true,
                ..WebviewBridgePolicy::default()
            },
            "toolbar",
            false,
        )
        .expect("channel policy injects the bridge")
    }

    #[test]
    fn channel_on_close_unlisten_actually_unsubscribes() {
        // Final-review B2 regression: the generated unlisten arrow function
        // lost its `=>` and threw ReferenceError when executed, leaving the
        // handler subscribed forever.
        let runtime = run_node_probe(
            &channel_bootstrap_script(),
            r#"
const internals = window.__OPENTRAY_WINDOW_INTERNALS__;
let observed = null;
navigator.opentrayWebview.onCreatedMessageChannel((endpoint) => {
  const unlisten = endpoint.onClose((event) => {
    observed = event.reason;
  });
  unlisten();
});
internals.channelCreated("ch-b2");
internals.channelClosed("ch-b2", "explicit");
return { observed };
"#,
        );
        assert_eq!(
            runtime["observed"],
            Value::Null,
            "the unsubscribed handler must not observe the close"
        );
    }

    #[test]
    fn channel_on_close_unlisten_keeps_a_surviving_handler() {
        // The unlisten of one handler must not break a sibling subscription.
        let runtime = run_node_probe(
            &channel_bootstrap_script(),
            r#"
const internals = window.__OPENTRAY_WINDOW_INTERNALS__;
let observed = null;
navigator.opentrayWebview.onCreatedMessageChannel((endpoint) => {
  const unlisten = endpoint.onClose((event) => {
    observed = "first:" + event.reason;
  });
  unlisten();
  endpoint.onClose((event) => {
    observed = "second:" + event.reason;
  });
});
internals.channelCreated("ch-b2b");
internals.channelClosed("ch-b2b", "peer_webview_destroyed");
return { observed };
"#,
        );
        assert_eq!(
            runtime["observed"],
            Value::from("second:peer_webview_destroyed")
        );
    }

    fn run_node_probe(script: &str, probe: &str) -> Value {
        let injected_script = serde_json::to_string(script).expect("serialize injected script");
        let program = format!(
            r#"
const messages = [];
const windowObject = {{
  innerWidth: 500,
  innerHeight: 360,
  devicePixelRatio: 2,
  close() {{}},
  moveTo() {{}},
  resizeTo() {{}},
  location: {{
    href: "about:blank"
  }},
  ipc: {{
    postMessage(payload) {{
      messages.push(JSON.parse(payload));
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
const injectedScript = {injected_script};
eval(injectedScript);
const result = await (async () => {{
{probe}
}})();
process.stdout.write(JSON.stringify(result));
"#,
        );

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let script_path = std::env::temp_dir().join(format!(
            "opentray-bootstrap-probe-{}-{nonce}.mjs",
            std::process::id()
        ));
        fs::write(&script_path, program).expect("node probe script should be writable");
        let output = Command::new("node")
            .arg(&script_path)
            .output()
            .expect("node must be available to validate injected navigator runtime behavior");
        let _ = fs::remove_file(&script_path);
        assert!(
            output.status.success(),
            "node probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).expect("node probe returned JSON")
    }
}
