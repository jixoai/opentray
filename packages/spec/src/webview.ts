import type { AppId, SessionId, TrayId } from "./index";

/**
 * Multi-webview orchestration protocol for `ext-webview`.
 *
 * These DTOs are the platform-neutral wire contracts for one window session
 * hosting sibling webview native views (`openspec/changes/add-webview-orchestration`,
 * decisions D2/D8/D18/D19 and the webview-extension / webview-layout spec deltas).
 * They ride the existing extension command/event envelopes; every frame
 * carries the owner tuple `(appId, trayId, sessionId)` so session-scoped ids
 * never collide across sessions. The Rust mirror lives in
 * `crates/opentray-spec/src/webview.rs`; both sides are pinned to the same
 * wire shapes by the shared fixtures in `fixtures/frames/`.
 */

/** Identity of the app/tray/session trio that owns one window session. */
export interface WebviewOwnerTuple {
  appId: AppId;
  trayId: TrayId;
  sessionId: SessionId;
}

/** Opaque window-session id, unique within its session. */
export type WindowId = string;

/** Opaque webview id, unique within its window session. */
export type WebviewId = string;

/** Registry id of any addressable view (webview or box). */
export type ViewId = string;

/**
 * Per-child bridge policy, frozen as a boolean field set (D2). Every field
 * defaults to `false`; omitting the policy entirely means no bridge. The
 * policy is bootstrap-immutable for the webview's lifetime.
 */
export interface WebviewBridgePolicy {
  webviewId: boolean;
  messageChannels: boolean;
  navigatorWindow: boolean;
  navigatorScreen: boolean;
  nativeApi: boolean;
}

/**
 * Per-webview browser-behavior options (create-webview). Defaults are
 * browser-normal: browserlike UA on, persistent storage profile,
 * gesture-gated autoplay.
 */
export interface WebviewBrowserOptions {
  /** Full User-Agent override; wins over `browserlikeUserAgent`. */
  userAgent?: string;
  /** Default `true`. `false` restores the bare engine UA. */
  browserlikeUserAgent?: boolean;
  /** Default `false`. Ephemeral (non-persistent) storage profile (macOS). */
  incognito?: boolean;
  /** Default `false`. Allow media autoplay without a user gesture. */
  autoplay?: boolean;
  /**
   * Engine-native context menu (right-click Reload/Inspect etc.). Default
   * depends on the bridge policy: DISABLED for a child with any bridge
   * capability (trusted shell UI — the engine menu must not leak engine
   * commands onto it), ENABLED for a bridgeless child (ordinary content
   * behaves like a browser tab). Explicit values win either way.
   */
  contextMenu?: boolean;
}

export type WebviewBridgePolicyInput = Partial<WebviewBridgePolicy> | undefined;

const bridgePolicyFields = [
  "webviewId",
  "messageChannels",
  "navigatorWindow",
  "navigatorScreen",
  "nativeApi",
] as const satisfies ReadonlyArray<keyof WebviewBridgePolicy>;

/** All-false policy: the arbitrary-content webview is bridgeless by default. */
export const DEFAULT_WEBVIEW_BRIDGE_POLICY: WebviewBridgePolicy = {
  webviewId: false,
  messageChannels: false,
  navigatorWindow: false,
  navigatorScreen: false,
  nativeApi: false,
};

/** Resolves a partial (or omitted) policy into the frozen full DTO. */
export const resolveWebviewBridgePolicy = (
  policy: WebviewBridgePolicyInput,
): WebviewBridgePolicy => {
  const resolved: WebviewBridgePolicy = { ...DEFAULT_WEBVIEW_BRIDGE_POLICY };
  if (policy === undefined) {
    return resolved;
  }
  for (const field of bridgePolicyFields) {
    const value = policy[field];
    if (value !== undefined) {
      if (typeof value !== "boolean") {
        throw new Error(`webview bridge policy field ${field} must be a boolean`);
      }
      resolved[field] = value;
    }
  }
  return resolved;
};

/** Returns true when a value is a complete, frozen-shape bridge policy DTO. */
export const isWebviewBridgePolicy = (value: unknown): value is WebviewBridgePolicy => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return bridgePolicyFields.every((field) => typeof record[field] === "boolean");
};

/**
 * Typed error-code registry for the whole orchestration surface (D20).
 * `queue_overflow` is shared across two namespaces: it is both a channel
 * close reason and a `channel.post` error code; every other reason and
 * error code stays in its own namespace.
 */
export const WEBVIEW_ORCHESTRATION_ERROR_CODES = [
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
  "favicon_disabled",
] as const;

