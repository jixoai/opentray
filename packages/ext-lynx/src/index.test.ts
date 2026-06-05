import { describe, expect, it } from "vitest";

import { attachLynx } from "./index";
import type { TrayHandle } from "opentray";

describe("@opentray/ext-lynx", () => {
  it("emits lynx as a normal extension command", async () => {
    const commands: unknown[] = [];
    const tray: TrayHandle = {
      space: { spaceId: "space-1" },
      trayId: "tray-1",
      async getBounds() {
        return {
          kind: "unavailable",
          source: "test.stub",
          rect: null,
        };
      },
      async commandExtension(ext, data) {
        commands.push({ ext, data });
      },
      async destroy() {},
    };

    await attachLynx(tray).show({
      type: "show",
      bundlePath: "/tmp/demo.main.lynx.bundle",
    });

    expect(commands).toEqual([
      {
        ext: "lynx",
        data: {
          type: "show",
          bundlePath: "/tmp/demo.main.lynx.bundle",
        },
      },
    ]);
  });
});
