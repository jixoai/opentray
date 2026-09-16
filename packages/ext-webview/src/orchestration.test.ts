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
    case "get-webview-favicon":
      return fixture(commandFixtures, "get-webview-favicon-result returns value and seq");
    case "list-webviews":
      return fixture(commandFixtures, "list-webviews-result");
    case "subscribeWindowEvents":
      return { type: "windowEventsSubscribed", events: data.events };
    case "unsubscribeWindowEvents":
      return { type: "windowEventsUnsubscribed", events: data.events };
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

/** Internal commands the eventful facade issues on its own: permission/ipc
 * polls plus the batch C window-event subscription bookkeeping driven by
 * listener accounting (including the internal app-reopen MRU listeners). */
const pollInternalCommands = new Set([
  "drainIpcMessages",
  "drainPermissionMessages",
  "subscribeWindowEvents",
  "unsubscribeWindowEvents",
]);

class OrchestrationTransport implements OpenTrayConnection {
  readonly frames: ClientRequestFrame[] = [];
  sessionId: string | undefined;
  closed = false;
  respondData: (data: unknown) => unknown = defaultRespond;
  readonly #listeners = new Set<(frame: OpenTrayEventFrame) => void>();
  readonly #deadListeners = new Set<(error: Error) => void>();
  readonly #deathBarriers: Array<(error: Error) => void> = [];

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

  onConnectionDead(listener: (error: Error) => void): () => void {
    this.#deadListeners.add(listener);
    return () => {
      this.#deadListeners.delete(listener);
    };
  }

  /** Abrupt broker death: in-flight requests reject, terminal listeners fire. */
  kill(): void {
    this.closed = true;
    const error = new Error("broker connection closed");
    for (const reject of this.#deathBarriers.splice(0)) {
      reject(error);
    }
    for (const listener of this.#deadListeners) {
      listener(error);
    }
  }

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (this.closed) {
      throw new Error("broker connection closed");
    }
    if (frame.type === "ext-command") {
      // A death barrier races the responder so an in-flight query can hang
      // until kill(), exactly like a request pending on a dying socket.
      let releaseBarrier: () => void = () => {};
      const barrier = new Promise<never>((_, reject) => {
        this.#deathBarriers.push(reject);
        releaseBarrier = () => {
          const index = this.#deathBarriers.indexOf(reject);
          if (index >= 0) {
            this.#deathBarriers.splice(index, 1);
          }
        };
      });
      let data: unknown;
      try {
        data = await Promise.race([this.respondData(frame.data), barrier]);
      } finally {
        releaseBarrier();
      }
      return {
        type: "ext-command-result",
        requestId: frame.requestId,
        events: [
          {
            scope: { appId: frame.appId, trayId: frame.trayId, ext: frame.ext },
            data,
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

    await expect(child.getFavicon()).resolves.toEqual({
      value: { href: "https://example.org/favicon.ico" },
      seq: 71,
    });
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "get-webview-favicon"));

    await child.setNavigationRules([{ pattern: "*://*.tracker.example/*", action: "block" }]);
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "set-webview-navigation-rules"),
    );
    await expect(
      child.setNavigationRules([{ pattern: "", action: "block" }] as never),
    ).rejects.toThrow(/non-empty/);

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