export type WebviewOrchestrationErrorCode =
  (typeof WEBVIEW_ORCHESTRATION_ERROR_CODES)[number];

export const isWebviewOrchestrationErrorCode = (
  value: unknown,
): value is WebviewOrchestrationErrorCode =>
  typeof value === "string" &&
  (WEBVIEW_ORCHESTRATION_ERROR_CODES as readonly unknown[]).includes(value);

/** Typed error envelope `{ error: { code, message } }` used by wire frames. */
export interface WebviewErrorEnvelope {
  error: {
    code: WebviewOrchestrationErrorCode;
    message: string;
  };
}

/** Webview content source: one of a URL or literal HTML. */
export interface WebviewContent {
  url?: string;
  html?: string;
}

/**
 * Host→broker orchestration commands (ext-command data payloads).
 * Tag names follow the core protocol's kebab-case convention and never
 * collide with the single-webview command surface (`navigate`, `focus`, ...).
 */
export type WebviewOrchestrationCommandFrame = { owner: WebviewOwnerTuple } &
  (
    | {
        type: "create-webview";
        windowId: WindowId;
        webviewId: WebviewId;
      } & WebviewContent & {
        bridge?: WebviewBridgePolicy;
        browser?: WebviewBrowserOptions;
        /** Opt in to native favicon observation (events + query). */
        favicon?: boolean;
        /** Declarative navigation rules, evaluated natively at decision time. */
        navigationRules?: readonly WebviewNavigationRule[];
      }
    | { type: "destroy-webview"; windowId: WindowId; webviewId: WebviewId }
    | { type: "list-webviews"; windowId: WindowId }
    | { type: "navigate-webview"; windowId: WindowId; webviewId: WebviewId; url: string }
    | { type: "back-webview"; windowId: WindowId; webviewId: WebviewId }
    | { type: "forward-webview"; windowId: WindowId; webviewId: WebviewId }
    | { type: "focus-webview"; windowId: WindowId; webviewId: WebviewId }
    | { type: "set-webview-layout"; windowId: WindowId; layout: WebviewLayoutDocument }
    | {
        type: "update-webview-layout";
        windowId: WindowId;
        viewId: ViewId;
        patch: WebviewLayoutNodePatch;
      }
    | { type: "get-webview-url"; windowId: WindowId; webviewId: WebviewId }
    | { type: "get-webview-title"; windowId: WindowId; webviewId: WebviewId }
    | {
        type: "subscribe-webview-events";
        windowId: WindowId;
        webviewId: WebviewId;
        kinds: readonly WebviewEventKind[];
      }
    | {
        type: "unsubscribe-webview-events";
        windowId: WindowId;
        webviewId: WebviewId;
        kinds: readonly WebviewEventKind[];
      }
    | { type: "get-webview-favicon"; windowId: WindowId; webviewId: WebviewId }
    | {
        type: "set-webview-navigation-rules";
        windowId: WindowId;
        webviewId: WebviewId;
        rules: readonly WebviewNavigationRule[];
      }
  );

/** String tag union of every orchestration command frame. */
export type WebviewOrchestrationCommandType =
  WebviewOrchestrationCommandFrame["type"];

/** One entry of a `list-webviews` result: id plus its frozen bridge policy. */
export interface WebviewListEntry {
  webviewId: WebviewId;
  bridge: WebviewBridgePolicy;
}

/** Query result pair `(value, seq)` for `get-webview-url` (D19 race rule). */
export interface WebviewUrlQueryResult {
  url: string;
  seq: number;
}

/** Query result pair `(value, seq)` for `get-webview-title`. */
export interface WebviewTitleQueryResult {
  title: string;
  seq: number;
}

/**
 * Query result pair `(value, seq)` for `get-webview-favicon`. `value` is
 * `null` until the first settled favicon observation; the query rejects
 * with `favicon_disabled` for webviews created without the `favicon`
 * capability.
 */
export interface WebviewFaviconQueryResult {
  value: { href: string } | null;
  seq: number;
}

/** Broker→host result frames for the orchestration commands. */
export type WebviewOrchestrationResultFrame = { owner: WebviewOwnerTuple } &
  (
    | { type: "webview-ack"; command: WebviewOrchestrationCommandType }
    | { type: "list-webviews-result"; windowId: WindowId; webviews: WebviewListEntry[] }
    | {
        type: "get-webview-url-result";
        windowId: WindowId;
        webviewId: WebviewId;
      } & WebviewUrlQueryResult
    | {
        type: "get-webview-title-result";
        windowId: WindowId;
        webviewId: WebviewId;
      } & WebviewTitleQueryResult
    | {
        type: "get-webview-favicon-result";
        windowId: WindowId;
        webviewId: WebviewId;
      } & WebviewFaviconQueryResult
  );

