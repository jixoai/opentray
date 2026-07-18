import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createTrayHandle, type OpenTrayTransport } from "opentray";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";

import { attachBadge, BadgeExt, isBadgeEvent } from "./index";

const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
} as const;

describe("@opentray/ext-badge", () => {
  it("declares platform packages relative to the official facade", () => {
    expect(BadgeExt.artifact).toMatchObject({
      kind: "package",
      targets: {
        "darwin-arm64": {
          packageName: "@opentray/ext-badge-darwin-arm64",
          libraryPath: "lib/libopentray_ext_badge.dylib",
        },
        "win32-x64": {
          packageName: "@opentray/ext-badge-windows-x64",
          libraryPath: "bin/opentray_ext_badge.dll",
        },
      },
    });
  });

  it("emits badge commands through the normal tray extension channel", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    const badge = attachBadge(tray, {
      mountId: "badge.tray-1",
      artifact: TEST_NATIVE_ARTIFACT,
    });
    await badge.setBadge("18");
    await badge.setAttention(true);

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "badge",
        path: TEST_NATIVE_ARTIFACT.path,
        mountId: "badge.tray-1",
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: "badge.tray-1",
        data: { type: "setBadge", value: "18" },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: "badge.tray-1",
        data: { type: "setAttention", value: true },
      },
    ]);
  });

  it("rejects progress operations when the host marks them unsupported", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    const badge = attachBadge(tray, {
      mountId: "badge.tray-1",
      artifact: TEST_NATIVE_ARTIFACT,
    });
    await expect(badge.setProgress(50, 100)).rejects.toThrow(/unsupported/);
    await expect(badge.setProgressState("paused")).rejects.toThrow(/unsupported/);
  });

  it("keeps the badge event guard aligned with the extension name", () => {
    expect(isBadgeEvent({ scope: { appId: "app", ext: "badge" }, data: { type: "result" } } as never)).toBe(
      true,
    );
    expect(
      isBadgeEvent({ scope: { appId: "app", ext: "webview" }, data: { type: "result" } } as never),
    ).toBe(false);
  });

  it("respects an explicit platform override when capability snapshots are seeded", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1");

    const badge = attachBadge(tray, {
      mountId: "badge.tray-1",
      artifact: TEST_NATIVE_ARTIFACT,
      platform: "linux",
    });
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
