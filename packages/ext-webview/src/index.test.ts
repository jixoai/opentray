import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "opentray";

import {
  attachWebview,
  createAppScopedWebviewPermissionStore,
  mediaQueryKit,
  styleKit,
  WebviewExt,
  WebviewExtensionLoadError,
  webviewBrowserPermissionFamilies,
  WebviewPlacementKit,
  windowGeometryKit,
} from "./index";
import type {
  WebviewCommand,
  WebviewNavigatorIpc,
  WebviewNavigatorNamespace,
  WebviewNavigatorPermissions,
  WebviewNavigatorScreen,
  WebviewNavigatorWindow,
  WebviewPermissionStore,
  WebviewScreenDetails,
  WebviewWindowState,
  WebviewWindowStyle,
} from "./index";

describe("@opentray/ext-webview", () => {
  it("extends a tray with an isolated WebView window mount", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");
    const webviewTray = tray.extend(WebviewExt, { mountId: "webview.tray-1" });
    const webviewWindow = webviewTray.createWebviewWindow({
      html: "<main />",
      width: 300,
      height: 200,
    });

    await webviewWindow.show();

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview.tray-1",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: {
          type: "show",
          html: "<main />",
          width: 300,
          height: 200,
        },
      },
    ]);
  });

  it("treats repeated window show as visibility restore instead of bootstrap replay", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");
    const webviewWindow = tray
      .extend(WebviewExt, { mountId: "webview.tray-1" })
      .createWebviewWindow({
        html: "<main />",
        width: 300,
        height: 200,
        nativeWindowApi: true,
        style: { frameless: true, background: "blur" },
      });

    await webviewWindow.show();
    await webviewWindow.resizeTo(360, 240);
    await webviewWindow.show();
    await webviewWindow.destroy();
    await webviewWindow.show();

    expect(transport.frames.slice(1)).toEqual([
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: {
          type: "show",
          html: "<main />",
          width: 300,
          height: 200,
          nativeWindowApi: true,
          style: { frameless: true, background: "blur" },
        },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "resizeTo", width: 360, height: 240 },
      },
      {
        type: "ext-command",
        requestId: "opentray-4",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "show" },
      },
      {
        type: "ext-command",
        requestId: "opentray-5",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "destroy" },
      },
      {
        type: "ext-command",
        requestId: "opentray-6",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: {
          type: "show",
          html: "<main />",
          width: 300,
          height: 200,
          nativeWindowApi: true,
          style: { frameless: true, background: "blur" },
        },
      },
    ]);
  });

  it("keeps attachWebview on the legacy webview mount and auto-loads once", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    await attachWebview(tray).show({
      type: "show",
      html: "<main />",
      width: 300,
      height: 200,
      nativeWindowApi: true,
      bindWindowGlobals: true,
      nativeScreenApi: true,
      bindScreenGlobals: true,
      nativeTrayApi: true,
      title: "OpenTray Status",
      icon: { type: "href", href: "data:image/png;base64,abc" },
      style: {
        frameless: true,
        keepOnTop: true,
        opacity: 0.72,
        background: {
          kind: "platformMaterial",
          material: "hudWindow",
          state: "active",
        },
        platform: {
          macos: {
            cornerRadius: null,
          },
        },
      },
      titleSync: {
        documentToWindow: true,
        windowToDocument: true,
      },
      iconSync: true,
      nativeApiPolicy: {
        defaultSrc: ["'local'"],
        window: ["https://example.com"],
        screen: ["'local'"],
        tray: ["'local'"],
        windowGlobals: ["'none'"],
        titleSync: ["https://example.com"],
        iconSync: ["'local'"],
      },
    });

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview",
        data: {
          type: "show",
          html: "<main />",
          width: 300,
          height: 200,
          nativeWindowApi: true,
          bindWindowGlobals: true,
          nativeScreenApi: true,
          bindScreenGlobals: true,
          nativeTrayApi: true,
          title: "OpenTray Status",
          icon: { type: "href", href: "data:image/png;base64,abc" },
          style: {
            frameless: true,
            keepOnTop: true,
            opacity: 0.72,
            background: {
              kind: "platformMaterial",
              material: "hudWindow",
              state: "active",
            },
            platform: {
              macos: {
                cornerRadius: null,
              },
            },
          },
          titleSync: {
            documentToWindow: true,
            windowToDocument: true,
          },
          iconSync: true,
          nativeApiPolicy: {
            defaultSrc: ["'local'"],
            window: ["https://example.com"],
            screen: ["'local'"],
            tray: ["'local'"],
            windowGlobals: ["'none'"],
            titleSync: ["https://example.com"],
            iconSync: ["'local'"],
          },
        },
      },
    ]);
  });

  it("forwards browser permission policy separately from nativeApiPolicy", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    await attachWebview(tray).show({
      type: "show",
      html: "<main />",
      nativeApiPolicy: {
        defaultSrc: ["'local'"],
        window: ["https://example.com"],
      },
      browserPermissionPolicy: {
        camera: {
          sources: ["'local'", "https://example.com"],
          decision: "prompt",
        },
        microphone: {
          sources: ["'local'"],
          decision: "allow",
        },
      },
      permissionManagerPolicy: {
        defaultSrc: ["'local'"],
        remoteOrigins: ["https://example.com"],
      },
    });

    expect(transport.frames.at(-1)).toMatchObject({
      type: "ext-command",
      data: {
        type: "show",
        nativeApiPolicy: {
          defaultSrc: ["'local'"],
          window: ["https://example.com"],
        },
        browserPermissionPolicy: {
          camera: {
            sources: ["'local'", "https://example.com"],
            decision: "prompt",
          },
          microphone: {
            sources: ["'local'"],
            decision: "allow",
          },
        },
        permissionManagerPolicy: {
          defaultSrc: ["'local'"],
          remoteOrigins: ["https://example.com"],
        },
      },
    });
  });

  it("stores durable permission facts in an app-scoped JS store", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "opentray-permissions-"));
    try {
      const store = createAppScopedWebviewPermissionStore({
        appId: "com.example.tray",
        baseDir,
      });
      const otherStore = createAppScopedWebviewPermissionStore({
        appId: "com.example.other",
        baseDir,
      });

      const record = await store.set({
        source: { type: "origin", origin: "https://example.com" },
        family: "camera",
        decision: "allow",
        sourceAction: "test",
      });

      expect(store.namespace).toBe("com.example.tray");
      expect(record).toMatchObject({
        namespace: "com.example.tray",
        source: { type: "origin", origin: "https://example.com" },
        family: "camera",
        decision: "allow",
        sourceAction: "test",
      });
      await expect(
        store.get({ type: "origin", origin: "https://example.com" }, "camera")
      ).resolves.toMatchObject({ decision: "allow" });
      await expect(
        otherStore.get(
          { type: "origin", origin: "https://example.com" },
          "camera"
        )
      ).resolves.toBeUndefined();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("resolves page permission manager messages through the app-scoped store", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "opentray-permissions-"));
    try {
      const store = createAppScopedWebviewPermissionStore({
        appId: "app-1",
        baseDir,
      });
      let drained = false;
      const transport = new WebviewResultTransport((command) => {
        if (!isWebviewCommand(command)) {
          return { type: "unknown" };
        }
        if (command.type === "drainPermissionMessages") {
          if (drained) {
            return { type: "permissionMessages", messages: [] };
          }
          drained = true;
          return {
            type: "permissionMessages",
            messages: [
              {
                id: 7,
                source: "page",
                action: "set",
                sourceScope: { type: "origin", origin: "https://example.com" },
                family: "camera",
                decision: "allow",
                sourceAction: "test",
              },
            ],
          };
        }
        if (command.type === "resolvePermissionMessage") {
          return { type: "permissionMessageResolved", id: command.id };
        }
        return { type: "ok" };
      });
      const window = createTrayHandle(transport, "app-1", "tray-1")
        .extend(WebviewExt, {
          mountId: "webview.tray-1",
          permissions: { store },
        })
        .createWebviewWindow({ html: "<main />" });

      const stop = window.startPermissionManager();
      const record = await eventually(() =>
        store.get({ type: "origin", origin: "https://example.com" }, "camera")
      );
      stop();

      expect(record).toMatchObject({ decision: "allow", sourceAction: "test" });
      expect(
        transport.frames.some(
          (frame) =>
            frame.type === "ext-command" &&
            isWebviewCommand(frame.data) &&
            frame.data.type === "resolvePermissionMessage" &&
            frame.data.id === 7 &&
            frame.data.result.decision === "allow"
        )
      ).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("exposes explicit lifecycle verbs instead of overloading repeated show", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    const webview = attachWebview(tray);
    await webview.setContent({
      type: "setContent",
      html: "<main>updated</main>",
    });
    await webview.navigate("https://example.com/next");
    await webview.destroy();

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview",
        data: {
          type: "setContent",
          html: "<main>updated</main>",
        },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview",
        data: {
          type: "navigate",
          url: "https://example.com/next",
        },
      },
      {
        type: "ext-command",
        requestId: "opentray-4",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview",
        data: {
          type: "destroy",
        },
      },
    ]);
  });

  it("exposes host-side geometry verbs through the WebView command path", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");
    const webviewWindow = tray
      .extend(WebviewExt, { mountId: "webview.tray-1" })
      .createWebviewWindow({
        html: "<main />",
        width: 300,
        height: 200,
      });

    await webviewWindow.resizeTo(360, 240);
    await webviewWindow.moveTo(10, 20);

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview.tray-1",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "resizeTo", width: 360, height: 240 },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "moveTo", x: 10, y: 20 },
      },
    ]);
  });

  it("exposes backend screen authority on the WebView extension capability", async () => {
    const transport = new WebviewResultTransport((command) =>
      isWebviewCommand(command) && command.type === "getScreenDetails"
        ? {
            currentScreen: null,
            screens: [],
            isExtended: false,
          }
        : { type: "ok" }
    );
    const tray = createTrayHandle(transport, "app-1", "tray-1");
    const webviewTray = tray.extend(WebviewExt, { mountId: "webview.tray-1" });

    await expect(webviewTray.getScreenDetails()).resolves.toEqual({
      currentScreen: null,
      screens: [],
      isExtended: false,
    });
    expect(transport.frames.at(-1)).toMatchObject({
      type: "ext-command",
      data: { type: "getScreenDetails" },
    });
  });

  it("drains page-to-backend IPC messages through the backend window handle", async () => {
    const transport = new WebviewResultTransport((command) =>
      isWebviewCommand(command) && command.type === "drainIpcMessages"
        ? {
            type: "ipcMessages",
            messages: [
              {
                id: 1,
                source: "page",
                payload: { type: "resize", width: 611, height: 260 },
              },
            ],
          }
        : { type: "ok" }
    );
    const tray = createTrayHandle(transport, "app-1", "tray-1");
    const webviewWindow = tray
      .extend(WebviewExt, { mountId: "webview.tray-1" })
      .createWebviewWindow({
        html: "<main />",
        width: 300,
        height: 200,
      });

    await expect(webviewWindow.drainIpcMessages()).resolves.toEqual([
      {
        id: 1,
        source: "page",
        payload: { type: "resize", width: 611, height: 260 },
      },
    ]);
    expect(transport.frames.at(-1)).toMatchObject({
      type: "ext-command",
      data: { type: "drainIpcMessages" },
    });
  });

  it("publishes drained native window interaction events to host-side listeners", async () => {
    vi.useFakeTimers();
    try {
      const events: unknown[] = [];
      let drained = false;
      const transport = new WebviewResultTransport((command) => {
        if (isWebviewCommand(command) && command.type === "drainWindowEvents") {
          if (drained) {
            return { type: "windowEvents", events: [] };
          }
          drained = true;
          return {
            type: "windowEvents",
            events: [{ type: "windowinteractionchange", active: true }],
          };
        }
        return { type: "ok" };
      });
      const tray = createTrayHandle(transport, "app-1", "tray-1");
      const webviewWindow = tray
        .extend(WebviewExt, { mountId: "webview.tray-1" })
        .createWebviewWindow({
          html: "<main />",
          width: 300,
          height: 200,
        });

      const unlisten = webviewWindow.listen(
        "windowinteractionchange",
        (event) => {
          events.push(event);
        }
      );
      await vi.advanceTimersByTimeAsync(16);

      expect(events).toEqual([
        {
          event: "windowinteractionchange",
          id: 0,
          payload: { active: true },
        },
      ]);
      expect(transport.frames.at(-1)).toMatchObject({
        type: "ext-command",
        data: { type: "drainWindowEvents" },
      });

      unlisten();
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes drained native focus and blur events to host-side listeners", async () => {
    vi.useFakeTimers();
    try {
      const events: unknown[] = [];
      let drained = false;
      const transport = new WebviewResultTransport((command) => {
        if (isWebviewCommand(command) && command.type === "drainWindowEvents") {
          if (drained) {
            return { type: "windowEvents", events: [] };
          }
          drained = true;
          return {
            type: "windowEvents",
            events: [{ type: "focus" }, { type: "blur" }],
          };
        }
        return { type: "ok" };
      });
      const tray = createTrayHandle(transport, "app-1", "tray-1");
      const webviewWindow = tray
        .extend(WebviewExt, { mountId: "webview.tray-1" })
        .createWebviewWindow({
          html: "<main />",
          width: 300,
          height: 200,
        });

      const unlistenFocus = webviewWindow.listen("focus", (event) => {
        events.push(event);
      });
      const unlistenBlur = webviewWindow.listen("blur", (event) => {
        events.push(event);
      });
      await vi.advanceTimersByTimeAsync(16);

      expect(events).toEqual([
        { event: "focus", id: 0, payload: {} },
        { event: "blur", id: 0, payload: {} },
      ]);
      expect(transport.frames.at(-1)).toMatchObject({
        type: "ext-command",
        data: { type: "drainWindowEvents" },
      });

      unlistenFocus();
      unlistenBlur();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes host-side bounds, size constraints, and style verbs through extension responses", async () => {
    const bounds = { x: 10, y: 20, width: 360, height: 240 };
    const transport = new WebviewResultTransport((command) => {
      if (isWebviewCommand(command) && command.type === "getBounds") {
        return bounds;
      }
      if (isWebviewCommand(command) && command.type === "setStyle") {
        return {
          frameless: true,
          keepOnTop: true,
          opacity: command.style.opacity ?? 1,
          background: { kind: "semantic", token: "blur", state: "active" },
          platform: { windows: { cornerPreference: "round" } },
        };
      }
      return { type: "ok" };
    });
    const tray = createTrayHandle(transport, "app-1", "tray-1");
    const webviewWindow = tray
      .extend(WebviewExt, { mountId: "webview.tray-1" })
      .createWebviewWindow({
        html: "<main />",
        width: 300,
        height: 200,
      });

    await expect(webviewWindow.getBounds()).resolves.toEqual(bounds);
    await webviewWindow.setMinimumSize(260, null);
    await webviewWindow.setMaximumWidth(null);
    await expect(
      webviewWindow.setStyle({ opacity: 0.64 })
    ).resolves.toMatchObject({
      opacity: 0.64,
      background: { kind: "semantic", token: "blur", state: "active" },
    });
    await expect(
      webviewWindow.setBackground("blur", { state: "active" })
    ).resolves.toMatchObject({
      opacity: 1,
      background: { kind: "semantic", token: "blur", state: "active" },
    });

    expect(transport.frames.slice(1)).toEqual([
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "getBounds" },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "setMinimumSize", width: 260, height: null },
      },
      {
        type: "ext-command",
        requestId: "opentray-4",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: { type: "setMaximumSize", width: null },
      },
      {
        type: "ext-command",
        requestId: "opentray-5",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: {
          type: "setStyle",
          style: { opacity: 0.64 },
        },
      },
      {
        type: "ext-command",
        requestId: "opentray-6",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview.tray-1",
        data: {
          type: "setStyle",
          style: {
            background: { kind: "semantic", token: "blur", state: "active" },
          },
        },
      },
    ]);
  });

  it("resolves and applies tray placement with injected authorities", async () => {
    const calls: unknown[] = [];
    const kit = new WebviewPlacementKit({
      tray: {
        async getBounds() {
          return {
            kind: "native",
            source: "backend.nativeTrayBounds",
            rect: { x: 900, y: 10, width: 24, height: 24 },
          };
        },
      },
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });

    const result = await kit.applyOnce(
      {
        async resizeTo(width, height) {
          calls.push(["resizeTo", width, height]);
        },
        async moveTo(x, y) {
          calls.push(["moveTo", x, y]);
        },
      },
      { placement: "tray", width: 240, height: 160, placementMargin: 12 }
    );

    expect(result).toEqual({
      placement: "tray",
      kind: "native",
      source: "backend.nativeTrayBounds",
      anchorRect: { x: 900, y: 10, width: 24, height: 24 },
      rect: { x: 760, y: 46, width: 240, height: 160 },
    });
    expect(calls).toEqual([
      ["resizeTo", 240, 160],
      ["moveTo", 760, 46],
    ]);
  });

  it("keeps the last valid tray anchor when a transient tray bounds result is invalid", async () => {
    let trayRect = { x: 900, y: 10, width: 24, height: 24 };
    const kit = new WebviewPlacementKit({
      tray: {
        async getBounds() {
          return {
            kind: "native" as const,
            source: "backend.nativeTrayBounds",
            rect: trayRect,
          };
        },
      },
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });

    const target = {
      async resizeTo() {},
      async moveTo() {},
    };
    await kit.applyOnce(target, {
      placement: "tray",
      width: 240,
      height: 160,
      placementMargin: 12,
    });

    trayRect = { x: -4000, y: -4000, width: 0, height: 0 };
    const result = await kit.applyOnce(target, {
      placement: "tray",
      width: 240,
      height: 160,
      placementMargin: 12,
    });

    expect(result).toMatchObject({
      placement: "tray",
      kind: "native",
      source: "backend.nativeTrayBounds->last-good",
      anchorRect: { x: 900, y: 10, width: 24, height: 24 },
      rect: { x: 760, y: 46, width: 240, height: 160 },
    });
  });

  it("watches placement and replaces an existing watch for the same target", async () => {
    const calls: unknown[] = [];
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });
    const target = {
      async resizeTo(width: number, height: number) {
        calls.push(["resizeTo", width, height]);
      },
      async moveTo(x: number, y: number) {
        calls.push(["moveTo", x, y]);
      },
    };

    const first = await kit.watch(target, {
      placement: "screen-bottom-right",
      width: 120,
      height: 80,
      placementMargin: 12,
      watchIntervalMs: 1000,
    });
    const second = await kit.watch(target, {
      placement: "screen-top-left",
      width: 120,
      height: 80,
      placementMargin: 16,
      watchIntervalMs: 1000,
    });

    expect(first.active).toBe(false);
    expect(second.latest?.rect).toEqual({
      x: 16,
      y: 16,
      width: 120,
      height: 80,
    });
    second.stop();
  });

  it("waits for live bounds to settle and preserves user-resized window size while watching", async () => {
    vi.useFakeTimers();
    try {
      const calls: unknown[] = [];
      let rect = { x: 500, y: 500, width: 120, height: 80 };
      const kit = new WebviewPlacementKit({
        screen: {
          async getScreenDetails() {
            return {
              currentScreen: {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
              screens: [
                {
                  id: "primary",
                  frame: { x: 0, y: 0, width: 1000, height: 800 },
                  visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
                },
              ],
            };
          },
        },
      });
      const target = {
        async getBounds() {
          return rect;
        },
        async resizeTo(width: number, height: number) {
          calls.push(["resizeTo", width, height]);
          rect = { ...rect, width, height };
        },
        async moveTo(x: number, y: number) {
          calls.push(["moveTo", x, y]);
          rect = { ...rect, x, y };
        },
      };

      const watch = await kit.watch(target, {
        placement: "screen-top-left",
        width: 120,
        height: 80,
        placementMargin: 16,
        watchIntervalMs: 1000,
        settleMs: 180,
      });
      rect = { x: 620, y: 480, width: 180, height: 100 };
      await watch.refresh();

      expect(calls).toEqual([["moveTo", 16, 16]]);
      await vi.advanceTimersByTimeAsync(180);
      expect(calls).toEqual([
        ["moveTo", 16, 16],
        ["moveTo", 16, 16],
      ]);
      expect(rect).toEqual({ x: 16, y: 16, width: 180, height: 100 });
      watch.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers placement while native interaction is active and resumes after exit", async () => {
    vi.useFakeTimers();
    try {
      const calls: unknown[] = [];
      let rect = { x: 500, y: 500, width: 120, height: 80 };
      const listeners = new Map<string, Array<(event: unknown) => void>>();
      const kit = new WebviewPlacementKit({
        screen: {
          async getScreenDetails() {
            return {
              currentScreen: {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
              screens: [
                {
                  id: "primary",
                  frame: { x: 0, y: 0, width: 1000, height: 800 },
                  visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
                },
              ],
            };
          },
        },
      });
      const target = {
        async getBounds() {
          return rect;
        },
        async resizeTo(width: number, height: number) {
          calls.push(["resizeTo", width, height]);
          rect = { ...rect, width, height };
        },
        async moveTo(x: number, y: number) {
          calls.push(["moveTo", x, y]);
          rect = { ...rect, x, y };
        },
        listen<TPayload = unknown>(
          event: string,
          handler: (
            event: TPayload | { event: string; payload: TPayload }
          ) => void
        ) {
          const handlers = listeners.get(event) ?? [];
          handlers.push(handler as (event: unknown) => void);
          listeners.set(event, handlers);
          return () => {
            listeners.set(
              event,
              (listeners.get(event) ?? []).filter(
                (candidate) => candidate !== handler
              )
            );
          };
        },
      };

      const watch = await kit.watch(target, {
        placement: "screen-top-left",
        width: 120,
        height: 80,
        placementMargin: 16,
        watchIntervalMs: 1000,
        settleMs: 180,
      });
      expect(calls).toEqual([["moveTo", 16, 16]]);

      listeners.get("windowinteractionchange")?.[0]?.({
        event: "windowinteractionchange",
        payload: { active: true },
      });
      expect(watch.paused).toBe(true);
      rect = { x: 620, y: 480, width: 180, height: 100 };
      listeners.get("moved")?.[0]?.({
        event: "moved",
        payload: { x: 620, y: 480 },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toEqual([["moveTo", 16, 16]]);

      listeners.get("windowinteractionchange")?.[0]?.({
        event: "windowinteractionchange",
        payload: { active: false },
      });
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);
      await flushMicrotasks();
      expect(watch.paused).toBe(false);
      expect(calls).toEqual([
        ["moveTo", 16, 16],
        ["moveTo", 16, 16],
      ]);
      watch.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops placement watches when the host window reports hidden or closed", async () => {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });
    const target = {
      async getBounds() {
        return { x: 0, y: 0, width: 120, height: 80 };
      },
      async resizeTo() {},
      async moveTo() {},
      listen<TPayload = unknown>(
        event: string,
        handler: (
          event: TPayload | { event: string; payload: TPayload }
        ) => void
      ) {
        const handlers = listeners.get(event) ?? [];
        handlers.push(handler as (event: unknown) => void);
        listeners.set(event, handlers);
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter(
              (candidate) => candidate !== handler
            )
          );
        };
      },
    };

    const watch = await kit.watch(target, {
      placement: "screen-top-left",
      width: 120,
      height: 80,
      placementMargin: 16,
      watchIntervalMs: 1000,
    });
    listeners.get("windowstatechange")?.[0]?.({
      event: "windowstatechange",
      payload: { visible: false },
    });

    expect(watch.active).toBe(false);
  });

  it("ignores in-flight background placement refresh errors after stop", async () => {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    let bounds = { x: 0, y: 0, width: 120, height: 80 };
    let blockNextBounds = false;
    let closed = false;
    let resolveEnteredBounds: (() => void) | undefined;
    let enteredBounds = Promise.resolve();
    let releaseBounds: (() => void) | undefined;
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });
    const target = {
      async getBounds() {
        if (blockNextBounds) {
          resolveEnteredBounds?.();
          await new Promise<void>((resolve) => {
            releaseBounds = resolve;
          });
          if (closed) {
            throw new Error("broker connection closed");
          }
        }
        return bounds;
      },
      async resizeTo() {},
      async moveTo() {},
      listen<TPayload = unknown>(
        event: string,
        handler: (
          event: TPayload | { event: string; payload: TPayload }
        ) => void
      ) {
        const handlers = listeners.get(event) ?? [];
        handlers.push(handler as (event: unknown) => void);
        listeners.set(event, handlers);
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter(
              (candidate) => candidate !== handler
            )
          );
        };
      },
    };

    const watch = await kit.watch(target, {
      placement: "screen-top-left",
      width: 120,
      height: 80,
      placementMargin: 16,
      watchIntervalMs: 1000,
    });

    bounds = { ...bounds, width: 121 };
    blockNextBounds = true;
    enteredBounds = new Promise<void>((resolve) => {
      resolveEnteredBounds = resolve;
    });
    listeners.get("resized")?.[0]?.({
      event: "resized",
      payload: { width: 121, height: 80 },
    });
    await enteredBounds;
    watch.stop();
    closed = true;
    releaseBounds?.();
    await flushMicrotasks();

    expect(watch.active).toBe(false);
  });

  it("does not reapply unchanged placement while watching", async () => {
    const calls: unknown[] = [];
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });
    const target = {
      async resizeTo(width: number, height: number) {
        calls.push(["resizeTo", width, height]);
      },
      async moveTo(x: number, y: number) {
        calls.push(["moveTo", x, y]);
      },
    };

    const watch = await kit.watch(target, {
      placement: "screen-top-left",
      width: 120,
      height: 80,
      placementMargin: 16,
      watchIntervalMs: 1000,
    });
    await watch.refresh();

    expect(calls).toEqual([["moveTo", 16, 16]]);
    watch.stop();
  });

  it("resolves edge placement from window bounds against the viewport", async () => {
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });

    await expect(
      kit.resolve({
        placement: "edge-x",
        width: 100,
        height: 50,
        placementMargin: 8,
        windowRect: { x: 780, y: 300, width: 100, height: 50 },
      })
    ).resolves.toEqual({
      placement: "edge-x",
      kind: "native",
      source: "edge.right",
      anchorRect: { x: 1000, y: 0, width: 0, height: 760 },
      rect: { x: 892, y: 300, width: 100, height: 50 },
    });
  });

  it("keeps placement math in desktop logical pixels on high-DPI screen snapshots", async () => {
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1280, height: 720 },
              visibleFrame: { x: 0, y: 0, width: 1280, height: 680 },
              scaleFactor: 2,
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1280, height: 720 },
                visibleFrame: { x: 0, y: 0, width: 1280, height: 680 },
                scaleFactor: 2,
              },
            ],
          };
        },
      },
    });

    await expect(
      kit.resolve({
        placement: "screen-bottom-right",
        width: 320,
        height: 200,
        placementMargin: 20,
        windowRect: { x: 900, y: 300, width: 320, height: 200 },
      })
    ).resolves.toEqual({
      placement: "screen-bottom-right",
      kind: "native",
      source: "screen.visibleFrame",
      anchorRect: { x: 1280, y: 680, width: 0, height: 0 },
      rect: { x: 940, y: 460, width: 320, height: 200 },
    });
  });

  it("resolves visual top and bottom placements from bottom-left screen coordinates", async () => {
    const kit = new WebviewPlacementKit({
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
            coordinateOrigin: "bottomLeft",
          };
        },
      },
    });

    await expect(
      kit.resolve({
        placement: "screen-top-left",
        width: 120,
        height: 80,
        placementMargin: 16,
        windowRect: { x: 500, y: 300, width: 120, height: 80 },
      })
    ).resolves.toMatchObject({
      anchorRect: { x: 0, y: 760, width: 0, height: 0 },
      rect: { x: 16, y: 664, width: 120, height: 80 },
    });

    await expect(
      kit.resolve({
        placement: "screen-bottom-right",
        width: 120,
        height: 80,
        placementMargin: 16,
        windowRect: { x: 500, y: 300, width: 120, height: 80 },
      })
    ).resolves.toMatchObject({
      anchorRect: { x: 1000, y: 0, width: 0, height: 0 },
      rect: { x: 864, y: 16, width: 120, height: 80 },
    });

    await expect(
      kit.resolve({
        placement: "edge-top",
        width: 120,
        height: 80,
        placementMargin: 16,
        windowRect: { x: 500, y: 300, width: 120, height: 80 },
      })
    ).resolves.toMatchObject({
      anchorRect: { x: 0, y: 760, width: 1000, height: 0 },
      rect: { x: 500, y: 664, width: 120, height: 80 },
    });

    await expect(
      kit.resolve({
        placement: "edge-bottom",
        width: 120,
        height: 80,
        placementMargin: 16,
        windowRect: { x: 500, y: 300, width: 120, height: 80 },
      })
    ).resolves.toMatchObject({
      anchorRect: { x: 0, y: 0, width: 1000, height: 0 },
      rect: { x: 500, y: 16, width: 120, height: 80 },
    });
  });

  it("falls back from unavailable tray placement to screen center with provenance", async () => {
    const kit = new WebviewPlacementKit({
      tray: {
        async getBounds() {
          return {
            kind: "unavailable",
            source: "backend.unavailable",
            rect: null,
          };
        },
      },
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });

    await expect(
      kit.resolve({ placement: "tray", width: 200, height: 100 })
    ).resolves.toEqual({
      placement: "tray",
      kind: "fallback",
      source: "backend.unavailable->screen-center",
      anchorRect: { x: 0, y: 0, width: 1000, height: 760 },
      rect: { x: 400, y: 330, width: 200, height: 100 },
    });
  });

  it("prefers placing tray panels above bottom tray anchors", async () => {
    const kit = new WebviewPlacementKit({
      tray: {
        async getBounds() {
          return {
            kind: "native",
            source: "backend.nativeTrayBounds",
            rect: { x: 900, y: 740, width: 24, height: 24 },
          };
        },
      },
      screen: {
        async getScreenDetails() {
          return {
            currentScreen: {
              id: "primary",
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
            },
            screens: [
              {
                id: "primary",
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                visibleFrame: { x: 0, y: 0, width: 1000, height: 760 },
              },
            ],
          };
        },
      },
    });

    await expect(
      kit.resolve({
        placement: "tray",
        width: 240,
        height: 160,
        placementMargin: 12,
      })
    ).resolves.toMatchObject({
      rect: { x: 760, y: 568, width: 240, height: 160 },
    });
  });

  it("applies declarative window style recipes without touching page content", async () => {
    const calls: unknown[] = [];
    const target = {
      async resizeTo(width: number, height: number) {
        calls.push(["resizeTo", width, height]);
      },
      async setMinimumSize(width?: number | null, height?: number | null) {
        calls.push(["setMinimumSize", width, height]);
      },
      async setMaximumSize(width?: number | null, height?: number | null) {
        calls.push(["setMaximumSize", width, height]);
      },
      async setStyle(style: unknown) {
        calls.push(["setStyle", style]);
        return {
          frameless: true,
          keepOnTop: true,
          opacity: 0.88,
          background: { kind: "opaque" },
          platform: { windows: { cornerPreference: "round" } },
        } satisfies WebviewWindowStyle;
      },
      async setBackground(background: unknown, options: unknown) {
        calls.push(["setBackground", background, options]);
        return {
          frameless: true,
          keepOnTop: true,
          opacity: 0.88,
          background: { kind: "semantic", token: "blur", state: "active" },
          platform: { windows: { cornerPreference: "round" } },
        } satisfies WebviewWindowStyle;
      },
    };

    await styleKit.apply(target, {
      initWidth: 360,
      aspectRatio: 1.5,
      minWidth: 280,
      minHeight: 180,
      maxHeight: null,
      frameless: true,
      keepOnTop: true,
      opacity: 0.88,
      background: "blur",
      state: "active",
      platform: { windows: { cornerPreference: "round" } },
    });

    expect(calls).toEqual([
      ["setMinimumSize", 280, 180],
      ["setMaximumSize", undefined, null],
      ["resizeTo", 360, 240],
      [
        "setStyle",
        {
          frameless: true,
          keepOnTop: true,
          opacity: 0.88,
          platform: { windows: { cornerPreference: "round" } },
        },
      ],
      ["setBackground", "blur", { state: "active" }],
    ]);
  });

  it("normalizes shared window geometry without applying browser DPR scaling", () => {
    expect(windowGeometryKit.unit).toBe("desktopLogicalPixels");
    expect(
      windowGeometryKit.normalizeWindowRect({
        x: 10.4,
        y: 20.6,
        width: 199.5,
        height: 200.4,
      })
    ).toEqual({
      x: 10,
      y: 21,
      width: 200,
      height: 200,
    });
    expect(
      windowGeometryKit.clampRect(
        { x: 1180, y: 620, width: 320, height: 200 },
        { x: 0, y: 0, width: 1280, height: 680 }
      )
    ).toEqual({ x: 960, y: 480, width: 320, height: 200 });
  });

  it("runs backend media query callbacks from native window bounds", async () => {
    vi.useFakeTimers();
    try {
      const calls: unknown[] = [];
      let bounds = { x: 0, y: 0, width: 320, height: 220 };
      const target = {
        async getBounds() {
          return bounds;
        },
      };

      const watch = await mediaQueryKit.match(
        target,
        { minWidth: 300 },
        (_target, context) => {
          calls.push(["wide", context.bounds.width]);
        },
        {
          maxWidth: 299,
          callback(_target, context) {
            calls.push(["compact", context.bounds.width]);
          },
        }
      );
      bounds = { ...bounds, width: 260 };
      await watch.refresh();
      expect(calls).toEqual([["wide", 320]]);
      await vi.advanceTimersByTimeAsync(180);
      watch.stop();

      expect(calls).toEqual([
        ["wide", 320],
        ["compact", 260],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers media query callbacks while native interaction is active and resumes after exit", async () => {
    vi.useFakeTimers();
    try {
      const calls: unknown[] = [];
      let bounds = { x: 0, y: 0, width: 320, height: 220 };
      const listeners = new Map<string, Array<(event: unknown) => void>>();
      const target = {
        async getBounds() {
          return bounds;
        },
        listen<TPayload = unknown>(
          event: string,
          handler: (
            event: TPayload | { event: string; payload: TPayload }
          ) => void
        ) {
          const handlers = listeners.get(event) ?? [];
          handlers.push(handler as (event: unknown) => void);
          listeners.set(event, handlers);
          return () => {
            listeners.set(
              event,
              (listeners.get(event) ?? []).filter(
                (candidate) => candidate !== handler
              )
            );
          };
        },
      };

      const watch = await mediaQueryKit.match(
        target,
        { minWidth: 300 },
        (_target, context) => {
          calls.push(["wide", context.bounds.width]);
        },
        {
          maxWidth: 299,
          callback(_target, context) {
            calls.push(["compact", context.bounds.width]);
          },
        }
      );
      expect(calls).toEqual([["wide", 320]]);

      watch.pause();
      expect(watch.paused).toBe(true);
      bounds = { ...bounds, width: 260 };
      await watch.refresh();
      expect(calls).toEqual([["wide", 320]]);

      await watch.resume();
      expect(watch.paused).toBe(false);
      expect(calls).toEqual([
        ["wide", 320],
        ["compact", 260],
      ]);
      watch.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops media query watches when the host window reports hidden or closed", async () => {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const target = {
      async getBounds() {
        return { x: 0, y: 0, width: 320, height: 220 };
      },
      listen<TPayload = unknown>(
        event: string,
        handler: (
          event: TPayload | { event: string; payload: TPayload }
        ) => void
      ) {
        const handlers = listeners.get(event) ?? [];
        handlers.push(handler as (event: unknown) => void);
        listeners.set(event, handlers);
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter(
              (candidate) => candidate !== handler
            )
          );
        };
      },
    };

    const watch = await mediaQueryKit.match(
      target,
      { minWidth: 300 },
      () => {}
    );
    listeners.get("windowstatechange")?.[0]?.({
      event: "windowstatechange",
      payload: { visible: false },
    });

    expect(watch.active).toBe(false);
  });

  it("ignores in-flight background media query refresh errors after stop", async () => {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    let bounds = { x: 0, y: 0, width: 320, height: 220 };
    let blockNextBounds = false;
    let closed = false;
    let resolveEnteredBounds: (() => void) | undefined;
    let enteredBounds = Promise.resolve();
    let releaseBounds: (() => void) | undefined;
    const target = {
      async getBounds() {
        if (blockNextBounds) {
          resolveEnteredBounds?.();
          await new Promise<void>((resolve) => {
            releaseBounds = resolve;
          });
          if (closed) {
            throw new Error("broker connection closed");
          }
        }
        return bounds;
      },
      listen<TPayload = unknown>(
        event: string,
        handler: (
          event: TPayload | { event: string; payload: TPayload }
        ) => void
      ) {
        const handlers = listeners.get(event) ?? [];
        handlers.push(handler as (event: unknown) => void);
        listeners.set(event, handlers);
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter(
              (candidate) => candidate !== handler
            )
          );
        };
      },
    };

    const watch = await mediaQueryKit.match(
      target,
      { minWidth: 300 },
      () => {}
    );
    bounds = { ...bounds, width: 360 };
    blockNextBounds = true;
    enteredBounds = new Promise<void>((resolve) => {
      resolveEnteredBounds = resolve;
    });
    listeners.get("resized")?.[0]?.({
      event: "resized",
      payload: { width: 360, height: 220 },
    });
    await enteredBounds;
    watch.stop();
    closed = true;
    releaseBounds?.();
    await flushMicrotasks();

    expect(watch.active).toBe(false);
  });

  it("wraps automatic load failures with an actionable WebView error", async () => {
    const transport = new FailingLoadTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    await expect(
      attachWebview(tray).show({
        type: "show",
        html: "<main />",
        width: 300,
        height: 200,
      })
    ).rejects.toMatchObject({
      code: "webview_extension_load_failed",
      extensionName: "webview",
      mountId: "webview",
    } satisfies Partial<WebviewExtensionLoadError>);
  });

  it("exports page-facing global types that match the injected bridge surface", () => {
    expectTypeOf<Navigator["window"]>().toMatchTypeOf<
      WebviewNavigatorWindow | undefined
    >();
    expectTypeOf<Navigator["opentrayWindow"]>().toMatchTypeOf<
      WebviewNavigatorWindow | undefined
    >();
    expectTypeOf<Navigator["opentrayScreen"]>().toMatchTypeOf<
      WebviewNavigatorScreen | undefined
    >();
    expectTypeOf<Navigator["opentray"]>().toMatchTypeOf<
      WebviewNavigatorNamespace | undefined
    >();
    expectTypeOf<
      WebviewNavigatorNamespace["execCommand"]
    >().parameters.toEqualTypeOf<
      [command: "clearWhiteBlock" | (string & {})]
    >();
    expectTypeOf<
      WebviewNavigatorNamespace["execCommand"]
    >().returns.toEqualTypeOf<void>();
    expectTypeOf<WebviewNavigatorNamespace["ipc"]>().toMatchTypeOf<
      WebviewNavigatorIpc | undefined
    >();
    expectTypeOf<WebviewNavigatorNamespace["permissions"]>().toMatchTypeOf<
      WebviewNavigatorPermissions | undefined
    >();
    expectTypeOf<Navigator["opentrayPermissions"]>().toMatchTypeOf<
      WebviewNavigatorPermissions | undefined
    >();
    expectTypeOf<WebviewNavigatorIpc["postMessage"]>().parameters.toEqualTypeOf<
      [payload: unknown]
    >();
    expectTypeOf<Screen["getScreenDetails"]>().toMatchTypeOf<
      (() => Promise<WebviewScreenDetails>) | undefined
    >();
    expectTypeOf<Window["getScreenDetails"]>().toMatchTypeOf<
      (() => Promise<WebviewScreenDetails>) | undefined
    >();
    expectTypeOf<WebviewNavigatorWindow["invoke"]>().toBeFunction();
    expectTypeOf<WebviewNavigatorWindow["show"]>().returns.toEqualTypeOf<
      Promise<WebviewWindowState>
    >();
    expectTypeOf<WebviewNavigatorWindow["hide"]>().returns.toEqualTypeOf<
      Promise<WebviewWindowState>
    >();
    expectTypeOf<WebviewPermissionStore["namespace"]>().toEqualTypeOf<string>();
    expect(webviewBrowserPermissionFamilies).toContain("camera");
    expect(webviewBrowserPermissionFamilies).toContain("windowManagement");
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (frame.type === "get-tray-bounds") {
      return {
        type: "tray-bounds",
        requestId: frame.requestId,
        appId: frame.appId,
        trayId: frame.trayId,
        bounds: {
          kind: "unavailable",
          source: "backend.unavailable",
          rect: null,
        },
      };
    }
    return { type: "ack", requestId: frame.requestId };
  }
}

class WebviewResultTransport extends RecordingTransport {
  readonly #resolveData: (command: unknown) => unknown;

  constructor(resolveData: (command: unknown) => unknown) {
    super();
    this.#resolveData = resolveData;
  }

  override async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (frame.type === "ext-command") {
      return {
        type: "ext-command-result",
        requestId: frame.requestId,
        events: [
          {
            scope: { appId: frame.appId, trayId: frame.trayId, ext: frame.ext },
            data: this.#resolveData(frame.data),
          },
        ],
      };
    }
    return { type: "ack", requestId: frame.requestId };
  }
}

class FailingLoadTransport extends RecordingTransport {
  override async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (frame.type === "load-ext") {
      return {
        type: "error",
        requestId: frame.requestId,
        code: "kernel-error",
        message: "extension not found",
      };
    }
    return { type: "ack", requestId: frame.requestId };
  }
}

const isWebviewCommand = (value: unknown): value is WebviewCommand =>
  typeof value === "object" && value !== null && "type" in value;

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const eventually = async <T>(
  read: () => Promise<T | undefined>
): Promise<T> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("expected value to become available");
};
