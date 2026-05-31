import { describe, expect, it } from "vitest";

import { parseServerFrame, type ClientFrame } from "./index";

describe("@opentray/spec", () => {
  it("does not throw on malformed protocol frames", () => {
    const parsed = parseServerFrame("{not-json");

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
  });

  it("keeps extension commands as typed protocol frames", () => {
    const frame: ClientFrame = {
      type: "ext-command",
      surfaceId: "surface-1",
      trayId: "tray-1",
      ext: "webview",
      data: { type: "show" },
    };

    expect(frame.ext).toBe("webview");
  });
});
