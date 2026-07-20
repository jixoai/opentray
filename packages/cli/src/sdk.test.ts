import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AppIcon,
  ClientRequestFrame,
  CreateTrayOptions,
  Icon,
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

const crossPlatformAppIcon = (): AppIcon => [
  {
    platform: "darwin",
    format: "icns",
    source: { type: "encoded", data: [0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 8] },
  },
  {
    platform: "windows",
    format: "ico",
    source: { type: "encoded", data: [0, 0, 1, 0, 1, 0] },
  },
  {
    platform: "linux",
    format: "png",
    size: 32,
    source: { type: "encoded", data: [137, 80, 78, 71, 13, 10, 26, 10] },
  },
];

const appIconMissingCurrentPlatform = (): AppIcon => {
  if (process.platform === "darwin") {
    return [
      {
        platform: "windows",
        format: "ico",
        source: { type: "encoded", data: [0, 0, 1, 0, 1, 0] },
      },
    ];
  }
  return [
    {
      platform: "darwin",
      format: "icns",
      source: { type: "encoded", data: [0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 8] },
    },
  ];
};

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

    expect(mockState.runtimeOptions).toEqual([
      expect.objectContaining({ packageVersion: "0.10.0", appLaunch: expect.any(Object) }),
    ]);
    expect(tray.trayId).toBe("status");
    expect(transport.frames.map((frame) => frame.requestId)).toEqual([
      "opentray-1",
      "opentray-2",
    ]);
  });

  it("projects explicit platform appIcon without changing the tray icon", async () => {
    const trayIcon: Icon = {
      type: "rgba",
      data: [1, 2, 3, 4],
      width: 1,
      height: 1,
    };
    const appIcon = crossPlatformAppIcon();

    await createTray({ id: "status", icon: trayIcon }, { appIcon });

    expect(
      transport.frames.filter((frame) => frame.type === "set-app-icon")
    ).toEqual([
      expect.objectContaining({
        appIcon: appIcon.map((asset) => ({ ...asset, variant: "default" })),
      }),
    ]);
  });

  it("switches declared semantic variants through the App handle", async () => {
    const catalog: AppIcon = crossPlatformAppIcon().flatMap((asset) => [
      { ...asset, variant: ["default", "empty"] },
      { ...asset, variant: "files" },
    ]);
    const tray = await createTray({ id: "status" }, { appIcon: catalog });

    await tray.app.setAppIcon("files");

    expect(await tray.app.getAppIconVariant()).toBe("files");
    expect(
      transport.frames.filter(
        (frame) => frame.type === "set-app-icon-variant"
      )
    ).toEqual([expect.objectContaining({ variant: "files" })]);
  });

  it("rejects an explicit appIcon missing the current platform before opening a broker connection", async () => {
    await expect(
      createTray(
        { id: "status" },
        {
          appIcon: appIconMissingCurrentPlatform(),
        }
      )
    ).rejects.toMatchObject({ code: "OPENTRAY_INVALID_APP_ICON" });
    expect(mockState.runtimeOptions).toEqual([]);
  });

  it("does not promote a template-only tray icon into App identity", async () => {
    await createTray({
      id: "status",
      icon: {
        "darwin-icon-only": {
          type: "rgba",
          data: [1, 2, 3, 4],
          width: 1,
          height: 1,
          isTemplate: true,
        },
      },
    });

    expect(
      transport.frames.filter((frame) => frame.type === "set-app-icon")
    ).toEqual([]);
  });

  it("never promotes tray icons into App identity", async () => {
    const firstIcon: Icon = {
      type: "rgba",
      data: [1, 2, 3, 4],
      width: 1,
      height: 1,
    };
    const laterIcon: Icon = {
      type: "rgba",
      data: [5, 6, 7, 8],
      width: 1,
      height: 1,
    };

    await createTray({ id: "first", icon: firstIcon });
    await createTray({ id: "second", icon: laterIcon });

    expect(transport.appIcon).toBeUndefined();
    expect(
      transport.frames.filter((frame) => frame.type === "set-app-icon")
    ).toHaveLength(0);
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
  appName = "Test";
  appIcon: AppIcon | undefined;
  appIconVariant: string | undefined;
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
      case "get-app-identity":
        return {
          type: "app-identity",
          requestId: frame.requestId,
          identity: {
            appId: frame.appId,
            appName: this.appName,
            ...(this.appIcon === undefined ? {} : { appIcon: this.appIcon }),
            ...(this.appIconVariant === undefined
              ? {}
              : { appIconVariant: this.appIconVariant }),
          },
        };
      case "set-app-name":
        this.appName = frame.name;
        return { type: "ack", requestId: frame.requestId };
      case "set-app-icon":
        this.appIcon = frame.appIcon ?? undefined;
        this.appIconVariant = frame.appIcon === null ? undefined : "default";
        return { type: "ack", requestId: frame.requestId };
      case "set-app-icon-variant":
        this.appIconVariant = frame.variant;
        return { type: "ack", requestId: frame.requestId };
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
