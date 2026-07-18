import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "opentray";

import { attachLynx, LynxExt } from "./index";

const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
} as const;

describe("@opentray/ext-lynx", () => {
  it("declares macOS packages relative to the official facade", () => {
    expect(LynxExt.artifact).toMatchObject({
      kind: "package",
      targets: {
        "darwin-arm64": {
          packageName: "@opentray/ext-lynx-darwin-arm64",
          libraryPath: "lib/libopentray_ext_lynx.dylib",
        },
      },
    });
  });

  it("emits lynx as a normal extension command", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    await attachLynx(tray, {
      mountId: "lynx",
      artifact: TEST_NATIVE_ARTIFACT,
    }).show({
      type: "show",
      bundlePath: "/tmp/demo.main.lynx.bundle",
      nativeWindowApi: true,
      bindWindowGlobals: false,
      nativeScreenApi: true,
      bindScreenGlobals: false,
      title: "OpenTray Lynx",
      icon: {
        type: "rgba",
        width: 1,
        height: 1,
        data: [15, 124, 109, 255],
      },
      minWidth: 320,
      minHeight: 180,
    });

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "lynx",
        path: TEST_NATIVE_ARTIFACT.path,
        mountId: "lynx",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "lynx",
        data: {
          type: "show",
          bundlePath: "/tmp/demo.main.lynx.bundle",
          nativeWindowApi: true,
          bindWindowGlobals: false,
          nativeScreenApi: true,
          bindScreenGlobals: false,
          title: "OpenTray Lynx",
          icon: {
            type: "rgba",
            width: 1,
            height: 1,
            data: [15, 124, 109, 255],
          },
          minWidth: 320,
          minHeight: 180,
        },
      },
    ]);
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    return { type: "ack", requestId: frame.requestId };
  }
}
