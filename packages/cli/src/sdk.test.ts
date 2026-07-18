import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClientRequestFrame,
  CreateTrayOptions,
  OpenTrayConnection,
  OpenTrayEventFrame,
  OpenTrayRuntimeOptions,
  ServerFrame,
} from "./index";

interface TestOpenTrayConnection extends OpenTrayConnection {
  close(): Promise<void>;
}

const mockState = vi.hoisted(
  (): {
    connection: TestOpenTrayConnection | null;
    runtimeOptions: OpenTrayRuntimeOptions[];
  } => ({
    connection: null,
    runtimeOptions: [],
  })
);

vi.mock("./local-broker", () => ({
  connectLocalBroker: async (
    options: OpenTrayRuntimeOptions = {}
  ): Promise<TestOpenTrayConnection> => {
    mockState.runtimeOptions.push(options);
    if (mockState.connection === null) {
      throw new Error("missing mocked OpenTray connection");
    }
    return mockState.connection;
  },
}));

import { createTray, PROTOCOL_VERSION } from "./index";

describe("opentray ergonomic createTray", () => {
  let transport: EventfulRecordingTransport;

  beforeEach(() => {
    transport = new EventfulRecordingTransport();
    mockState.connection = transport;
    mockState.runtimeOptions = [];
  });

  it("passes runtime options to the local broker connection", async () => {
    const tray = await createTray(
      { id: "status" },
      { packageVersion: "0.10.0" }
    );

    expect(mockState.runtimeOptions).toEqual([{ packageVersion: "0.10.0" }]);
    expect(tray.trayId).toBe("status");
    expect(transport.frames.map((frame) => frame.requestId)).toEqual([
      "opentray-1",
      "opentray-2",
    ]);
  });

  it("closes the caller-owned broker session when the tray is destroyed", async () => {
    const tray = await createTray({ id: "status" });

    await tray.destroy();
    await tray.destroy();

    expect(
      transport.frames.filter((frame) => frame.type === "destroy-tray")
    ).toHaveLength(1);
    expect(transport.closeCount).toBe(1);
  });

  it("closes the caller-owned broker session when tray creation fails", async () => {
    transport.failNextCreateTray = true;

    await expect(createTray({ id: "status" })).rejects.toThrow(
      "failed_create_tray"
    );

    expect(transport.closeCount).toBe(1);
  });

  it("normalizes shorthand menu items before sending protocol frames", async () => {
    const seen: string[] = [];
    const options: CreateTrayOptions = {
      id: "status",
      menu: {
        items: [
          {
            title: "Hide window",
            primaryEvent: true,
            onMenuClick: () => seen.push("hide"),
          },
          "-",
          "Quit",
          ["Group Name", ["Child 1", { title: "Child 2", id: 10 }]],
        ],
      },
    };

    await createTray(options);

    expect(createTrayFrame(transport).tray.menu).toEqual({
      items: [
        { type: "item", id: 1, title: "Hide window", primaryEvent: true },
        { type: "separator" },
        { type: "item", id: 2, title: "Quit" },
        {
          type: "submenu",
          title: "Group Name",
          items: [
            { type: "item", id: 3, title: "Child 1" },
            { type: "item", id: 10, title: "Child 2" },
          ],
        },
      ],
    });

    transport.emit({
      type: "event",
      event: {
        type: "menuClick",
        appId: "app-default",
        trayId: "status",
        itemId: 1,
      },
    });

    expect(seen).toEqual(["hide"]);
  });

  it("treats hyphen strings as separators and object hyphen titles as items", async () => {
    await createTray({
      id: "status",
      menu: { items: ["---", { title: "-" }] },
    });

    expect(createTrayFrame(transport).tray.menu).toEqual({
      items: [{ type: "separator" }, { type: "item", id: 1, title: "-" }],
    });
  });

  it("normalizes check and radio callbacks without leaking functions into protocol data", async () => {
    const seen: string[] = [];

    await createTray({
      id: "status",
      menu: {
        items: [
          {
            type: "check",
            title: "Enabled",
            checked: true,
            onMenuClick: () => seen.push("check"),
          },
          {
            type: "radio",
            title: "Mode A",
            group: 1,
            onMenuClick: () => seen.push("radio"),
          },
        ],
      },
    });

    expect(createTrayFrame(transport).tray.menu).toEqual({
      items: [
        { type: "check", id: 1, title: "Enabled", checked: true },
        { type: "radio", id: 2, title: "Mode A", group: 1 },
      ],
    });

    emitMenuClick(transport, 1);
    emitMenuClick(transport, 2);

    expect(seen).toEqual(["check", "radio"]);
  });

  it("replaces item-local callbacks only after setMenu succeeds", async () => {
    const seen: string[] = [];
    const tray = await createTray({
      id: "status",
      menu: {
        items: [{ id: 10, title: "Old", onMenuClick: () => seen.push("old") }],
      },
    });

    transport.failNextSetMenu = true;
    await expect(
      tray.setMenu({
        items: [{ title: "New", onMenuClick: () => seen.push("new") }],
      })
    ).rejects.toThrow("failed_set_menu");
    emitMenuClick(transport, 10);
    expect(seen).toEqual(["old"]);

    await tray.setMenu({
      items: [{ title: "New", onMenuClick: () => seen.push("new") }],
    });
    emitMenuClick(transport, 10);
    emitMenuClick(transport, 1);

    expect(seen).toEqual(["old", "new"]);
    expect(setMenuFrames(transport).at(-1)?.menu).toEqual({
      items: [{ type: "item", id: 1, title: "New" }],
    });
  });

  it("rejects duplicate click ids in ergonomic menus", async () => {
    await expect(
      createTray({
        id: "status",
        menu: {
          items: [
            { id: 1, title: "Open" },
            { type: "check", id: 1, title: "Enabled" },
          ],
        },
      })
    ).rejects.toThrow("duplicate menu item id: 1");
  });
});

