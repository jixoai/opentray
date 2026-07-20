use serde_json::json;

use crate::{
    MetadataSyncSettings, NavigatorScreenSettings, NavigatorTraySettings, NavigatorWindowSettings,
    WebviewNativeApiPolicy, WebviewNativeApiSource, WebviewPermissionManagerPolicy,
};

pub(crate) fn navigator_window_bootstrap_script(
    window_settings: NavigatorWindowSettings,
    soft_resize_enabled: bool,
    screen_settings: NavigatorScreenSettings,
    tray_settings: NavigatorTraySettings,
    title_sync: MetadataSyncSettings,
    icon_sync: MetadataSyncSettings,
    native_api_policy: &WebviewNativeApiPolicy,
    permission_manager_policy: &WebviewPermissionManagerPolicy,
) -> String {
    let window_enabled = js_bool(window_settings.enabled);
    let soft_resize_enabled = js_bool(soft_resize_enabled);
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
    let permission_manager_policy_json = permission_manager_policy_json(permission_manager_policy);
    r#"(function () {
  const requestedWindowEnabled = __OPENTRAY_WINDOW_ENABLED__;
  const requestedSoftResizeEnabled = __OPENTRAY_SOFT_RESIZE_ENABLED__;
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
      opentrayApi ??= {};
      defineBridgeProperty(opentrayApi, "ipc", {
        value: createIpcApi(),
        configurable: true
      });
      defineBridgeProperty(opentrayApi, "execCommand", {
        value: createCommandApi(),
        configurable: true
      });
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
        install,
        uninstall
      }),
      configurable: false
    });
  }
  const internals = window[INTERNALS_KEY];
  internals.setSoftResizeEnabled(requestedSoftResizeEnabled);
  if (
    windowEnabled ||
    screenEnabled ||
    trayEnabled ||
    permissionManagerEnabled ||
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
      trayEnabled,
      permissionManagerEnabled
    });
  } else {
    internals.uninstall();
  }
})();"#
        .replace("__OPENTRAY_WINDOW_ENABLED__", window_enabled)
        .replace("__OPENTRAY_SOFT_RESIZE_ENABLED__", soft_resize_enabled)
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

    fn overlay_bootstrap_script() -> String {
        navigator_window_bootstrap_script(
            NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
                window_controls_overlay: true,
            },
            false,
            NavigatorScreenSettings::default(),
            NavigatorTraySettings::default(),
            MetadataSyncSettings::default(),
            MetadataSyncSettings::default(),
            &WebviewNativeApiPolicy::default(),
            &Default::default(),
        )
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
