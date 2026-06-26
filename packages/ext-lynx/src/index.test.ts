import { describe, expect, it } from "vitest";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "opentray";

import { attachLynx } from "./index";

describe("@opentray/ext-lynx", () => {
  it("emits lynx as a normal extension command", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    await attachLynx(tray).show({
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
        type: "ext-command",
        requestId: "opentray-1",
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
