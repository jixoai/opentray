import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  ClientRequestFrame,
  ServerFrame,
  WebviewLayoutDocument,
  WebviewLayoutLayer,
} from "@opentray/spec";
import {
  createTrayHandle,
  type NativeExtensionExpectedIdentity,
  type OpenTrayConnection,
  type OpenTrayEventFrame,
  type TrayHandle,
} from "opentray";

import {
  column,
  fixed,
  grow,
  row,
  view,
  WebviewExt as OfficialWebviewExt,
  type WebviewTrayCapability,
  WebviewOrchestrationError,
} from "./index";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "webview",
  artifactSetVersion: "test",
  contractFingerprint: "webview-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;
const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
  expectedIdentity: TEST_EXPECTED_IDENTITY,
} as const;
const WebviewExt = {
  ...OfficialWebviewExt,
  artifact: TEST_NATIVE_ARTIFACT,
};

const APP_ID = "app-1";
const TRAY_ID = "tray-1";
const MOUNT_ID = "webview.tray-1";
const OWNER = { appId: APP_ID, trayId: TRAY_ID, sessionId: "session-1" };

interface FrameFixture {
  name: string;
  frame: Record<string, unknown>;
}

const loadFrameFixtures = (file: string): FrameFixture[] =>
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../fixtures/frames/${file}`, import.meta.url)),
        "utf8",
      ),
    ) as FrameFixture[]
  ).map((entry) => ({ name: entry.name, frame: entry.frame }));

const commandFixtures = loadFrameFixtures("orchestration-commands.json");
const eventFixtures = loadFrameFixtures("webview-event-frames.json");
const channelFixtures = loadFrameFixtures("channel-frames.json");
const facadeFixtures = loadFrameFixtures("facade-bridge-frames.json");

const fixture = (list: FrameFixture[], name: string): Record<string, unknown> => {
  const found = list.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`missing fixture ${name}`);
  }
  return found.frame;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const defaultRespond = (data: unknown): unknown => {
  if (!isRecord(data) || typeof data.type !== "string") {
    return { type: "webview-ack", owner: OWNER, command: "unknown" };
  }
  switch (data.type) {
    case "channel.create":
      return fixture(channelFixtures, "channel.create result");
    case "channel.post":
      return fixture(channelFixtures, "channel.post result ok");
    case "channel.close":
      return fixture(channelFixtures, "channel.close result ok (idempotent)");
    case "channel.destroy":
      return fixture(channelFixtures, "channel.destroy result ok (idempotent)");
    case "channel.list":
      return fixture(channelFixtures, "channel.list result with live channel and closed tombstone");
    case "get-webview-url":
      return fixture(commandFixtures, "get-webview-url-result returns value and seq");
    case "get-webview-title":
      return fixture(commandFixtures, "get-webview-title-result returns value and seq");
    case "list-webviews":
      return fixture(commandFixtures, "list-webviews-result");
    case "drainWindowEvents":
      return { type: "windowEvents", events: [] };
    case "drainIpcMessages":
      return { type: "ipcMessages", messages: [] };
    case "drainPermissionMessages":
      return { type: "permissionMessages", messages: [] };
    case "show":
      return { type: "shown" };
    default:
      return { type: "webview-ack", owner: OWNER, command: data.type };
  }
};

/** Internal legacy poll commands the eventful facade issues on its own. */
const pollInternalCommands = new Set([
  "drainWindowEvents",
  "drainIpcMessages",
  "drainPermissionMessages",
]);

class OrchestrationTransport implements OpenTrayConnection {
  readonly frames: ClientRequestFrame[] = [];
  sessionId: string | undefined;
  closed = false;
  respondData: (data: unknown) => unknown = defaultRespond;
  readonly #listeners = new Set<(frame: OpenTrayEventFrame) => void>();

  extCommands(): Record<string, unknown>[] {
    return this.frames
      .filter(
        (frame): frame is Extract<ClientRequestFrame, { type: "ext-command" }> =>
          frame.type === "ext-command",
      )
      .map((frame) => frame.data as Record<string, unknown>)
      .filter((data) => !pollInternalCommands.has(String(data.type)));
  }

  emit(data: unknown): void {
    const frame: OpenTrayEventFrame = {
      type: "ext-event",
      appId: APP_ID,
      trayId: TRAY_ID,
      ext: MOUNT_ID,
      data,
    };
    for (const listener of this.#listeners) {
      listener(frame);
    }
  }

  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (this.closed) {
      throw new Error("broker connection closed");
    }
    if (frame.type === "ext-command") {
      return {
        type: "ext-command-result",
        requestId: frame.requestId,
        events: [
          {
            scope: { appId: frame.appId, trayId: frame.trayId, ext: frame.ext },
            data: this.respondData(frame.data),
          },
        ],
      };
    }
    return { type: "ack", requestId: frame.requestId };
  }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createOrchestrationTray = (
  transport: OrchestrationTransport,
): TrayHandle & WebviewTrayCapability =>
  createTrayHandle(transport, APP_ID, TRAY_ID).extend(WebviewExt, {
    mountId: MOUNT_ID,
  }) as TrayHandle & WebviewTrayCapability;

describe("webview orchestration facade", () => {
  it("compiles the layout sugar to the frozen fixture shapes", () => {
    const toolbarColumn = fixture(commandFixtures, "set-webview-layout toolbar column")
      .layout as WebviewLayoutDocument;
    expect(toolbarColumn.layers[0]?.root).toEqual(
      column([fixed("toolbar", 44), grow("content")], { gap: 1 }),
    );
    expect(
      row([view("a", { width: 120, minWidth: 100 }), grow("b", 2)], { gap: 8 }),
    ).toEqual({
      dir: "row",
      gap: 8,
      children: [
        { id: "a", width: 120, minWidth: 100 },
        { id: "b", flex: 2 },
      ],
    });
    expect(fixed("sidebar", { width: 200 })).toEqual({ id: "sidebar", width: 200 });
    expect(grow("content")).toEqual({ id: "content", flex: 1 });
  });

  it("sends the frozen set-webview-layout frames for documents and bare nodes", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    await win.setLayout(
      column([fixed("toolbar", 44), grow("content")], { gap: 1 }),
    );
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "set-webview-layout toolbar column"),
    );

    await win.setLayout(
      fixture(commandFixtures, "set-webview-layout layered box ring").layout as WebviewLayoutDocument,
    );
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "set-webview-layout layered box ring"),
    );

    await win.setLayout(
      fixture(
        commandFixtures,
        "set-webview-layout explicit webview kind and hidden layer",
      ).layout as { layers: WebviewLayoutLayer[] },
    );
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(
        commandFixtures,
        "set-webview-layout explicit webview kind and hidden layer",
      ),
    );
  });

  it("sends the frozen update-webview-layout patch frame", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    await win.layout.update("toolbar", { height: 48, minHeight: 32, maxHeight: 64 });
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "update-webview-layout sizing patch"),
    );
  });

  it("bootstraps an orchestrated window as show{windowOnly} plus create-webview children (3.3 friction #2)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({
      windowId: "main-window",
      width: 800,
      height: 600,
      webviews: [
        {
          id: "toolbar",
          url: "http://127.0.0.1:5173/toolbar.html",
          bridge: { webviewId: true, messageChannels: true },
        },
        { id: "content", url: "https://news.ycombinator.com" },
      ],
    });
    expect(win.windowId).toBe("main-window");

    await win.show();

    const commands = transport.extCommands();
    expect(commands).toHaveLength(3);
    expect(commands[0]).toEqual(
      fixture(facadeFixtures, "show bootstraps a windowOnly session for orchestrated children"),
    );
    // The shared command fixtures pin windowId "win-1"; this window binds
    // "main-window" — the projection rule is the only adapted field.
    expect(commands[1]).toEqual({
      ...fixture(commandFixtures, "create-webview with toolbar bridge policy"),
      windowId: "main-window",
    });
    expect(commands[2]).toEqual({
      ...fixture(commandFixtures, "create-webview without bridge policy"),
      windowId: "main-window",
    });
  });

  it("rejects webviews[] combined with html or url before any frame is sent", async () => {
    const transport = new OrchestrationTransport();
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({
      html: "<main />",
      webviews: [{ id: "content", url: "https://example.org" }],
    });
    await expect(win.show()).rejects.toThrow(/exclusive/);
    expect(transport.extCommands()).toHaveLength(0);
  });

  it("keeps the legacy single-webview show byte-identical without a session id", async () => {
    const transport = new OrchestrationTransport();
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({
      html: "<main />",
      width: 300,
      height: 200,
    });
    await win.show();
    const commands = transport.extCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      type: "show",
      html: "<main />",
      width: 300,
      height: 200,
    });
    expect(Object.hasOwn(commands[0] ?? {}, "sessionId")).toBe(false);

    await win.show();
    expect(transport.extCommands()).toHaveLength(2);
    expect(transport.extCommands()[1]).toEqual({ type: "show" });
  });

  it("attributes show and owner tuples with the broker Ready sessionId (3.3 friction #1)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({
      html: "<main />",
      width: 800,
      height: 600,
    });
    await win.show();
    expect(transport.extCommands()[0]).toEqual(
      fixture(facadeFixtures, "show attributes the window session with the broker Ready sessionId"),
    );

    const child = await win.createWebview({ id: "content", url: "https://news.ycombinator.com" });
    expect(child.id).toBe("content");
    expect(child.windowId).toBe("default");
    expect(transport.extCommands().at(-1)).toEqual({
      ...fixture(commandFixtures, "create-webview without bridge policy"),
      windowId: "default",
    });
  });

  it("sends the frozen child command frames and unwraps (value, seq) queries", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    const child = await win.createWebview({ id: "content", url: "https://news.ycombinator.com" });
    const toolbar = await win.createWebview({ id: "toolbar", url: "about:blank" });

    await child.navigate("https://example.org");
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "navigate-webview"));

    await child.back();
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "back-webview"));

    await child.forward();
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "forward-webview"));

    await toolbar.focus();
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "focus-webview"));

    await expect(child.getUrl()).resolves.toEqual({ url: "https://example.org/articles/1", seq: 41 });
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "get-webview-url"));

    await expect(child.getTitle()).resolves.toEqual({ title: "Example Article", seq: 12 });
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "get-webview-title"));

    await expect(win.listWebviews()).resolves.toEqual(
      fixture(commandFixtures, "list-webviews-result").webviews,
    );
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "list-webviews"));

    const banner = await win.createWebview({ id: "banner", html: "<p>offline</p>" });
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "create-webview with html content"),
    );

    await banner.destroy();
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "destroy-webview"));
  });

  it("resolves partial bridge policies into the frozen five-boolean DTO and omits absent ones", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    await win.createWebview({
      id: "toolbar",
      url: "http://127.0.0.1:5173/toolbar.html",
      bridge: { webviewId: true, messageChannels: true },
    });
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "create-webview with toolbar bridge policy"),
    );

    await win.createWebview({ id: "content", url: "https://news.ycombinator.com" });
    const frame = transport.extCommands().at(-1);
    expect(frame).toBeDefined();
    expect("bridge" in (frame ?? {})).toBe(false);

    await expect(
      win.createWebview({ id: "bad", url: "https://example.org", html: "<p/>" }),
    ).rejects.toThrow(/exactly one of url or html/);
  });

  it("materializes explicit subscribe/unsubscribe wire frames per kind", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const seen: string[] = [];
    const unlistenUrl = child.onUrlChange(({ url }) => seen.push(url));
    await flush();
    expect(transport.extCommands().at(-1)).toEqual({
      owner: OWNER,
      type: "subscribe-webview-events",
      windowId: "win-1",
      webviewId: "content",
      kinds: ["urlChange"],
    });

    const unlistenTitle = child.onTitleChange(() => {});
    await flush();
    expect(transport.extCommands().at(-1)).toEqual({
      owner: OWNER,
      type: "subscribe-webview-events",
      windowId: "win-1",
      webviewId: "content",
      kinds: ["titleChange"],
    });

    unlistenUrl();
    await flush();
    expect(transport.extCommands().at(-1)).toEqual({
      owner: OWNER,
      type: "unsubscribe-webview-events",
      windowId: "win-1",
      webviewId: "content",
      kinds: ["urlChange"],
    });

    unlistenTitle();
    await flush();
    expect(transport.extCommands().at(-1)).toEqual({
      owner: OWNER,
      type: "unsubscribe-webview-events",
      windowId: "win-1",
      webviewId: "content",
      kinds: ["titleChange"],
    });
  });

  it("routes per-view push frames by webview id and kind with frame-level payloads", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const content = await win.createWebview({ id: "content", url: "https://example.org" });
    const toolbar = await win.createWebview({ id: "toolbar", url: "about:blank" });

    const urlEvents: unknown[] = [];
    const titleEvents: unknown[] = [];
    const contentFocusEvents: unknown[] = [];
    const toolbarFocusEvents: unknown[] = [];
    const geometryEvents: unknown[] = [];
    content.onUrlChange((event) => urlEvents.push(event));
    content.onTitleChange((event) => titleEvents.push(event));
    content.onFocused((event) => contentFocusEvents.push(event));
    toolbar.onFocused((event) => toolbarFocusEvents.push(event));
    content.onGeometryChange((event) => geometryEvents.push(event));

    for (const { frame } of eventFixtures) {
      transport.emit(frame);
    }

    expect(urlEvents).toEqual([
      {
        windowId: "win-1",
        webviewId: "content",
        seq: 41,
        url: "https://example.org/articles/1",
      },
    ]);
    expect(titleEvents).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 12, title: "Example Article" },
    ]);
    // Both focus edges of a transfer reach their own view (2.7b facade half).
    expect(toolbarFocusEvents).toEqual([
      { windowId: "win-1", webviewId: "toolbar", seq: 3, focused: true },
    ]);
    expect(contentFocusEvents).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 7, focused: false },
    ]);
    expect(geometryEvents).toEqual([
      // The `bar` frame is not this window's view; only `content` frames route.
      { windowId: "win-1", webviewId: "content", seq: 9, rect: null },
    ]);
  });

  it("resolves the subscription race through (value, seq) queries plus stale-seq discard", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: { url: string; seq: number }[] = [];
    child.onUrlChange((event) => events.push(event));
    await flush();

    const queried = await child.getUrl();
    expect(queried).toEqual({ url: "https://example.org/articles/1", seq: 41 });

    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 40,
      payload: { url: "https://stale.example" },
    });
    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 42,
      payload: { url: "https://fresh.example" },
    });

    // Consumer-side D19 rule: discard events whose seq does not exceed the
    // queried seq — the facade supplies both halves of the contract.
    const fresh = events.filter((event) => event.seq > queried.seq);
    expect(fresh).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 42, url: "https://fresh.example" },
    ]);
  });

  it("stops synthesis at disconnect and keeps unlisten safe", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: unknown[] = [];
    const unlisten = child.onUrlChange((event) => events.push(event));
    await flush();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      transport.closed = true;
      await expect(child.getUrl()).rejects.toThrow("broker connection closed");

      expect(() => unlisten()).not.toThrow();
      const unlistenAfterDisconnect = child.onTitleChange(() => events.push("late"));
      expect(() => unlistenAfterDisconnect()).not.toThrow();
      await flush();
      expect(events).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("drops routing for destroyed webviews and windows", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const content = await win.createWebview({ id: "content", url: "https://example.org" });
    const events: unknown[] = [];
    content.onUrlChange((event) => events.push(event));
    await flush();

    await content.destroy();
    transport.emit(fixture(eventFixtures, "urlChange"));
    expect(events).toEqual([]);

    const toolbar = await win.createWebview({ id: "toolbar", url: "about:blank" });
    const toolbarEvents: unknown[] = [];
    toolbar.onUrlChange((event) => toolbarEvents.push(event));
    await win.destroy();
    transport.emit(fixture(eventFixtures, "urlChange"));
    expect(toolbarEvents).toEqual([]);
  });

  it("unwraps typed Ok-data error envelopes into rejections (3.3 friction #3)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    transport.respondData = () =>
      fixture(facadeFixtures, "typed orchestration rejection rides the Ok response data");
    const rejection = await win
      .createWebview({ id: "second", url: "https://example.org" })
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(WebviewOrchestrationError);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as WebviewOrchestrationError).code).toBe("multiwebview_unsupported_style");
    expect((rejection as WebviewOrchestrationError).message).toContain(
      "frameless windows cannot host multiple webviews",
    );

    transport.respondData = () =>
      fixture(facadeFixtures, "typed channel rejection rides the Ok response data");
    const channelRejection = await win
      .createMessageChannel({ target: "content" })
      .catch((error: unknown) => error);
    expect(channelRejection).toBeInstanceOf(WebviewOrchestrationError);
    expect((channelRejection as WebviewOrchestrationError).code).toBe("bridge_required");
  });

  it("rejects on non-echoing acks as a protocol violation", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    transport.respondData = (data) =>
      isRecord(data) && data.type === "navigate-webview"
        ? { type: "webview-ack", owner: OWNER, command: "focus-webview" }
        : defaultRespond(data);
    const child = await win.createWebview({ id: "content", url: "https://example.org" });
    await expect(child.navigate("https://example.org")).rejects.toThrow(/echoed/);
  });

  it("surfaces the channel host surface with frozen frames and endpoint semantics", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    await win.createWebview({ id: "toolbar", url: "about:blank" });

    const endpoint = await win.createMessageChannel({ target: "toolbar" });
    expect(endpoint.id).toBe("ch-7f3a");
    expect(transport.extCommands().at(-1)).toEqual(fixture(channelFixtures, "channel.create request"));

    await endpoint.post("reload");
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(channelFixtures, "channel.post with string payload"),
    );
    await endpoint.post({ type: "navigate", url: "https://example.com" });
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(channelFixtures, "channel.post with json payload"),
    );

    await expect(win.listMessageChannels()).resolves.toEqual(
      fixture(channelFixtures, "channel.list result with live channel and closed tombstone").channels,
    );
    expect(transport.extCommands().at(-1)).toEqual(fixture(channelFixtures, "channel.list request"));

    await endpoint.close();
    expect(transport.extCommands().at(-1)).toEqual(fixture(channelFixtures, "channel.close request"));
    const framesAfterClose = transport.frames.length;
    await endpoint.close();
    expect(transport.frames.length).toBe(framesAfterClose);

    await expect(endpoint.post("nope")).rejects.toMatchObject({
      code: "not_open",
    });

    await endpoint.destroy();
    expect(transport.extCommands().at(-1)).toEqual(fixture(channelFixtures, "channel.destroy request"));
    const framesAfterDestroy = transport.frames.length;
    await endpoint.destroy();
    expect(transport.frames.length).toBe(framesAfterDestroy);

    // The window-level destroy by id stays a wire command for channels this
    // facade did not create locally (page-created channels).
    await win.destroyMessageChannel("ch-2b91");
    expect(transport.extCommands().at(-1)).toEqual({
      owner: OWNER,
      type: "channel.destroy",
      channelId: "ch-2b91",
    });
  });

  it("delivers host channel messages and the single closure observation", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    await win.createWebview({ id: "toolbar", url: "about:blank" });

    const endpoint = await win.createMessageChannel({ target: "toolbar" });

    // Pre-subscription buffering: a message flushed before onMessage stays
    // queued and drains FIFO at registration.
    transport.emit(
      fixture(facadeFixtures, "host channel message rides the internal channel.message envelope"),
    );
    const messages: unknown[] = [];
    const unlistenMessage = endpoint.onMessage((payload) => messages.push(payload));
    expect(messages).toEqual([{ type: "navigate", url: "https://example.com" }]);

    transport.emit({
      owner: OWNER,
      type: "channel.message",
      channelId: "ch-7f3a",
      payload: "reload",
    });
    expect(messages).toEqual([
      { type: "navigate", url: "https://example.com" },
      "reload",
    ]);

    const closures: unknown[] = [];
    endpoint.onClose((notice) => closures.push(notice));
    const closedFrame = fixture(channelFixtures, "channel.closed push event with reason");
    transport.emit(closedFrame);
    transport.emit(closedFrame);
    expect(closures).toEqual([{ reason: "peer_webview_destroyed" }]);

    unlistenMessage();
  });

  it("buffers the closure notice until the first onClose registration", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    await win.createWebview({ id: "toolbar", url: "about:blank" });
    const endpoint = await win.createMessageChannel({ target: "toolbar" });

    transport.emit(fixture(channelFixtures, "channel.closed push event with reason"));
    const closures: unknown[] = [];
    endpoint.onClose((notice) => closures.push(notice));
    expect(closures).toEqual([{ reason: "peer_webview_destroyed" }]);
  });

  it("observes channel.created pushes on the host facade surface", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    const created: unknown[] = [];
    const unlisten = win.onCreatedMessageChannel((notice) => created.push(notice));
    transport.emit(fixture(channelFixtures, "channel.created push event to the target webview"));
    expect(created).toEqual([{ channelId: "ch-7f3a" }]);

    unlisten();
    transport.emit(fixture(channelFixtures, "channel.created push event to the target webview"));
    expect(created).toEqual([{ channelId: "ch-7f3a" }]);
  });

  it("reports subscribe transport failures once without synthesizing events", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      transport.closed = true;
      const events: unknown[] = [];
      child.onUrlChange((event) => events.push(event));
      await flush();
      expect(events).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
        "WebView orchestration frame failed",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
