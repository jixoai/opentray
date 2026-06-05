import type {
  LynxScreenDetails,
  LynxWindowCapabilities,
  LynxWindowIcon,
  LynxWindowStyle,
  OpenTrayScreenApi,
  OpenTrayWindowApi,
  OpenTrayWindowError,
} from "./shared";

export interface InstallLynxWindowApiOptions {
  nativeWindowApi?: boolean;
  bindWindowGlobals?: boolean;
  nativeScreenApi?: boolean;
  bindScreenGlobals?: boolean;
  eventPrefix?: string;
}

interface GlobalEventEmitterShape {
  addListener(event: string, handler: (payload: unknown) => void): void;
  removeListener(event: string, handler: (payload: unknown) => void): void;
}

interface NativeModuleShape {
  invoke(payload: string): string | unknown;
}

interface NativeBridgeSuccess<Result> {
  ok: true;
  result?: Result | null;
}

interface NativeBridgeFailure {
  ok: false;
  error?: OpenTrayWindowError;
}

interface OpenTrayNavigator {
  window?: OpenTrayWindowApi;
  opentrayWindow?: OpenTrayWindowApi;
  screen?: OpenTrayScreenApi;
  opentrayScreen?: OpenTrayScreenApi;
}

interface OpenTrayWindowGlobals {
  __OPENTRAY_WINDOW_API__?: OpenTrayWindowApi;
  __OPENTRAY_SCREEN_API__?: OpenTrayScreenApi;
  __OPENTRAY_WINDOW_INTERNALS__?: {
    install(options: Required<InstallLynxWindowApiOptions>): void;
    uninstall(): void;
  };
  GlobalEventEmitter?: GlobalEventEmitterShape;
  NativeModules?: {
    OpenTrayWindowModule?: NativeModuleShape;
  };
  getScreenDetails?: () => Promise<LynxScreenDetails>;
  lynx?: {
    getJSModule?(name: string): GlobalEventEmitterShape | undefined;
  };
  navigator?: OpenTrayNavigator;
  close?: () => void;
  moveTo?: (x: number, y: number) => void;
  resizeTo?: (width: number, height: number) => void;
}

interface WindowFunctionSnapshot {
  close: OpenTrayWindowGlobals["close"];
  moveTo: OpenTrayWindowGlobals["moveTo"];
  resizeTo: OpenTrayWindowGlobals["resizeTo"];
  getScreenDetails: OpenTrayWindowGlobals["getScreenDetails"];
}

interface InstallLynxWindowApiResult {
  uninstall(): void;
  window?: OpenTrayWindowApi;
  screen?: OpenTrayScreenApi;
}

const INTERNALS_KEY = "__OPENTRAY_WINDOW_INTERNALS__";
const API_KEY = "__OPENTRAY_WINDOW_API__";
const SCREEN_API_KEY = "__OPENTRAY_SCREEN_API__";
const DEFAULT_EVENT_PREFIX = "opentray.window:";

const typedError = (code: string, message: string): OpenTrayWindowError => ({
  code,
  message,
});

const resolveGlobals = (): OpenTrayWindowGlobals => globalThis as OpenTrayWindowGlobals;

function assignOptional<
  Key extends keyof Pick<
    OpenTrayWindowGlobals,
    "close" | "moveTo" | "resizeTo" | "getScreenDetails"
  >,
>(
  globals: OpenTrayWindowGlobals,
  key: Key,
  value: OpenTrayWindowGlobals[Key],
) {
  if (value === undefined) {
    delete globals[key];
    return;
  }
  globals[key] = value;
}

const restoreWindowFunctions = (
  globals: OpenTrayWindowGlobals,
  snapshot: WindowFunctionSnapshot,
) => {
  assignOptional(globals, "close", snapshot.close);
  assignOptional(globals, "moveTo", snapshot.moveTo);
  assignOptional(globals, "resizeTo", snapshot.resizeTo);
  assignOptional(globals, "getScreenDetails", snapshot.getScreenDetails);
};

const withOptionalApis = (
  uninstall: () => void,
  windowApi: OpenTrayWindowApi | undefined,
  screenApi: OpenTrayScreenApi | undefined,
): InstallLynxWindowApiResult => {
  const result: InstallLynxWindowApiResult = { uninstall };
  if (windowApi) {
    result.window = windowApi;
  }
  if (screenApi) {
    result.screen = screenApi;
  }
  return result;
};

const readCapabilityFlag = (
  capabilities: LynxWindowCapabilities,
  key: keyof Pick<LynxWindowCapabilities, "windowApiEnabled" | "screenApiEnabled">,
  fallback: boolean,
): boolean => {
  const value = capabilities[key];
  return typeof value === "boolean" ? value : fallback;
};

const resolveEmitter = (): GlobalEventEmitterShape | undefined => {
  const runtime = resolveGlobals();
  return (
    runtime.lynx?.getJSModule?.("GlobalEventEmitter") ?? runtime.GlobalEventEmitter
  );
};

const resolveNativeModule = (): NativeModuleShape | undefined =>
  resolveGlobals().NativeModules?.OpenTrayWindowModule;

