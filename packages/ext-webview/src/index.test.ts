import { describe, expect, expectTypeOf, it } from "vitest";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "opentray";

import { attachWebview, WebviewExt, WebviewExtensionLoadError } from "./index";
import type {
  WebviewCommand,
  WebviewNavigatorNamespace,
  WebviewNavigatorScreen,
  WebviewNavigatorWindow,
  WebviewScreenDetails,
} from "./index";

describe("@opentray/ext-webview", () => {
  it("extends a tray with an isolated WebView window mount", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");
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
        spaceId: "space-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview.tray-1",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        spaceId: "space-1",
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

  it("keeps attachWebview on the legacy webview mount and auto-loads once", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");

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
        transparent: true,
        keepOnTop: true,
        platform: {
          macos: {
            material: "hudWindow",
            materialState: "active",
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
        spaceId: "space-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        spaceId: "space-1",
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
            transparent: true,
            keepOnTop: true,
            platform: {
              macos: {
                material: "hudWindow",
                materialState: "active",
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

  it("exposes explicit lifecycle verbs instead of overloading repeated show", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");

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
        spaceId: "space-1",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        spaceId: "space-1",
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
        spaceId: "space-1",
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
        spaceId: "space-1",
        trayId: "tray-1",
        ext: "webview",
        data: {
          type: "destroy",
        },
      },
    ]);
  });

  it("wraps automatic load failures with an actionable WebView error", async () => {
    const transport = new FailingLoadTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");

    await expect(
      attachWebview(tray).show({
        type: "show",
        html: "<main />",
        width: 300,
        height: 200,
      }),
    ).rejects.toMatchObject({
      code: "webview_extension_load_failed",
      extensionName: "webview",
      mountId: "webview",
    } satisfies Partial<WebviewExtensionLoadError>);
  });

  it("exports page-facing global types that match the injected bridge surface", () => {
    expectTypeOf<Navigator["window"]>().toMatchTypeOf<WebviewNavigatorWindow | undefined>();
    expectTypeOf<Navigator["opentrayWindow"]>().toMatchTypeOf<WebviewNavigatorWindow | undefined>();
    expectTypeOf<Navigator["opentrayScreen"]>().toMatchTypeOf<WebviewNavigatorScreen | undefined>();
    expectTypeOf<Navigator["opentray"]>().toMatchTypeOf<WebviewNavigatorNamespace | undefined>();
    expectTypeOf<Screen["getScreenDetails"]>().toMatchTypeOf<
      (() => Promise<WebviewScreenDetails>) | undefined
    >();
    expectTypeOf<Window["getScreenDetails"]>().toMatchTypeOf<
      (() => Promise<WebviewScreenDetails>) | undefined
    >();
    expectTypeOf<WebviewNavigatorWindow["invoke"]>().toBeFunction();
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
        spaceId: frame.spaceId,
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
