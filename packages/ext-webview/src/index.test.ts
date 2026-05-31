import { describe, expect, it } from "vitest";

import { attachWebview } from "./index";
import type { TrayHandle } from "opentray";

describe("@opentray/ext-webview", () => {
  it("emits webview as a normal extension command", async () => {
    const commands: unknown[] = [];
    const tray: TrayHandle = {
      surface: { surfaceId: "surface-1", appId: "host" },
      trayId: "tray-1",
      async commandExtension(ext, data) {
        commands.push({ ext, data });
      },
      async destroy() {},
    };

    await attachWebview(tray).show({ type: "show", html: "<main />", width: 300, height: 200 });

    expect(commands).toEqual([
      {
        ext: "webview",
        data: { type: "show", html: "<main />", width: 300, height: 200 },
      },
    ]);
  });
});
