import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type {
  WebviewBrowserOptions,
  WebviewLayoutDocument,
  WebviewLayoutNode,
  WebviewOrchestrationCommandFrame,
  WebviewOrchestrationResultFrame,
  WebviewEventFrame,
} from "./webview";
import {
  DEFAULT_WEBVIEW_BRIDGE_POLICY,
  WEBVIEW_EVENT_KINDS,
  WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE,
  WEBVIEW_ORCHESTRATION_ERROR_CODES,
  isWebviewBridgePolicy,
  isWebviewEventFrame,
  isWebviewEventKind,
  isWebviewNavigationRule,
  isWebviewOrchestrationErrorCode,
  matchesWebviewNavigationPattern,
  resolveWebviewBridgePolicy,
  validateWebviewLayout,
} from "./webview";

const owner = { appId: "app-1", trayId: "tray-1", sessionId: "session-1" } as const;

interface FrameFixture {
  name: string;
  frame: unknown;
}

const loadFrameFixtures = (file: string): FrameFixture[] =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../fixtures/frames/${file}`, import.meta.url)),
      "utf8",
    ),
  ) as FrameFixture[];

const commandBuilders: Record<string, () => WebviewOrchestrationCommandFrame> = {
  "create-webview with toolbar bridge policy": () => ({
    owner,
    type: "create-webview",
    windowId: "win-1",
    webviewId: "toolbar",
    url: "http://127.0.0.1:5173/toolbar.html",
    bridge: {
      webviewId: true,
      messageChannels: true,
      navigatorWindow: false,
      navigatorScreen: false,
      nativeApi: false,
    },
  }),
  "create-webview without bridge policy": () => ({
    owner,
    type: "create-webview",
    windowId: "win-1",
    webviewId: "content",
    url: "https://news.ycombinator.com",
  }),
  "create-webview with html content": () => ({
    owner,
    type: "create-webview",
    windowId: "win-1",
    webviewId: "banner",
    html: "<p>offline</p>",
  }),
  "destroy-webview": () => ({
    owner,
    type: "destroy-webview",
    windowId: "win-1",
    webviewId: "banner",
  }),
  "list-webviews": () => ({ owner, type: "list-webviews", windowId: "win-1" }),
  "navigate-webview": () => ({
    owner,
    type: "navigate-webview",
    windowId: "win-1",
    webviewId: "content",
    url: "https://example.org",
  }),
  "back-webview": () => ({
    owner,
    type: "back-webview",
    windowId: "win-1",
    webviewId: "content",
  }),
  "forward-webview": () => ({
    owner,
    type: "forward-webview",
    windowId: "win-1",
    webviewId: "content",
  }),
  "focus-webview": () => ({
    owner,
    type: "focus-webview",
    windowId: "win-1",
    webviewId: "toolbar",
  }),
  "get-webview-url": () => ({
    owner,
    type: "get-webview-url",
    windowId: "win-1",
    webviewId: "content",
  }),
  "get-webview-title": () => ({
    owner,
    type: "get-webview-title",
    windowId: "win-1",
    webviewId: "content",
  }),
  "set-webview-layout toolbar column": () => ({
    owner,
    type: "set-webview-layout",
    windowId: "win-1",
    layout: {
      layers: [
        {
          root: {
            dir: "column",
            gap: 1,
            children: [
              { id: "toolbar", height: 44 },
              { id: "content", flex: 1 },
            ],
          },
        },
      ],
    },
  }),
  "set-webview-layout layered box ring": () => ({
    owner,
    type: "set-webview-layout",
    windowId: "win-1",
    layout: {
      layers: [
        { root: { id: "content", flex: 1 } },
        {
          root: {
            kind: "box",
            id: "ring",
            width: 800,
            height: 600,
            border: { width: 2, color: "#333333AA" },
            cornerRadius: 8,
            background: "#00000000",
          },
        },
      ],
    },
  }),
  "set-webview-layout explicit webview kind and hidden layer": () => ({
    owner,
    type: "set-webview-layout",
    windowId: "win-1",
    layout: {
      layers: [
        { root: { kind: "webview", id: "content", flex: 1 } },
        { root: { id: "banner", height: 24 }, visible: false },
      ],
    },
  }),
  "update-webview-layout sizing patch": () => ({
    owner,
    type: "update-webview-layout",
    windowId: "win-1",
    viewId: "toolbar",
    patch: { height: 48, minHeight: 32, maxHeight: 64 },
  }),
  "get-webview-favicon": () => ({
    owner,
    type: "get-webview-favicon",
    windowId: "win-1",
    webviewId: "content",
  }),
  "set-webview-navigation-rules": () => ({
    owner,
    type: "set-webview-navigation-rules",
    windowId: "win-1",
    webviewId: "content",
    rules: [{ pattern: "*://*.tracker.example/*", action: "block" }],
  }),
  "create-webview with favicon and navigation rules": () => ({
    owner,
    type: "create-webview",
    windowId: "win-1",
    webviewId: "content",
    url: "https://example.org",
    favicon: true,
    navigationRules: [{ pattern: "*://*.tracker.example/*", action: "block" }],
  }),
  "subscribe-webview-events": () => ({
    owner,
    type: "subscribe-webview-events",
    windowId: "win-1",
    webviewId: "content",
    kinds: ["urlChange", "titleChange", "focused", "geometryChange"],
  }),
  "unsubscribe-webview-events": () => ({
    owner,
    type: "unsubscribe-webview-events",
    windowId: "win-1",
    webviewId: "content",
    kinds: ["urlChange", "titleChange"],
  }),
};

const resultBuilders: Record<string, () => WebviewOrchestrationResultFrame> = {
  "list-webviews-result": () => ({
    owner,
    type: "list-webviews-result",
    windowId: "win-1",
    webviews: [
      {
        webviewId: "toolbar",
        bridge: {
          webviewId: true,
          messageChannels: true,
          navigatorWindow: false,
          navigatorScreen: false,
          nativeApi: false,
        },
      },
      { webviewId: "content", bridge: { ...DEFAULT_WEBVIEW_BRIDGE_POLICY } },
    ],
  }),
  "get-webview-url-result returns value and seq": () => ({
    owner,
    type: "get-webview-url-result",
    windowId: "win-1",
    webviewId: "content",
    url: "https://example.org/articles/1",
    seq: 41,
  }),
  "get-webview-title-result returns value and seq": () => ({
    owner,
    type: "get-webview-title-result",
    windowId: "win-1",
    webviewId: "content",
    title: "Example Article",
    seq: 12,
  }),
  "get-webview-favicon-result returns value and seq": () => ({
    owner,
    type: "get-webview-favicon-result",
    windowId: "win-1",
    webviewId: "content",
    href: "https://example.org/favicon.ico",
    seq: 71,
  }),
  "get-webview-favicon-result unset href": () => ({
    owner,
    type: "get-webview-favicon-result",
    windowId: "win-1",
    webviewId: "content",
    seq: 0,
  }),
  "webview-ack echoes the command": () => ({
    owner,
    type: "webview-ack",
    command: "navigate-webview",
  }),
};

const eventBuilders: Record<string, () => WebviewEventFrame> = {
  urlChange: () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "urlChange",
    seq: 41,
    payload: { url: "https://example.org/articles/1" },
  }),
  titleChange: () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "titleChange",
    seq: 12,
    payload: { title: "Example Article" },
  }),
  "focused gained edge": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "toolbar",
    kind: "focused",
    seq: 3,
    payload: { focused: true },
  }),
  "focused lost edge": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "focused",
    seq: 7,
    payload: { focused: false },
  }),
  "geometryChange with view-local rect": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "bar",
    kind: "geometryChange",
    seq: 2,
    payload: { rect: { x: 0, y: 0, width: 800, height: 44 } },
  }),
  "geometryChange with fractional logical pixels": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "bar",
    kind: "geometryChange",
    seq: 3,
    payload: { rect: { x: 12.5, y: 0.5, width: 300.25, height: 44 } },
  }),
  "geometryChange null rect means no overlay intersection": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "geometryChange",
    seq: 9,
    payload: { rect: null },
  }),
  "loadState started with progress": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "loadState",
    seq: 5,
    payload: { phase: "started", url: "https://example.org/articles/1", progress: 0.1 },
  }),
  "loadState started without progress": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "loadState",
    seq: 6,
    payload: { phase: "started", url: "https://example.org" },
  }),
  "loadState finished carries full progress": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "loadState",
    seq: 7,
    payload: { phase: "finished", url: "https://example.org/articles/1", progress: 1 },
  }),
  "loadState failed with errorCode": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "loadState",
    seq: 8,
    payload: { phase: "failed", url: "https://unreachable.example.org", errorCode: -1003 },
  }),
  "navigationAction link user initiated": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "navigationAction",
    seq: 61,
    payload: { url: "https://example.org/articles/2", navigationType: "link", isUserInitiated: true },
  }),
  "navigationAction redirect without user flag": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "navigationAction",
    seq: 62,
    payload: { url: "https://example.org/login", navigationType: "redirect" },
  }),
  "faviconChange settled href": () => ({
    type: "webview-event",
    owner,
    windowId: "win-1",
    webviewId: "content",
    kind: "faviconChange",
    seq: 71,
    payload: { href: "https://example.org/favicon.ico" },
  }),
};

/**
 * Shared wire-shape suite: `crates/opentray-spec/src/webview.rs` builds the
 * same frames from the same fixture names, so the TypeScript and Rust DTOs
 * are pinned to identical field-level wire shapes.
 */
describe("webview orchestration wire fixtures", () => {
  const commands = loadFrameFixtures("orchestration-commands.json");
  const events = loadFrameFixtures("webview-event-frames.json");

  it("loads both fixture files", () => {
    expect(commands.length).toBeGreaterThanOrEqual(20);
    expect(events.length).toBeGreaterThanOrEqual(7);
  });

  for (const { name, frame } of commands) {
    it(`serializes to the shared wire shape: ${name}`, () => {
      const builder = commandBuilders[name] ?? resultBuilders[name];
      if (builder === undefined) {
        throw new Error(`missing builder for fixture ${name}`);
      }
      expect(JSON.parse(JSON.stringify(builder()))).toEqual(frame);
    });
  }

  for (const { name, frame } of events) {
    it(`serializes to the shared wire shape: ${name}`, () => {
      const builder = eventBuilders[name];
      if (builder === undefined) {
        throw new Error(`missing builder for fixture ${name}`);
      }
      expect(JSON.parse(JSON.stringify(builder()))).toEqual(frame);
    });
  }
});

describe("webview event frame guard", () => {
  it("accepts every shared event fixture and rejects corrupted frames", () => {
    for (const { frame } of loadFrameFixtures("webview-event-frames.json")) {
      expect(isWebviewEventFrame(frame)).toBe(true);
      // JSON round-trip keeps the guard green (frames arrive as parsed JSON).
      expect(isWebviewEventFrame(JSON.parse(JSON.stringify(frame)))).toBe(true);
    }

    expect(isWebviewEventFrame({ type: "webview-event", owner, payload: { url: "x" } })).toBe(
      false,
    );
    expect(
      isWebviewEventFrame({
        type: "webview-event",
        owner,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: 1,
        payload: { title: "wrong payload for kind" },
      }),
    ).toBe(false);
    expect(
      isWebviewEventFrame({
        type: "webview-event",
        owner,
        windowId: "win-1",
        webviewId: "content",
        kind: "geometryChange",
        seq: 1,
        payload: { rect: { x: 0, y: 0, width: 800 } },
      }),
    ).toBe(false);
    expect(
      isWebviewEventFrame({
        type: "webview-event",
        owner,
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: -1,
        payload: { url: "https://example.org" },
      }),
    ).toBe(false);
    expect(
      isWebviewEventFrame({
        type: "webview-event",
        owner: { appId: "app-1", trayId: "tray-1" },
        windowId: "win-1",
        webviewId: "content",
        kind: "urlChange",
        seq: 1,
        payload: { url: "https://example.org" },
      }),
    ).toBe(false);
  });
});

describe("navigation rules and url-glob semantics", () => {
  it("matches the shared glob table (same cases as the Rust suite)", () => {
    const cases: Array<[string, string, boolean]> = [
      ["*://*.tracker.example/*", "https://cdn.tracker.example/pixel.gif?id=9", true],
      ["*://*.tracker.example/*", "https://tracker.example.evil.net/pixel.gif", false],
      // The leading dot in `*.tracker.example` is literal: the bare host needs
      // its own rule (or `*tracker.example`).
      ["*://*.tracker.example/*", "https://tracker.example/pixel.gif", false],
      ["https://example.org/exact/path", "https://example.org/exact/path", true],
      ["https://example.org/exact/path", "https://example.org/exact/path?utm=1", false],
      ["*", "https://any.example/deep/path?q=1", true],
      ["https://example.org/*", "https://example.org/", true],
      ["https://example.org/*", "https://example.org", false],
    ];
    for (const [pattern, url, expected] of cases) {
      expect(matchesWebviewNavigationPattern(pattern, url), `${pattern} vs ${url}`).toBe(expected);
    }
  });

  it("guards rule DTOs and freezes the blocked error code", () => {
    expect(isWebviewNavigationRule({ pattern: "*://ads.example/*", action: "block" })).toBe(true);
    expect(isWebviewNavigationRule({ pattern: "", action: "block" })).toBe(false);
    expect(isWebviewNavigationRule({ pattern: "x", action: "allow" })).toBe(false);
    expect(isWebviewNavigationRule({ action: "block" })).toBe(false);
    expect(WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE).toBe(4500001);
  });
});

describe("per-child bridge policy", () => {
  it("defaults every field to false", () => {
    expect(DEFAULT_WEBVIEW_BRIDGE_POLICY).toEqual({
      webviewId: false,
      messageChannels: false,
      navigatorWindow: false,
      navigatorScreen: false,
      nativeApi: false,
    });
    expect(resolveWebviewBridgePolicy(undefined)).toEqual(DEFAULT_WEBVIEW_BRIDGE_POLICY);
    expect(resolveWebviewBridgePolicy({})).toEqual(DEFAULT_WEBVIEW_BRIDGE_POLICY);
  });

  it("resolves partial policies into the frozen full DTO", () => {
    expect(resolveWebviewBridgePolicy({ webviewId: true, messageChannels: true })).toEqual({
      webviewId: true,
      messageChannels: true,
      navigatorWindow: false,
      navigatorScreen: false,
      nativeApi: false,
    });
  });

  it("rejects non-boolean fields and validates complete DTOs", () => {
    expect(() => resolveWebviewBridgePolicy({ webviewId: 1 as unknown as boolean })).toThrow(
      "boolean",
    );
    expect(isWebviewBridgePolicy(DEFAULT_WEBVIEW_BRIDGE_POLICY)).toBe(true);
    expect(isWebviewBridgePolicy({ webviewId: true })).toBe(false);
    expect(isWebviewBridgePolicy(null)).toBe(false);
  });

  it("carries the contract-5 contextMenu field on the browser options DTO (wire-only; native side resolves the default)", () => {
    // The default resolution (bridged child → no engine menu, bridgeless →
    // browser-tab menu) lives in the native extension; the TS DTO only
    // freezes that the field serializes as a boolean when present.
    const options: WebviewBrowserOptions = { contextMenu: false };
    expect(options.contextMenu).toBe(false);
    expect(JSON.parse(JSON.stringify({ browser: options }))).toEqual({
      browser: { contextMenu: false },
    });
  });
});

describe("layout protocol validation", () => {
  const knownViews = new Set(["toolbar", "content", "ring", "banner", "bar"]);
  const hasView = (viewId: string) => knownViews.has(viewId);
  const validate = (roots: readonly WebviewLayoutNode[]) =>
    validateWebviewLayout({ layers: roots.map((root) => ({ root })) }, { hasView });

  it("accepts the toolbar column and layered box documents", () => {
    expect(
      validate([
        {
          dir: "column",
          gap: 1,
          children: [
            { id: "toolbar", height: 44 },
            { id: "content", flex: 1 },
          ],
        },
      ]),
    ).toEqual({ ok: true });

    expect(
      validate([{ id: "content", flex: 1 }, { kind: "box", id: "ring", border: { width: 2, color: "#333333AA" } }]),
    ).toEqual({ ok: true });

    expect(validate([])).toEqual({ ok: true });
  });

  it("rejects unknown view ids with unknown_view before any solving", () => {
    const result = validate([{ dir: "column", children: [{ id: "sidebar", flex: 1 }] }]);
    expect(result).toEqual({
      ok: false,
      error: { error: { code: "unknown_view", message: expect.stringContaining("sidebar") } },
    });
  });

  it("rejects NaN, infinity, negative, and inverted measures with invalid_layout_measure", () => {
    const expectInvalid = (root: WebviewLayoutNode) => {
      const result = validate([root]);
      expect(result).toEqual({
        ok: false,
        error: {
          error: { code: "invalid_layout_measure", message: expect.any(String) },
        },
      });
    };

    expectInvalid({ id: "content", width: Number.NaN });
    expectInvalid({ id: "content", width: Number.POSITIVE_INFINITY });
    expectInvalid({ id: "content", width: -1 });
    expectInvalid({ id: "content", minWidth: 300, maxWidth: 200 });
    expectInvalid({ id: "content", minHeight: 90, maxHeight: 44 });
    expectInvalid({ id: "content", flex: -2 });
    expectInvalid({ dir: "column", gap: -5, children: [{ id: "content" }] });
    expectInvalid({
      kind: "box",
      id: "ring",
      border: { width: Number.NaN, color: "#000000" },
    });
    expectInvalid({ kind: "box", id: "ring", cornerRadius: -1 });
  });

  it("accepts min == max boundaries", () => {
    expect(validate([{ id: "toolbar", minWidth: 44, maxWidth: 44 }])).toEqual({ ok: true });
  });
});

describe("registries", () => {
  it("freezes the typed error-code registry", () => {
    expect(WEBVIEW_ORCHESTRATION_ERROR_CODES).toEqual([
      "unknown_view",
      "invalid_layout_measure",
      "multiwebview_unsupported_style",
      "tray_session_active",
      "bridge_required",
      "session_scope",
      "not_open",
      "payload_too_large",
      "queue_overflow",
      "invalid_payload",
    ]);
    expect(isWebviewOrchestrationErrorCode("queue_overflow")).toBe(true);
    expect(isWebviewOrchestrationErrorCode("made_up_code")).toBe(false);
  });

  it("freezes the unified event family", () => {
    expect(WEBVIEW_EVENT_KINDS).toEqual([
      "urlChange",
      "titleChange",
      "focused",
      "geometryChange",
      "loadState",
      "navigationAction",
      "faviconChange",
    ]);
    expect(isWebviewEventKind("geometryChange")).toBe(true);
    expect(isWebviewEventKind("loadState")).toBe(true);
    expect(isWebviewEventKind("navigationAction")).toBe(true);
    expect(isWebviewEventKind("faviconChange")).toBe(true);
    expect(isWebviewEventKind("zIndexChange")).toBe(false);
  });

  it("guards navigationAction and faviconChange payload fields", () => {
    const nav = {
      type: "webview-event",
      owner,
      windowId: "win-1",
      webviewId: "content",
      kind: "navigationAction",
      seq: 1,
    };
    expect(
      isWebviewEventFrame({
        ...nav,
        payload: { url: "https://example.org", navigationType: "link", isUserInitiated: true },
      }),
    ).toBe(true);
    expect(
      isWebviewEventFrame({ ...nav, payload: { url: "https://example.org", navigationType: "redirect" } }),
    ).toBe(true);
    // Unknown navigation type, missing url, and non-boolean user flag reject.
    expect(
      isWebviewEventFrame({ ...nav, payload: { url: "https://x", navigationType: "popup" } }),
    ).toBe(false);
    expect(isWebviewEventFrame({ ...nav, payload: { navigationType: "link" } })).toBe(false);
    expect(
      isWebviewEventFrame({
        ...nav,
        payload: { url: "https://x", navigationType: "link", isUserInitiated: "yes" },
      }),
    ).toBe(false);

    const fav = {
      type: "webview-event",
      owner,
      windowId: "win-1",
      webviewId: "content",
      kind: "faviconChange",
      seq: 1,
    };
    expect(isWebviewEventFrame({ ...fav, payload: { href: "https://example.org/favicon.ico" } })).toBe(
      true,
    );
    expect(isWebviewEventFrame({ ...fav, payload: { href: "" } })).toBe(false);
    expect(isWebviewEventFrame({ ...fav, payload: { url: "https://example.org/favicon.ico" } })).toBe(
      false,
    );
  });

  it("guards loadState payload fields (phase, errorCode, progress range)", () => {
    const base = {
      type: "webview-event",
      owner,
      windowId: "win-1",
      webviewId: "content",
      kind: "loadState",
      seq: 1,
    };
    expect(isWebviewEventFrame({ ...base, payload: { phase: "started", url: "https://x" } })).toBe(
      true,
    );
    expect(
      isWebviewEventFrame({
        ...base,
        payload: { phase: "failed", url: "https://x", errorCode: -1003 },
      }),
    ).toBe(true);
    expect(
      isWebviewEventFrame({ ...base, payload: { phase: "finished", url: "https://x", progress: 1 } }),
    ).toBe(true);
    // Unknown phase, fractional/non-integer codes, and out-of-range progress reject.
    expect(isWebviewEventFrame({ ...base, payload: { phase: "loading", url: "https://x" } })).toBe(
      false,
    );
    expect(
      isWebviewEventFrame({ ...base, payload: { phase: "failed", url: "https://x", errorCode: 1.5 } }),
    ).toBe(false);
    expect(
      isWebviewEventFrame({ ...base, payload: { phase: "started", url: "https://x", progress: 1.2 } }),
    ).toBe(false);
    expect(
      isWebviewEventFrame({ ...base, payload: { phase: "started", url: "https://x", progress: -0.1 } }),
    ).toBe(false);
  });
});