function isBridgeSuccess<Result>(
  value: unknown,
): value is NativeBridgeSuccess<Result> {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  return value.ok === true;
}

const readBridgeError = (value: unknown): OpenTrayWindowError | undefined => {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return undefined;
  }
  const error = value.error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if (!("code" in error) || !("message" in error)) {
    return undefined;
  }
  const code = error.code;
  const message = error.message;
  return typeof code === "string" && typeof message === "string"
    ? { code, message }
    : undefined;
};

function callNative<Result>(command: string, payload: unknown = {}): Result {
  const bridge = resolveNativeModule();
  if (!bridge || typeof bridge.invoke !== "function") {
    throw typedError("unsupported", "OpenTray Lynx window module is unavailable");
  }

  const raw = bridge.invoke(JSON.stringify({ cmd: command, payload }));
  const response: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!isBridgeSuccess<Result>(response)) {
    throw (
      readBridgeError(response) ??
      typedError("internal", "OpenTray Lynx window call failed")
    );
  }
  return (response.result ?? null) as Result;
}

function invoke<Result>(
  command: string,
  payload: unknown = {},
): Promise<Result> {
  return Promise.resolve().then(() => callNative<Result>(command, payload));
}

const ensureNavigator = (): OpenTrayNavigator => {
  const runtime = resolveGlobals();
  const existing = runtime.navigator;
  if (existing && typeof existing === "object") {
    return existing;
  }
  const navigatorObject: OpenTrayNavigator = {};
  runtime.navigator = navigatorObject;
  return navigatorObject;
};