class EventfulRecordingTransport implements TestOpenTrayConnection {
  readonly frames: ClientRequestFrame[] = [];
  closeCount = 0;
  failNextCreateTray = false;
  failNextSetMenu = false;
  private readonly listeners = new Set<(frame: OpenTrayEventFrame) => void>();

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    switch (frame.type) {
      case "resolve-default-app":
        return {
          type: "default-app",
          requestId: frame.requestId,
          app: { appId: "app-default" },
        };
      case "create-tray":
        if (this.failNextCreateTray) {
          this.failNextCreateTray = false;
          return {
            type: "error",
            requestId: frame.requestId,
            code: "failed_create_tray",
            message: "failed_create_tray",
          };
        }
        return {
          type: "tray-created",
          requestId: frame.requestId,
          appId: frame.app.appId,
          trayId: frame.tray.id,
        };
      case "set-tray-menu":
        if (this.failNextSetMenu) {
          this.failNextSetMenu = false;
          return {
            type: "error",
            requestId: frame.requestId,
            code: "failed_set_menu",
            message: "failed_set_menu",
          };
        }
        return { type: "ack", requestId: frame.requestId };
      case "destroy-tray":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
        return { type: "ack", requestId: frame.requestId };
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          appId: frame.appId,
          trayId: frame.trayId,
          bounds: {
            kind: "native",
            source: "test",
            rect: { x: 0, y: 0, width: 1, height: 1 },
          },
        };
      case "health":
        return {
          type: "runtime-host-health",
          requestId: frame.requestId,
          health: {
            pid: 1,
            packageVersion: "0.0.0",
            protocolVersion: PROTOCOL_VERSION,
            endpoint: "test",
            appId: "app-default",
            appName: "Test",
            callerLabel: "test",
            sessionCount: 0,
            sessions: [],
          },
        };
    }
    return {
      type: "error",
      requestId: frame.requestId,
      code: "unsupported",
      message: frame.type,
    };
  }

  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  emit(frame: OpenTrayEventFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }
}

const createTrayFrame = (
  transport: EventfulRecordingTransport
): Extract<ClientRequestFrame, { type: "create-tray" }> => {
  const frame = transport.frames.find(
    (
      candidate
    ): candidate is Extract<ClientRequestFrame, { type: "create-tray" }> =>
      candidate.type === "create-tray"
  );
  if (frame === undefined) {
    throw new Error("missing create-tray frame");
  }
  return frame;
};

const setMenuFrames = (
  transport: EventfulRecordingTransport
): Array<Extract<ClientRequestFrame, { type: "set-tray-menu" }>> =>
  transport.frames.filter(
    (
      candidate
    ): candidate is Extract<ClientRequestFrame, { type: "set-tray-menu" }> =>
      candidate.type === "set-tray-menu"
  );

const emitMenuClick = (
  transport: EventfulRecordingTransport,
  itemId: number
): void => {
  transport.emit({
    type: "event",
    event: {
      type: "menuClick",
      appId: "app-default",
      trayId: "status",
      itemId,
    },
  });
};
