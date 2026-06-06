import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION, type ClientRequestFrame, type ServerFrame } from "@opentray/spec";

const { connectLocalBroker } = vi.hoisted(() => ({
  connectLocalBroker: vi.fn(),
}));

vi.mock("./local-broker", () => ({
  connectLocalBroker,
}));

import { createSpace, createSurface, createTray, resolveDefaultSpace } from "./index";
import type { OpenTrayTransport, TrayExtension } from "./client";

describe("top-level opentray sdk facade", () => {
  beforeEach(() => {
    connectLocalBroker.mockReset();
  });

  it("exports createSpace through the broker-backed path", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    const space = await createSpace({ id: "space-primary", default: true }, { homeDir: "/tmp/opentray-home" });

    expect(space.space).toEqual({ spaceId: "space-primary" });
    expect(connectLocalBroker).toHaveBeenCalledWith({ homeDir: "/tmp/opentray-home" });
    expect(transport.frames).toEqual([{ type: "create-space", requestId: "opentray-1", id: "space-primary", default: true }]);
  });

  it("keeps createSurface as a deprecated top-level alias", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    const space = await createSurface({ id: "space-legacy" });

    expect(space.space).toEqual({ spaceId: "space-legacy" });
    expect(transport.frames).toEqual([{ type: "create-space", requestId: "opentray-1", id: "space-legacy" }]);
  });

  it("resolves the default space through the broker facade", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    const space = await resolveDefaultSpace();

    expect(space.space).toEqual({ spaceId: "space-default" });
    expect(transport.frames).toEqual([{ type: "resolve-default-space", requestId: "opentray-1" }]);
  });

  it("creates a tray under the broker default space when no explicit space is provided", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    const tray = await createTray({
      trayId: "status",
      title: "Status",
      icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
    });

    expect(tray.space).toEqual({ spaceId: "space-default" });
    expect(tray.trayId).toBe("status");
    expect(transport.frames).toEqual([
      { type: "resolve-default-space", requestId: "opentray-1" },
      {
        type: "create-tray",
        requestId: "opentray-2",
        space: { spaceId: "space-default" },
        tray: {
          trayId: "status",
          title: "Status",
          icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
        },
      },
    ]);
  });

  it("skips default-space lookup when createTray receives an explicit space", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    const tray = await createTray(
      {
        trayId: "status",
        title: "Status",
        icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
      },
      { space: { spaceId: "space-explicit" } },
    );

    expect(tray.space).toEqual({ spaceId: "space-explicit" });
    expect(transport.frames).toEqual([
      {
        type: "create-tray",
        requestId: "opentray-1",
        space: { spaceId: "space-explicit" },
        tray: {
          trayId: "status",
          title: "Status",
          icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
        },
      },
    ]);
  });

  it("forwards file-backed tray icons without local normalization", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    await createTray({
      trayId: "status",
      title: "Status",
      icon: { type: "file", path: "./assets/tray-icon.png" },
    });

    expect(transport.frames).toEqual([
      { type: "resolve-default-space", requestId: "opentray-1" },
      {
        type: "create-tray",
        requestId: "opentray-2",
        space: { spaceId: "space-default" },
        tray: {
          trayId: "status",
          title: "Status",
          icon: { type: "file", path: "./assets/tray-icon.png" },
        },
      },
    ]);
  });

  it("mounts tray extensions once and routes commands through the mount id", async () => {
    const transport = new RecordingTransport();
    connectLocalBroker.mockResolvedValue(transport);

    const tray = await createTray(
      {
        trayId: "status",
        title: "Status",
        icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
      },
      { space: { spaceId: "space-explicit" } },
    );
    const webviewExtension = {
      name: "webview",
      path: "@opentray/ext-webview",
      resolveMount() {
        return { mountId: "webview.status" };
      },
      extend(_tray, context) {
        return {
          async show() {
            await context.command({ type: "show" });
          },
        };
      },
    } satisfies TrayExtension<{ show(): Promise<void> }>;

    const webviewTray = tray.extend(webviewExtension);
    await webviewTray.show();
    await webviewTray.show();

    expect(transport.frames).toEqual([
      {
        type: "create-tray",
        requestId: "opentray-1",
        space: { spaceId: "space-explicit" },
        tray: {
          trayId: "status",
          title: "Status",
          icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
        },
      },
      {
        type: "load-ext",
        requestId: "opentray-2",
        spaceId: "space-explicit",
        name: "webview",
        path: "@opentray/ext-webview",
        mountId: "webview.status",
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        spaceId: "space-explicit",
        trayId: "status",
        ext: "webview.status",
        data: { type: "show" },
      },
      {
        type: "ext-command",
        requestId: "opentray-4",
        spaceId: "space-explicit",
        trayId: "status",
        ext: "webview.status",
        data: { type: "show" },
      },
    ]);
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    switch (frame.type) {
      case "create-space":
        return {
          type: "space-created",
          requestId: frame.requestId,
          space: { spaceId: frame.id ?? "space-created" },
        };
      case "resolve-default-space":
        return {
          type: "default-space",
          requestId: frame.requestId,
          space: { spaceId: "space-default" },
        };
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          spaceId: frame.space.spaceId,
          trayId: frame.tray.trayId ?? "tray-created",
        };
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          spaceId: frame.spaceId,
          trayId: frame.trayId,
          bounds: {
            kind: "unavailable",
            source: "backend.unavailable",
            rect: null,
          },
        };
      case "destroy-tray":
      case "set-tray-menu":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
        return { type: "ack", requestId: frame.requestId };
      case "health":
        return {
          type: "daemon-health",
          requestId: frame.requestId,
          health: {
            pid: 12_345,
            endpoint: "recorded",
            packageVersion: "0.3.1-test",
            protocolVersion: PROTOCOL_VERSION,
            sessionCount: 0,
            sessions: [],
          },
        };
    }
  }
}
