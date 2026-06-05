import { describe, expect, expectTypeOf, it } from "vitest";

import { attachWebview } from "./index";
import type {
  WebviewNavigatorNamespace,
  WebviewNavigatorScreen,
  WebviewNavigatorWindow,
  WebviewScreenDetails,
} from "./index";
import type { TrayHandle } from "opentray";

describe("@opentray/ext-webview", () => {
  it("emits webview as a normal extension command", async () => {
    const commands: unknown[] = [];
    const tray: TrayHandle = {
      space: { spaceId: "space-1" },
      trayId: "tray-1",
      async getBounds() {
        return {
          kind: "unavailable",
          source: "backend.unavailable",
          rect: null,
        };
      },
      async commandExtension(ext, data) {
        commands.push({ ext, data });
      },
      async destroy() {},
    };

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

    expect(commands).toEqual([
      {
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
    const commands: unknown[] = [];
    const tray: TrayHandle = {
      space: { spaceId: "space-1" },
      trayId: "tray-1",
      async getBounds() {
        return {
          kind: "unavailable",
          source: "backend.unavailable",
          rect: null,
        };
      },
      async commandExtension(ext, data) {
        commands.push({ ext, data });
      },
      async destroy() {},
    };

    const webview = attachWebview(tray);
    await webview.setContent({
      type: "setContent",
      html: "<main>updated</main>",
    });
    await webview.navigate("https://example.com/next");
    await webview.destroy();

    expect(commands).toEqual([
      {
        ext: "webview",
        data: {
          type: "setContent",
          html: "<main>updated</main>",
        },
      },
      {
        ext: "webview",
        data: {
          type: "navigate",
          url: "https://example.com/next",
        },
      },
      {
        ext: "webview",
        data: {
          type: "destroy",
        },
      },
    ]);
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