const createWindowApi = (
  domListeners: Record<string, Map<(event: unknown) => void, (() => Promise<void>) | Promise<() => Promise<void>>>>,
  eventPrefix: string,
): OpenTrayWindowApi => {
  const globals = resolveGlobals();
  if (globals[API_KEY]) {
    return globals[API_KEY];
  }

  const api: OpenTrayWindowApi = {
    invoke,
    async listen<EventPayload = unknown>(
      event: string,
      handler: (event: EventPayload) => void,
    ) {
      const events = resolveEmitter();
      if (!events) {
        throw typedError("unsupported", "GlobalEventEmitter is unavailable");
      }
      const eventName = `${eventPrefix}${event}`;
      const wrapped = (payload: unknown) => {
        handler(payload as EventPayload);
      };
      events.addListener(eventName, wrapped);
      return async () => {
        events.removeListener(eventName, wrapped);
      };
    },
    async once<EventPayload = unknown>(
      event: string,
      handler: (event: EventPayload) => void,
    ) {
      let unlisten = async () => {};
      unlisten = await api.listen(event, async (eventPayload) => {
        await unlisten();
        handler(eventPayload as EventPayload);
      });
      return unlisten;
    },
    close() {
      return invoke<void>("close");
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
    getStyle() {
      return invoke<LynxWindowStyle>("getStyle");
    },
    setStyle(style) {
      return invoke<LynxWindowStyle>("setStyle", style);
    },
    getCapabilities() {
      return invoke<LynxWindowCapabilities>("getCapabilities");
    },
    getTitle() {
      return invoke<string>("getTitle");
    },
    setTitle(title) {
      return invoke<string>("setTitle", { title });
    },
    getIcon() {
      return invoke<LynxWindowIcon | null>("getIcon");
    },
    setIcon(icon) {
      return invoke<LynxWindowIcon | null>("setIcon", icon ?? null);
    },
    addEventListener(event, handler) {
      const eventListeners = (domListeners[event] ??= new Map());
      if (eventListeners.has(handler)) {
        return;
      }
      const pending = api.listen(event, handler).then((unlisten) => {
        eventListeners.set(handler, unlisten);
        return unlisten;
      });
      eventListeners.set(handler, pending);
    },
    removeEventListener(event, handler) {
      const eventListeners = domListeners[event];
      if (!eventListeners) {
        return;
      }
      const unlisten = eventListeners.get(handler);
      eventListeners.delete(handler);
      if (typeof unlisten === "function") {
        void unlisten();
        return;
      }
      if (unlisten && typeof unlisten.then === "function") {
        void unlisten.then((resolved) => resolved());
      }
    },
  };

  Object.freeze(api);
  globals[API_KEY] = api;
  return api;
};

const createScreenApi = (): OpenTrayScreenApi => {
  const globals = resolveGlobals();
  if (globals[SCREEN_API_KEY]) {
    return globals[SCREEN_API_KEY];
  }
  const api: OpenTrayScreenApi = {
    getScreenDetails() {
      return invoke<LynxScreenDetails>("getScreenDetails");
    },
  };
  Object.freeze(api);
  globals[SCREEN_API_KEY] = api;
  return api;
};

export const installLynxWindowApi = (
  options: InstallLynxWindowApiOptions = {},
): InstallLynxWindowApiResult => {
  'background only';
  const globals = resolveGlobals();
  if (globals[INTERNALS_KEY]) {
    globals[INTERNALS_KEY].install({
      nativeWindowApi: options.nativeWindowApi ?? true,
      bindWindowGlobals: options.bindWindowGlobals ?? false,
      nativeScreenApi: options.nativeScreenApi ?? false,
      bindScreenGlobals: options.bindScreenGlobals ?? false,
      eventPrefix: options.eventPrefix ?? DEFAULT_EVENT_PREFIX,
    });
    return withOptionalApis(
      () => {
        globals[INTERNALS_KEY]?.uninstall();
      },
      globals[API_KEY],
      globals[SCREEN_API_KEY],
    );
  }

  const domListeners: Record<
    string,
    Map<(event: unknown) => void, (() => Promise<void>) | Promise<() => Promise<void>>>
  > = Object.create(null) as Record<
    string,
    Map<(event: unknown) => void, (() => Promise<void>) | Promise<() => Promise<void>>>
  >;
  const navigatorObject = ensureNavigator();
  const originalWindowFns: WindowFunctionSnapshot = {
    close: globals.close,
    moveTo: globals.moveTo,
    resizeTo: globals.resizeTo,
    getScreenDetails: globals.getScreenDetails,
  };

  const install = (resolved: Required<InstallLynxWindowApiOptions>) => {
    if (resolved.nativeWindowApi) {
      const api = createWindowApi(domListeners, resolved.eventPrefix);
      navigatorObject.window = api;
      navigatorObject.opentrayWindow = api;
      if (resolved.bindWindowGlobals) {
        globals.close = () => {
          void api.close();
        };
        globals.moveTo = (x, y) => {
          void api.moveTo(Number(x), Number(y));
        };
        globals.resizeTo = (width, height) => {
          void api.resizeTo(Number(width), Number(height));
        };
      } else {
        assignOptional(globals, "close", originalWindowFns.close);
        assignOptional(globals, "moveTo", originalWindowFns.moveTo);
        assignOptional(globals, "resizeTo", originalWindowFns.resizeTo);
      }
    } else {
      delete navigatorObject.window;
      delete navigatorObject.opentrayWindow;
      assignOptional(globals, "close", originalWindowFns.close);
      assignOptional(globals, "moveTo", originalWindowFns.moveTo);
      assignOptional(globals, "resizeTo", originalWindowFns.resizeTo);
    }

    if (resolved.nativeScreenApi) {
      const api = createScreenApi();
      navigatorObject.screen = api;
      navigatorObject.opentrayScreen = api;
      assignOptional(
        globals,
        "getScreenDetails",
        resolved.bindScreenGlobals ? () => api.getScreenDetails() : originalWindowFns.getScreenDetails,
      );
    } else {
      delete navigatorObject.screen;
      delete navigatorObject.opentrayScreen;
      assignOptional(globals, "getScreenDetails", originalWindowFns.getScreenDetails);
    }
  };

  const uninstall = () => {
    delete navigatorObject.window;
    delete navigatorObject.opentrayWindow;
    delete navigatorObject.screen;
    delete navigatorObject.opentrayScreen;
    restoreWindowFunctions(globals, originalWindowFns);
  };

  globals[INTERNALS_KEY] = {
    install,
    uninstall,
  };

  install({
    nativeWindowApi: options.nativeWindowApi ?? true,
    bindWindowGlobals: options.bindWindowGlobals ?? false,
    nativeScreenApi: options.nativeScreenApi ?? false,
    bindScreenGlobals: options.bindScreenGlobals ?? false,
    eventPrefix: options.eventPrefix ?? DEFAULT_EVENT_PREFIX,
  });

  return withOptionalApis(uninstall, globals[API_KEY], globals[SCREEN_API_KEY]);
};

export const readInstalledLynxWindowApi = (): OpenTrayWindowApi | undefined =>
  {
    'background only';
    return resolveGlobals()[API_KEY];
  };

export const readInstalledLynxScreenApi = (): OpenTrayScreenApi | undefined =>
  {
    'background only';
    return resolveGlobals()[SCREEN_API_KEY];
  };

export const installLynxWindowApiFromHost = async (
  options: Pick<InstallLynxWindowApiOptions, "eventPrefix"> = {},
): Promise<InstallLynxWindowApiResult> => {
  'background only';
  const initial = installLynxWindowApi({
    nativeWindowApi: true,
    bindWindowGlobals: false,
    nativeScreenApi: true,
    bindScreenGlobals: false,
    ...(options.eventPrefix ? { eventPrefix: options.eventPrefix } : {}),
  });
  const capabilities = await initial.window?.getCapabilities();
  if (!capabilities) {
    return initial;
  }
  return installLynxWindowApi({
    nativeWindowApi: readCapabilityFlag(capabilities, "windowApiEnabled", true),
    bindWindowGlobals: capabilities.globalBindingsEnabled,
    nativeScreenApi: readCapabilityFlag(capabilities, "screenApiEnabled", true),
    bindScreenGlobals: capabilities.screenBindingsEnabled,
    ...(options.eventPrefix ? { eventPrefix: options.eventPrefix } : {}),
  });
};
