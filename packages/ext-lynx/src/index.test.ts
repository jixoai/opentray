import { describe, expect, it } from "vitest";

import { attachLynx } from "./index";
import type { TrayHandle } from "opentray";

describe("@opentray/ext-lynx", () => {
  it("emits lynx as a normal extension command", async () => {
    const commands: unknown[] = [];
    const tray: TrayHandle = {
      space: { spaceId: "space-1" },
      trayId: "tray-1",
      async commandExtension(ext, data) {
        commands.push({ ext, data });
      },
      async destroy() {},
    };

    await attachLynx(tray).show({
      type: "show",
      bundlePath: "/tmp/demo.main.lynx.bundle",
      fitContentSize: true,
      nativeWindowApi: true,
      bindWindowGlobals: false,
      minWidth: 320,
      minHeight: 180,
    });

    expect(commands).toEqual([
      {
        ext: "lynx",
        data: {
          type: "show",
          bundlePath: "/tmp/demo.main.lynx.bundle",
          fitContentSize: true,
          nativeWindowApi: true,
          bindWindowGlobals: false,
          minWidth: 320,
          minHeight: 180,
        },
      },
    ]);
  });
});
