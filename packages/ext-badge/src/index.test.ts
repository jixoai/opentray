import { describe, expect, it } from "vitest";
import { createTrayHandle, type OpenTrayTransport } from "opentray";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";

import { attachBadge, BadgeExt, isBadgeEvent } from "./index";

describe("@opentray/ext-badge", () => {
  it("emits badge commands through the normal tray extension channel", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");

    const badge = attachBadge(tray, { mountId: "badge.tray-1" });
    await badge.setBadge("18");
    await badge.setAttention(true);

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        spaceId: "space-1",
        name: "badge",
        path: "@opentray/ext-badge",
        mountId: "badge.tray-1",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        spaceId: "space-1",
        trayId: "tray-1",
        ext: "badge.tray-1",
        data: { type: "setBadge", value: "18" },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        spaceId: "space-1",
        trayId: "tray-1",
        ext: "badge.tray-1",
        data: { type: "setAttention", value: true },
      },
    ]);
  });

  it("rejects progress operations when the host marks them unsupported", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");

    const badge = attachBadge(tray, { mountId: "badge.tray-1" });
    await expect(badge.setProgress(50, 100)).rejects.toThrow(/unsupported/);
    await expect(badge.setProgressState("paused")).rejects.toThrow(/unsupported/);
  });

  it("keeps the badge event guard aligned with the extension name", () => {
    expect(isBadgeEvent({ scope: { spaceId: "space", ext: "badge" }, data: { type: "result" } } as never)).toBe(
      true,
    );
    expect(
      isBadgeEvent({ scope: { spaceId: "space", ext: "webview" }, data: { type: "result" } } as never),
    ).toBe(false);
  });

  it("respects an explicit platform override when capability snapshots are seeded", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, { spaceId: "space-1" }, "tray-1");

    const badge = attachBadge(tray, { mountId: "badge.tray-1", platform: "linux" });
    const capabilities = await badge.getCapabilities();

    expect(capabilities.platform).toBe("linux");
    expect(capabilities.mode).toBe("reduced");
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    return { type: "ack", requestId: frame.requestId };
  }
}