/**
 * Unified per-view event family (D19; `loadState` joined with D24;
 * `navigationAction`/`faviconChange` added by
 * add-navigation-favicon-surface): urlChange, titleChange, focused,
 * geometryChange, loadState, navigationAction, faviconChange.
 */
export const WEBVIEW_EVENT_KINDS = [
  "urlChange",
  "titleChange",
  "focused",
  "geometryChange",
  "loadState",
  "navigationAction",
  "faviconChange",
] as const;

export type WebviewEventKind = (typeof WEBVIEW_EVENT_KINDS)[number];

export const isWebviewEventKind = (value: unknown): value is WebviewEventKind =>
  typeof value === "string" && (WEBVIEW_EVENT_KINDS as readonly unknown[]).includes(value);

/** Navigation lifecycle phase of a `loadState` payload (D24). */
export type WebviewLoadPhase = "started" | "finished" | "failed";

const isWebviewLoadPhase = (value: unknown): value is WebviewLoadPhase =>
  value === "started" || value === "finished" || value === "failed";

/**
 * Navigation action attribution (add-navigation-favicon-surface). The
 * platform projection is documented truth, not invention: Windows maps
 * `IsRedirected` to "redirect" exactly and cannot separate link from form
 * (user-initiated projects as "link"); macOS maps
 * `WKNavigationAction.navigationType` and does not distinguish redirect
 * from "other".
 */
export const WEBVIEW_NAVIGATION_TYPES = [
  "link",
  "form",
  "backForward",
  "reload",
  "redirect",
  "other",
] as const;

export type WebviewNavigationType = (typeof WEBVIEW_NAVIGATION_TYPES)[number];

export const isWebviewNavigationType = (value: unknown): value is WebviewNavigationType =>
  typeof value === "string" &&
  (WEBVIEW_NAVIGATION_TYPES as readonly unknown[]).includes(value);

/** Field-frozen `navigationAction` payload: every navigation decision point. */
export interface WebviewNavigationActionPayload {
  url: string;
  navigationType: WebviewNavigationType;
  /** Omitted when the platform cannot attribute a gesture (macOS). */
  isUserInitiated?: boolean;
}

/** Field-frozen `faviconChange` payload: the settled, resolved href. */
export interface WebviewFaviconPayload {
  href: string;
}

/**
 * Stable numeric `loadState failed` code for a navigation cancelled by a
 * declarative navigation rule. Outside platform ranges by construction
 * (WebView2 `WebErrorStatus` and WebKit domain codes are small integers).
 */
export const WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE = 4500001;

/** One declarative navigation rule; v1 actions: block only. */
export interface WebviewNavigationRule {
  /** Glob over the full URL; `*` matches any character run. */
  pattern: string;
  action: "block";
}

export const isWebviewNavigationRule = (value: unknown): value is WebviewNavigationRule =>
  isRecord(value) &&
  typeof value.pattern === "string" &&
  value.pattern.length > 0 &&
  value.action === "block";

/**
 * Shared URL-glob semantics (identical implementation contract on the
 * TypeScript facade and in the native rule evaluator): the pattern is
 * matched against the full absolute URL; every character is literal
 * except `*`, which matches any run of characters including separators.
 */
export const matchesWebviewNavigationPattern = (pattern: string, url: string): boolean => {
  // Standard regex metacharacter escape, applied per character: everything
  // except `*` is literal, so `.` `[` `]` `+` `?` `(` `)` `{` `}` `^` `$`
  // `|` `\\` must reach the RegExp source escaped. (R1 regression: the
  // first cut built a broken character class that matched almost nothing,
  // leaving `.` unescaped — `example.org` then matched `exampleXorg`.)
  const metacharacters = /[.*+?^${}()|[\]\\]/g;
  let source = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      source += "[\\s\\S]*";
    } else {
      source += ch.replace(metacharacters, "\\$&");
    }
  }
  return new RegExp(source + "$").test(url);
};

/** View-local logical-pixel rectangle; same fields as the page-bridge overlay payload. */
export interface WebviewGeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Field-frozen `loadState` payload (D24): navigation lifecycle phase plus the
 * target URL; `errorCode` rides failures, `progress` ∈ [0,1] rides phases the
 * platform can measure and is omitted otherwise (consumers render an
 * indeterminate affordance).
 */
export interface WebviewLoadStatePayload {
  phase: WebviewLoadPhase;
  url: string;
  errorCode?: number;
  progress?: number;
}