  it("forwards browser options (contract-5 contextMenu) verbatim into the create-webview frame", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();

    // Explicit contextMenu rides the browser DTO unchanged; the default
    // resolution (bridged child → engine menu hidden) is native-side law.
    await win.createWebview({
      id: "toolbar",
      url: "http://127.0.0.1:5173/toolbar.html",
      bridge: { webviewId: true, messageChannels: true },
      browser: { contextMenu: true },
    });
    expect(transport.extCommands().at(-1)).toMatchObject({
      type: "create-webview",
      webviewId: "toolbar",
      bridge: {
        webviewId: true,
        messageChannels: true,
        navigatorWindow: false,
        navigatorScreen: false,
        nativeApi: false,
      },
      browser: { contextMenu: true },
    });

    // Absent browser options stay absent on the wire (defaults are native).
    await win.createWebview({ id: "content", url: "https://example.org" });
    expect(transport.extCommands().at(-1)).not.toHaveProperty("browser");
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

  it("routes navigationAction and faviconChange pushes and resyncs favicon gaps", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const content = await win.createWebview({
      id: "content",
      url: "https://example.org",
      favicon: true,
      navigationRules: [{ pattern: "*://*.tracker.example/*", action: "block" }],
    });
    expect(transport.extCommands().at(-1)).toEqual(
      fixture(commandFixtures, "create-webview with favicon and navigation rules"),
    );

    const navEvents: unknown[] = [];
    const faviconEvents: unknown[] = [];
    content.onNavigationAction((event) => navEvents.push(event));
    content.onFaviconChange((event) => faviconEvents.push(event));

    transport.emit(fixture(eventFixtures, "navigationAction link user initiated"));
    transport.emit(fixture(eventFixtures, "navigationAction redirect without user flag"));
    transport.emit(fixture(eventFixtures, "faviconChange settled href"));

    expect(navEvents).toEqual([
      {
        windowId: "win-1",
        webviewId: "content",
        seq: 61,
        url: "https://example.org/articles/2",
        navigationType: "link",
        isUserInitiated: true,
      },
      {
        windowId: "win-1",
        webviewId: "content",
        seq: 62,
        url: "https://example.org/login",
        navigationType: "redirect",
      },
    ]);
    expect(faviconEvents).toEqual([
      {
        windowId: "win-1",
        webviewId: "content",
        seq: 71,
        href: "https://example.org/favicon.ico",
      },
    ]);

    // Latest-class gap repair: a favicon frame that jumps the shared per-view
    // seq (71 -> 90) triggers the (value, seq) query; the responder's lower
    // observation is discarded as stale, so the direct delivery stands alone
    // (same convergence law as the urlChange resync suite below).
    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "faviconChange",
      seq: 90,
      payload: { href: "https://example.org/favicon-2.ico" },
    });
    await flush();
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "get-webview-favicon"));
    expect(faviconEvents).toHaveLength(2);
    expect(faviconEvents.at(-1)).toEqual({
      windowId: "win-1",
      webviewId: "content",
      seq: 90,
      href: "https://example.org/favicon-2.ico",
    });
  });

  it("a urlChange gap resync never delivers into title listeners (R1 P2 regression)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const content = await win.createWebview({ id: "content", url: "https://example.org" });

    const urlEvents: unknown[] = [];
    const titleEvents: unknown[] = [];
    content.onUrlChange((event) => urlEvents.push(event));
    content.onTitleChange((event) => titleEvents.push(event));

    // First observation seeds the shared counter, then a jump (41 -> 45)
    // triggers the urlChange gap resync; the responder's query result
    // (seq 41 shape) must not reach the title handlers.
    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 41,
      payload: { url: "https://example.org/a" },
    });
    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 45,
      payload: { url: "https://example.org/b" },
    });
    await flush();
    expect(transport.extCommands().at(-1)).toEqual(fixture(commandFixtures, "get-webview-url"));
    expect(urlEvents).toHaveLength(2);
    expect(titleEvents).toEqual([]);
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

    // D19 final review B6: the facade itself owns the discard — the stale
    // (<= queried seq) frame never reaches the handler, and an equal seq is
    // dropped too; only the genuinely newer observation is delivered.
    expect(events).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 42, url: "https://fresh.example" },
    ]);
    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 42,
      payload: { url: "https://duplicate.example" },
    });
    expect(events).toHaveLength(1);
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

  it("notifies terminal death, stops delivery, and absorbs late subscriptions into the dead state (D3)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: unknown[] = [];
    child.onUrlChange((event) => events.push(event));
    await flush();

    const deaths: Error[] = [];
    win.onConnectionDead((error) => deaths.push(error));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      transport.kill();
      await flush();

      // Terminal notification fired exactly once and the handle is observably dead.
      expect(deaths).toHaveLength(1);
      expect(deaths[0]?.message).toBe("broker connection closed");
      expect(win.connectionDead).toBe(true);

      // Delivery stopped: a late frame never reaches handlers.
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: 50,
        payload: { url: "https://dead.example" },
      });
      await flush();
      expect(events).toEqual([]);

      // (value, seq) queries after death reject, never hang.
      await expect(child.getUrl()).rejects.toThrow("broker connection closed");
      await expect(child.getTitle()).rejects.toThrow("broker connection closed");

      // A best-effort subscribe after death is absorbed into the dead state
      // (no frame leaves, no console noise, no silent exception).
      const late = child.onFocused(() => events.push("late"));
      late();
      await flush();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("cancels an in-flight gap resync at connection death instead of reporting console noise (D3)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: unknown[] = [];
    child.onUrlChange((event) => events.push(event));
    await flush();
    transport.frames.length = 0;

    // The resync query hangs in flight (pending on the dying transport).
    transport.respondData = (data) =>
      isRecord(data) && data.type === "get-webview-url"
        ? new Promise(() => {})
        : defaultRespond(data);

    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 5,
      payload: { url: "https://example.org/c" },
    });
    await flush();
    expect(events).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 5, url: "https://example.org/c" },
    ]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      transport.kill();
      await flush();
      await flush();

      // The cancelled resync rejection merged into the connection-dead state:
      // no synthesized event, no console.error, observable dead state.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(events).toEqual([
        { windowId: "win-1", webviewId: "content", seq: 5, url: "https://example.org/c" },
      ]);
      expect(win.connectionDead).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("closes channel endpoints locally with session_closed at connection death (D3)", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const channel = await win.createMessageChannel({ target: "content" });
    const closeReasons: string[] = [];
    channel.onClose((notice) => closeReasons.push(notice.reason));

    transport.kill();
    await flush();

    expect(closeReasons).toEqual(["session_closed"]);
    await expect(channel.post({ hello: true })).rejects.toThrow("not_open");
    expect(win.connectionDead).toBe(true);
  });

  it("resyncs urlChange through the (value, seq) query after a sequence gap and converges", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: { url: string; seq: number }[] = [];
    child.onUrlChange((event) => events.push(event));
    await flush();
    transport.frames.length = 0;

    const emitUrl = (seq: number, url: string): void => {
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq,
        payload: { url },
      });
    };

    // Contiguous delivery: no gap, no query.
    emitUrl(2, "https://example.org/a");
    expect(events).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 2, url: "https://example.org/a" },
    ]);
    expect(
      transport.extCommands().filter((data) => data.type === "get-webview-url"),
    ).toEqual([]);

    // Gap (2 -> 5): the resync query returns a higher observation.
    transport.respondData = (data) =>
      isRecord(data) && data.type === "get-webview-url"
        ? { type: "get-webview-url-result", url: "https://example.org/latest", seq: 7 }
        : defaultRespond(data);
    emitUrl(5, "https://example.org/c");
    await flush();

    expect(transport.extCommands().filter((data) => data.type === "get-webview-url")).toEqual([
      { owner: OWNER, type: "get-webview-url", windowId: "win-1", webviewId: "content" },
    ]);
    expect(events).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 2, url: "https://example.org/a" },
      { windowId: "win-1", webviewId: "content", seq: 5, url: "https://example.org/c" },
      // The higher query observation is delivered as a synthesized push.
      { windowId: "win-1", webviewId: "content", seq: 7, url: "https://example.org/latest" },
    ]);

    // Convergence: the frame after the resync is contiguous again — no query.
    emitUrl(8, "https://example.org/d");
    await flush();
    expect(events.at(-1)).toEqual({
      windowId: "win-1",
      webviewId: "content",
      seq: 8,
      url: "https://example.org/d",
    });
    expect(
      transport.extCommands().filter((data) => data.type === "get-webview-url"),
    ).toHaveLength(1);
  });

  it("resyncs titleChange after a gap and coalesces concurrent gaps into one query", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: { title: string; seq: number }[] = [];
    child.onTitleChange((event) => events.push(event));
    await flush();
    transport.frames.length = 0;

    transport.respondData = (data) =>
      isRecord(data) && data.type === "get-webview-title"
        ? { type: "get-webview-title-result", title: "Latest Title", seq: 9 }
        : defaultRespond(data);

    const emitTitle = (seq: number, title: string): void => {
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "titleChange",
        seq,
        payload: { title },
      });
    };

    emitTitle(3, "Third");
    // Two gaps fire back-to-back before the in-flight query resolves; the
    // second must ride the same single query, not start a second one.
    emitTitle(6, "Sixth");
    emitTitle(8, "Eighth");
    await flush();

    const queries = transport
      .extCommands()
      .filter((data) => data.type === "get-webview-title");
    expect(queries).toHaveLength(1);
    expect(events).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 3, title: "Third" },
      { windowId: "win-1", webviewId: "content", seq: 6, title: "Sixth" },
      { windowId: "win-1", webviewId: "content", seq: 8, title: "Eighth" },
      { windowId: "win-1", webviewId: "content", seq: 9, title: "Latest Title" },
    ]);
  });

  it("reports a failed resync query once without breaking later delivery", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: { url: string; seq: number }[] = [];
    child.onUrlChange((event) => events.push(event));
    await flush();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      transport.respondData = (data) =>
        isRecord(data) && data.type === "get-webview-url"
          ? { type: "webview-ack", owner: OWNER, command: "get-webview-url" }
          : defaultRespond(data);
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: 2,
        payload: { url: "https://example.org/baseline" },
      });
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: 4,
        payload: { url: "https://example.org/gap" },
      });
      await flush();
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // The gap frame itself was delivered; delivery continues afterward.
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: 5,
        payload: { url: "https://example.org/next" },
      });
      expect(events.at(-1)).toEqual({
        windowId: "win-1",
        webviewId: "content",
        seq: 5,
        url: "https://example.org/next",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("discards an in-flight resync query result that a newer frame already outranks", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: { url: string; seq: number }[] = [];
    child.onUrlChange((event) => events.push(event));
    await flush();

    const emitUrl = (seq: number, url: string): void => {
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq,
        payload: { url },
      });
    };

    // Baseline contiguous frame.
    emitUrl(2, "https://example.org/a");
    expect(events).toHaveLength(1);

    // D19 final review B6: a gap opens a resync query, but a HIGHER frame
    // (8) is delivered while the query is still in flight. The query then
    // resolves with the now-stale observation 7 — it must be discarded at
    // completion, never injected into the handler stream.
    transport.respondData = (data) =>
      isRecord(data) && data.type === "get-webview-url"
        ? { type: "get-webview-url-result", url: "https://example.org/stale-query", seq: 7 }
        : defaultRespond(data);
    emitUrl(5, "https://example.org/gap");
    emitUrl(8, "https://example.org/higher");
    await flush();
    await flush();

    expect(events).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 2, url: "https://example.org/a" },
      { windowId: "win-1", webviewId: "content", seq: 5, url: "https://example.org/gap" },
      { windowId: "win-1", webviewId: "content", seq: 8, url: "https://example.org/higher" },
    ]);
    expect(
      events.some((event) => event.url === "https://example.org/stale-query"),
    ).toBe(false);

    // The discarded stale query did not poison the counter: the next
    // contiguous frame still delivers.
    emitUrl(9, "https://example.org/next");
    expect(events.at(-1)).toEqual({
      windowId: "win-1",
      webviewId: "content",
      seq: 9,
      url: "https://example.org/next",
    });
  });

  it("never delivers a destroyed view's in-flight resync answer into its re-created id", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";

    // Park every `get-webview-url` query before the tray handle exists (the
    // mount machinery captures the connection): the resync query for the OLD
    // generation resolves only after the view was destroyed and re-created
    // under the same id.
    const parkedResolvers: Array<() => void> = [];
    const originalRequest = transport.request.bind(transport);
    transport.request = (async (frame) => {
      if (
        frame.type === "ext-command" &&
        isRecord(frame.data) &&
        frame.data.type === "get-webview-url"
      ) {
        return new Promise((resolve) => {
          parkedResolvers.push(() => {
            resolve({
              type: "ext-command-result",
              requestId: frame.requestId,
              events: [
                {
                  scope: { appId: APP_ID, trayId: TRAY_ID, ext: MOUNT_ID },
                  data: {
                    type: "get-webview-url-result",
                    url: "https://old-generation.example",
                    seq: 70,
                  },
                },
              ],
            });
          });
        });
      }
      return originalRequest(frame);
    }) as typeof transport.request;

    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const first = await win.createWebview({ id: "content", url: "https://example.org" });

    const firstEvents: { url: string; seq: number }[] = [];
    first.onUrlChange((event) => firstEvents.push(event));
    await flush();

    const emitUrl = (seq: number, url: string): void => {
      transport.emit({
        type: "webview-event",
        owner: OWNER,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq,
        payload: { url },
      });
    };

    emitUrl(2, "https://example.org/a");
    emitUrl(5, "https://example.org/gap"); // resync query parks in flight
    await flush(); // let the query reach the parked transport boundary
    expect(parkedResolvers).toHaveLength(1);
    expect(firstEvents).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 2, url: "https://example.org/a" },
      { windowId: "win-1", webviewId: "content", seq: 5, url: "https://example.org/gap" },
    ]);

    await first.destroy();
    const second = await win.createWebview({ id: "content", url: "https://example.org" });
    const secondEvents: { url: string; seq: number }[] = [];
    second.onUrlChange((event) => secondEvents.push(event));
    await flush();

    // Release the old generation's answer: it must NOT hit the new view.
    for (const release of parkedResolvers.splice(0)) {
      release();
    }
    await flush();
    await flush();
    expect(secondEvents).toEqual([]);

    // The re-created view delivers its own fresh sequence normally.
    emitUrl(1, "https://example.org/fresh");
    expect(secondEvents).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 1, url: "https://example.org/fresh" },
    ]);
  });

  it("a re-created webview id starts its sequence observation fresh", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const first = await win.createWebview({ id: "content", url: "https://example.org" });

    const events: { url: string; seq: number }[] = [];
    first.onUrlChange((event) => events.push(event));
    await flush();

    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 30,
      payload: { url: "https://example.org/high" },
    });
    expect(events).toHaveLength(1);

    await first.destroy();
    const second = await win.createWebview({ id: "content", url: "https://example.org" });
    const secondEvents: { url: string; seq: number }[] = [];
    second.onUrlChange((event) => secondEvents.push(event));
    await flush();
    transport.frames.length = 0;

    // The native ViewEvents of a re-created view restarts at seq 1; the
    // facade must deliver it (no inherited high-water gap detection).
    transport.emit({
      type: "webview-event",
      owner: OWNER,
      windowId: "win-1",
      webviewId: "content",
      kind: "urlChange",
      seq: 1,
      payload: { url: "https://example.org/fresh" },
    });
    expect(secondEvents).toEqual([
      { windowId: "win-1", webviewId: "content", seq: 1, url: "https://example.org/fresh" },
    ]);
    expect(
      transport.extCommands().filter((data) => data.type === "get-webview-url"),
    ).toEqual([]);
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

  it("routes death-explained subscribe failures into the connection-dead state without synthesizing events (D3)", async () => {
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
      // D3: a transport-terminal rejection on a best-effort subscribe merges
      // into the observable connection-dead state instead of console noise.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(win.connectionDead).toBe(true);

      // Once dead, later best-effort frames are not sent at all.
      transport.closed = false;
      const events2: unknown[] = [];
      child.onFocused((event) => events2.push(event));
      await flush();
      expect(events2).toEqual([]);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the once-per-attempt console channel for non-death subscribe failures on a live transport", async () => {
    const transport = new OrchestrationTransport();
    transport.sessionId = "session-1";
    const webviewTray = createOrchestrationTray(transport);
    const win = webviewTray.createWebviewWindow({ windowId: "win-1" });
    await win.show();
    const child = await win.createWebview({ id: "content", url: "https://example.org" });

    transport.respondData = () => ({
      type: "webview-error",
      error: { code: "unknown_view", message: "subscribe target missing" },
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const events: unknown[] = [];
      child.onUrlChange((event) => events.push(event));
      await flush();
      expect(events).toEqual([]);
      expect(win.connectionDead).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
        "WebView orchestration frame failed",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
