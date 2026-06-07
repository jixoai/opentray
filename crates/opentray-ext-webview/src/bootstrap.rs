use serde_json::json;

use crate::{
    MetadataSyncSettings, NavigatorScreenSettings, NavigatorTraySettings, NavigatorWindowSettings,
    WebviewNativeApiPolicy, WebviewNativeApiSource,
};

pub(crate) fn navigator_window_bootstrap_script(
    window_settings: NavigatorWindowSettings,
    screen_settings: NavigatorScreenSettings,
    tray_settings: NavigatorTraySettings,
    title_sync: MetadataSyncSettings,
    icon_sync: MetadataSyncSettings,
    native_api_policy: &WebviewNativeApiPolicy,
) -> String {
    let window_enabled = js_bool(window_settings.enabled);
    let bind_window_globals = js_bool(window_settings.bind_window_globals);
    let window_controls_overlay = js_bool(window_settings.window_controls_overlay);
    let screen_enabled = js_bool(screen_settings.enabled);
    let bind_screen_globals = js_bool(screen_settings.bind_screen_globals);
    let tray_enabled = js_bool(tray_settings.enabled);
    let title_page_to_native = js_bool(title_sync.page_to_native);
    let title_native_to_page = js_bool(title_sync.native_to_page);
    let icon_page_to_native = js_bool(icon_sync.page_to_native);
    let icon_native_to_page = js_bool(icon_sync.native_to_page);
    let native_api_policy_json = native_api_policy_json(native_api_policy);
    r#"(function () {
  const requestedWindowEnabled = __OPENTRAY_WINDOW_ENABLED__;
  const requestedBindWindowGlobals = __OPENTRAY_BIND_GLOBALS__;
  const requestedWindowControlsOverlay = __OPENTRAY_WINDOW_CONTROLS_OVERLAY__;
  const requestedScreenEnabled = __OPENTRAY_SCREEN_ENABLED__;
  const requestedBindScreenGlobals = __OPENTRAY_BIND_SCREEN_GLOBALS__;
  const requestedTrayEnabled = __OPENTRAY_TRAY_ENABLED__;
  const requestedTitleSyncPageToNative = __OPENTRAY_TITLE_PAGE_TO_NATIVE__;
  const requestedTitleSyncNativeToPage = __OPENTRAY_TITLE_NATIVE_TO_PAGE__;
  const requestedIconSyncPageToNative = __OPENTRAY_ICON_PAGE_TO_NATIVE__;
  const requestedIconSyncNativeToPage = __OPENTRAY_ICON_NATIVE_TO_PAGE__;
  const capabilityPolicy = __OPENTRAY_NATIVE_API_POLICY__;
  const INTERNALS_KEY = "__OPENTRAY_WINDOW_INTERNALS__";
  const WINDOW_API_KEY = "__OPENTRAY_WINDOW_API__";
  const SCREEN_API_KEY = "__OPENTRAY_SCREEN_API__";
  const TRAY_API_KEY = "__OPENTRAY_TRAY_API__";
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
  const iconSyncNativeToPage =
    requestedIconSyncNativeToPage && directiveAllows("iconSync");
  if (!window[INTERNALS_KEY]) {
    const callbacks = new Map();
    const windowDomListeners = Object.create(null);
    let fallbackId = 1;
    let lastObservedFaviconHref;
    let faviconObserver;
    let faviconDomReadyListener;
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
    const createOverlayApi = (windowApi) => {
      const overlayDomListeners = Object.create(null);
      const overlayEventName = (event) => `overlay.${event}`;
      const overlay = {
        get visible() {
          return windowControlsOverlay;
        },
        getTitlebarAreaRect() {
          return invoke("getTitlebarAreaRect");
        },
        async listen(event, handler) {
          return windowApi.listen(overlayEventName(event), (eventData) => {
            if (typeof handler !== "function") return;
            handler(eventData && typeof eventData === "object" && "payload" in eventData
              ? eventData.payload
              : eventData);
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
        startAppRegionDrag(options) {
          return invoke("startAppRegionDrag", options ?? {});
        },
        stopAppRegionDrag() {
          return invoke("stopAppRegionDrag");
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
      if (!iconSyncPageToNative) return;
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
      if (!iconSyncPageToNative) {
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
        setPageIconHref,
        install,
        uninstall
      }),
      configurable: false
    });
  }
  const internals = window[INTERNALS_KEY];
  if (
    windowEnabled ||
    screenEnabled ||
    trayEnabled ||
    titleSyncPageToNative ||
    titleSyncNativeToPage ||
    iconSyncPageToNative ||
    iconSyncNativeToPage
  ) {
    internals.install({
      windowEnabled,
      bindWindowGlobals,
      windowControlsOverlay,
      screenEnabled,
      bindScreenGlobals,
      trayEnabled
    });
  } else {
    internals.uninstall();
  }
})();"#
        .replace("__OPENTRAY_WINDOW_ENABLED__", window_enabled)
        .replace("__OPENTRAY_BIND_GLOBALS__", bind_window_globals)
        .replace("__OPENTRAY_WINDOW_CONTROLS_OVERLAY__", window_controls_overlay)
        .replace("__OPENTRAY_SCREEN_ENABLED__", screen_enabled)
        .replace("__OPENTRAY_BIND_SCREEN_GLOBALS__", bind_screen_globals)
        .replace("__OPENTRAY_TRAY_ENABLED__", tray_enabled)
        .replace("__OPENTRAY_TITLE_PAGE_TO_NATIVE__", title_page_to_native)
        .replace("__OPENTRAY_TITLE_NATIVE_TO_PAGE__", title_native_to_page)
        .replace("__OPENTRAY_ICON_PAGE_TO_NATIVE__", icon_page_to_native)
        .replace("__OPENTRAY_ICON_NATIVE_TO_PAGE__", icon_native_to_page)
        .replace("__OPENTRAY_NATIVE_API_POLICY__", &native_api_policy_json)
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