/**
 * Field-level frozen event payloads. Every event frame carries
 * `{ owner, windowId, webviewId, kind, seq, payload }`; `seq` is a per-view
 * monotonically increasing sequence number and events are pure push with no
 * replay — current values come from the `(value, seq)` query commands.
 */
export type WebviewEventFrame = { type: "webview-event" } & {
  owner: WebviewOwnerTuple;
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
} & (
    | { kind: "urlChange"; payload: { url: string } }
    | { kind: "titleChange"; payload: { title: string } }
    | { kind: "focused"; payload: { focused: boolean } }
    | { kind: "geometryChange"; payload: { rect: WebviewGeometryRect | null } }
    | { kind: "loadState"; payload: WebviewLoadStatePayload }
    | { kind: "navigationAction"; payload: WebviewNavigationActionPayload }
    | { kind: "faviconChange"; payload: WebviewFaviconPayload }
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOwnerTuple = (value: unknown): value is WebviewOwnerTuple =>
  isRecord(value) &&
  typeof value.appId === "string" &&
  typeof value.trayId === "string" &&
  typeof value.sessionId === "string";

const isGeometryRect = (value: unknown): value is WebviewGeometryRect =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.width === "number" &&
  typeof value.height === "number";

/**
 * Field-level guard for incoming event frames, including kind↔payload
 * coherence (`urlChange` must carry `{ url: string }`, and so on).
 */
export const isWebviewEventFrame = (value: unknown): value is WebviewEventFrame => {
  if (!isRecord(value) || value.type !== "webview-event") {
    return false;
  }
  if (
    !isOwnerTuple(value.owner) ||
    typeof value.windowId !== "string" ||
    typeof value.webviewId !== "string" ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    !isWebviewEventKind(value.kind) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  switch (value.kind) {
    case "urlChange":
      return typeof value.payload.url === "string";
    case "titleChange":
      return typeof value.payload.title === "string";
    case "focused":
      return typeof value.payload.focused === "boolean";
    case "geometryChange":
      return value.payload.rect === null || isGeometryRect(value.payload.rect);
    case "loadState":
      return (
        isWebviewLoadPhase(value.payload.phase) &&
        typeof value.payload.url === "string" &&
        (value.payload.errorCode === undefined ||
          (typeof value.payload.errorCode === "number" &&
            Number.isSafeInteger(value.payload.errorCode))) &&
        (value.payload.progress === undefined ||
          (typeof value.payload.progress === "number" &&
            Number.isFinite(value.payload.progress) &&
            value.payload.progress >= 0 &&
            value.payload.progress <= 1))
      );
    case "navigationAction":
      return (
        typeof value.payload.url === "string" &&
        isWebviewNavigationType(value.payload.navigationType) &&
        (value.payload.isUserInitiated === undefined ||
          typeof value.payload.isUserInitiated === "boolean")
      );
    case "faviconChange":
      return typeof value.payload.href === "string" && value.payload.href.length > 0;
  }
};

/**
 * Declarative layered flex layout protocol (D3/D4/D8). One JSON document:
 * an ordered array of layers (bottom-to-top; array order is the z-order),
 * each layer owning one independent flex tree. There is no zIndex field
 * anywhere; v1 has no padding/align/justify/percent/basis.
 */
export interface WebviewLayoutDocument {
  layers: readonly WebviewLayoutLayer[];
}

export interface WebviewLayoutLayer {
  root: WebviewLayoutNode;
  /** Layer visibility switch (implementation-reserved detail; default true). */
  visible?: boolean;
}

/** Node sizing fields, logical pixels, client-area coordinates. */
export interface WebviewLayoutSizing {
  width?: number;
  height?: number;
  flex?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/** Incremental sizing patch for `layout.update(viewId, patch)`. */
export type WebviewLayoutNodePatch = WebviewLayoutSizing;

export interface WebviewLayoutContainerNode extends WebviewLayoutSizing {
  dir: "row" | "column";
  gap?: number;
  children: readonly WebviewLayoutNode[];
  /** Type-level discriminator only: containers carry no view kind on the wire. */
  kind?: undefined;
}

/** View reference; `kind` defaults to `"webview"` when omitted. */
export interface WebviewLayoutViewNode extends WebviewLayoutSizing {
  kind?: "webview";
  id: ViewId;
}

/** Box view: the decorative paint primitive (D5) — no web content, input pass-through. */
export interface WebviewLayoutBoxNode extends WebviewLayoutSizing, WebviewBoxStyle {
  kind: "box";
  id: ViewId;
}

export interface WebviewBoxStyle {
  /** Solid color, `#RRGGBB` or `#RRGGBBAA`. */
  background?: string;
  border?: {
    width: number;
    color: string;
  };
  cornerRadius?: number;
}

export type WebviewLayoutNode =
  | WebviewLayoutContainerNode
  | WebviewLayoutViewNode
  | WebviewLayoutBoxNode;

export type WebviewLayoutValidationResult =
  | { ok: true }
  | { ok: false; error: WebviewErrorEnvelope };

const invalidMeasure = (message: string): WebviewLayoutValidationResult => ({
  ok: false,
  error: { error: { code: "invalid_layout_measure", message } },
});

const unknownView = (viewId: ViewId): WebviewLayoutValidationResult => ({
  ok: false,
  error: {
    error: { code: "unknown_view", message: `layout references unregistered view id ${viewId}` },
  },
});

const checkMeasure = (
  value: number | undefined,
  label: string,
): WebviewLayoutValidationResult | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return invalidMeasure(`${label} must be a finite non-negative number (got ${String(value)})`);
  }
  return undefined;
};

const checkSizing = (
  sizing: WebviewLayoutSizing,
  label: string,
): WebviewLayoutValidationResult | undefined => {
  const fields = [
    "width",
    "height",
    "flex",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
  ] as const;
  for (const field of fields) {
    const failure = checkMeasure(sizing[field], `${label}.${field}`);
    if (failure !== undefined) {
      return failure;
    }
  }
  if (
    sizing.minWidth !== undefined &&
    sizing.maxWidth !== undefined &&
    sizing.minWidth > sizing.maxWidth
  ) {
    return invalidMeasure(`${label}: minWidth must not exceed maxWidth`);
  }
  if (
    sizing.minHeight !== undefined &&
    sizing.maxHeight !== undefined &&
    sizing.minHeight > sizing.maxHeight
  ) {
    return invalidMeasure(`${label}: minHeight must not exceed maxHeight`);
  }
  return undefined;
};

/**
 * Protocol-level layout validation, performed before any solving (D21):
 * every measure must be finite, non-negative, with `min ≤ max` per axis, and
 * every referenced view id must be registered. NaN, ±Infinity, negative
 * values, and inverted min/max reject with `invalid_layout_measure`;
 * unregistered ids reject with `unknown_view`.
 */
export const validateWebviewLayout = (
  document: WebviewLayoutDocument,
  options: { hasView: (viewId: ViewId) => boolean },
): WebviewLayoutValidationResult => {
  const layers = Array.isArray(document.layers) ? document.layers : [];
  for (const [layerIndex, layer] of layers.entries()) {
    const failure = validateLayoutNode(layer.root, `layers[${layerIndex}]`, options);
    if (failure !== undefined) {
      return failure;
    }
  }
  return { ok: true };
};

const validateLayoutNode = (
  node: WebviewLayoutNode,
  label: string,
  options: { hasView: (viewId: ViewId) => boolean },
): WebviewLayoutValidationResult | undefined => {
  if (node.kind === "box") {
    if (!options.hasView(node.id)) {
      return unknownView(node.id);
    }
    const sizingFailure = checkSizing(node, label);
    if (sizingFailure !== undefined) {
      return sizingFailure;
    }
    const borderFailure = checkMeasure(node.border?.width, `${label}.border.width`);
    if (borderFailure !== undefined) {
      return borderFailure;
    }
    const radiusFailure = checkMeasure(node.cornerRadius, `${label}.cornerRadius`);
    if (radiusFailure !== undefined) {
      return radiusFailure;
    }
    return undefined;
  }
  if (isLayoutViewNode(node)) {
    if (!options.hasView(node.id)) {
      return unknownView(node.id);
    }
    return checkSizing(node, label);
  }
  const container = node as WebviewLayoutContainerNode;
  const gapFailure = checkMeasure(container.gap, `${label}.gap`);
  if (gapFailure !== undefined) {
    return gapFailure;
  }
  const sizingFailure = checkSizing(container, label);
  if (sizingFailure !== undefined) {
    return sizingFailure;
  }
  const children = Array.isArray(container.children) ? container.children : [];
  for (const [childIndex, child] of children.entries()) {
    const failure = validateLayoutNode(child, `${label}.children[${childIndex}]`, options);
    if (failure !== undefined) {
      return failure;
    }
  }
  return undefined;
};

/** A node is a view reference when it is not a box and carries no `dir`. */
const isLayoutViewNode = (node: WebviewLayoutNode): node is WebviewLayoutViewNode =>
  node.kind !== "box" && (node as WebviewLayoutContainerNode).dir === undefined;
