import { describe, expect, it } from "vitest";

import { createTrayHandle, type OpenTrayTransport } from "./index";

describe("opentray client", () => {
  it("routes extension commands through public protocol", async () => {
    const frames: unknown[] = [];
    const transport: OpenTrayTransport = {
      async send(frame) {
        frames.push(frame);
      },
    };
    const tray = createTrayHandle(transport, { surfaceId: "surface-1", appId: "host" }, "tray-1");

    await tray.commandExtension("webview", { type: "show", width: 320, height: 240 });

    expect(frames).toEqual([
      {
        type: "ext-command",
        surfaceId: "surface-1",
        trayId: "tray-1",
        ext: "webview",
        data: { type: "show", width: 320, height: 240 },
      },
    ]);
  });
});
