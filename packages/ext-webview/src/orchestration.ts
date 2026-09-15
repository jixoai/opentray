// Orthogonal intents (2026-09-11; original user request: add-webview-orchestration
// task 2.4 — host TS facade over the frozen multi-webview wire protocol):
// 1. Compile the frozen orchestration/channel wire frames from handle methods.
// 2. Unwrap typed Ok-data error envelopes into rejections (3.3 friction #3).
// 3. Route per-view push events and channel notices from the ext-event mirror.
// 4. Compile layout sugar into the declarative layered-flex document.
// 5. Own the host ChannelEndpoint lifecycle (single onClose observation,
//    pre-subscription buffering, idempotent close/destroy).
// Compromise: one module hosts the whole orchestration surface because the wire
// families, the frame router, and the endpoint lifecycle share the owner tuple
// and the request port; splitting them would duplicate the routing tables.

import {
  isChannelCloseReason,
  isChannelListEntry,
  isWebviewEventFrame,
  isWebviewNavigationRule,
  isWebviewOrchestrationErrorCode,
  resolveWebviewBridgePolicy,
  type ChannelCloseReason,
  type ChannelId,
  type ChannelListEntry,
  type ChannelPayload,
  type ViewId,
  type WebviewBridgePolicy,
  type WebviewErrorEnvelope,
  type WebviewEventFrame,
  type WebviewEventKind,
  type WebviewFaviconQueryResult,
  type WebviewGeometryRect,
  type WebviewId,
  type WebviewLoadPhase,
  type WebviewListEntry,
  type WebviewNavigationRule,
  type WebviewNavigationType,
  type WebviewLayoutContainerNode,
  type WebviewLayoutDocument,
  type WebviewLayoutLayer,
  type WebviewLayoutNode,
  type WebviewLayoutNodePatch,
  type WebviewLayoutSizing,
  type WebviewLayoutViewNode,
  type WebviewOrchestrationCommandFrame,
  type WebviewOrchestrationErrorCode,
  type WebviewOwnerTuple,
  type WebviewTitleQueryResult,
  type WebviewUrlQueryResult,
  type WindowId,
} from "@opentray/spec";
import { BROKER_CONNECTION_CLOSED_MESSAGE } from "opentray";

/**
 * Typed rejection for the whole orchestration/channel surface. The native
 * extension returns the frozen `{ error: { code, message } }` envelope as
 * Ok command-response data (the extension ABI's error channel is
 * category-level and cannot carry the typed registry), so the facade
 * unwraps that shape into this rejection (3.3 friction #3).
 */
export class WebviewOrchestrationError extends Error {
  readonly code: WebviewOrchestrationErrorCode;

  constructor(code: WebviewOrchestrationErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "WebviewOrchestrationError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shape discrimination for the typed error envelope riding Ok response data.
 * Covers both namespaces: the bare orchestration envelope
 * `{ error: { code, message } }` and the `channel.error` frame
 * `{ type: "channel.error", owner, error }` — both expose `.error`.
 */
export const webviewErrorEnvelopeOf = (
  data: unknown,
): WebviewErrorEnvelope | undefined => {
  if (!isRecord(data)) {
    return undefined;
  }
  const body = data.error;
  if (
    isRecord(body) &&
    isWebviewOrchestrationErrorCode(body.code) &&
    typeof body.message === "string"
  ) {
    return { error: { code: body.code, message: body.message } };
  }
  return undefined;
};

/** Default window-session id the native side binds when `show` omits one. */
export const DEFAULT_WEBVIEW_WINDOW_ID: WindowId = "default";

/**
 * Per-child content declaration for `createWebview` and the
 * `createWebviewWindow({ webviews: [...] })` bootstrap sugar. Exactly one
 * of `url` / `html`; `bridge` is the per-webview policy (partial input,
 * frozen full DTO on the wire, every field defaulting to false).
 */
export interface WebviewChildSpec {
  id: WebviewId;
  url?: string;
  html?: string;
  bridge?: Partial<WebviewBridgePolicy>;
  /**
   * Browser-behavior options. Defaults make the webview behave like an
   * ordinary browser tab: a browserlike UA (macOS appends the standard
   * Safari tokens to the bare engine UA — UA-sniffing portal homepages
   * reload-loop on the bare string; Windows already ships a full Edge UA
   * so the shaping is a no-op), a persistent storage profile, and
   * gesture-gated autoplay.
   */
  browser?: {
    /** Full User-Agent override; wins over `browserlikeUserAgent`. */
    userAgent?: string;
    /** Default `true`. `false` restores the bare engine UA. */
    browserlikeUserAgent?: boolean;
    /** Default `false`. Ephemeral (non-persistent) storage profile (macOS). */
    incognito?: boolean;
    /** Default `false`. Allow media autoplay without a user gesture. */
    autoplay?: boolean;
    /**
     * Engine-native context menu (right-click Reload/Inspect etc.).
     * Default: DISABLED when the child has any bridge capability (trusted
     * shell UI must not leak engine commands onto its chrome), ENABLED for
     * a bridgeless child (browser-tab behavior). Explicit values win
     * either way. Bootstrap-immutable like the rest of the options.
     */
    contextMenu?: boolean;
  };
  /**
   * Opt in to native favicon observation: `faviconChange` pushes plus the
   * `getFavicon()` `(value, seq)` query. Works on bridgeless children too
   * (observe-only bootstrap, no bridge surface). Default `false`.
   */
  favicon?: boolean;
  /**
   * Declarative navigation rules, evaluated synchronously on the native UI
   * thread at every navigation decision point. v1 action: `"block"` — a
   * matching navigation cancels before it starts and reports
   * `loadState failed` with the stable `navigation_blocked` error code.
   * Patterns are URL globs: `*` matches any character run (separators
   * included), everything else is literal.
   */
  navigationRules?: readonly { pattern: string; action: "block" }[];
}

/** Field-level push payloads with frame identity and the per-view `seq`. */
export interface WebviewUrlChangePush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  url: string;
}

export interface WebviewTitleChangePush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  title: string;
}

export interface WebviewFocusedPush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  focused: boolean;
}

export interface WebviewGeometryChangePush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  rect: WebviewGeometryRect | null;
}

/** `loadState` push (D24): phase truth always, `progress`/`errorCode` best-effort. */
export interface WebviewLoadStatePush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  phase: WebviewLoadPhase;
  url: string;
  errorCode?: number;
  progress?: number;
}

/** `navigationAction` push: the decision-point observation before any load. */
export interface WebviewNavigationActionPush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  url: string;
  navigationType: WebviewNavigationType;
  /** Omitted when the platform cannot attribute a gesture (macOS). */
  isUserInitiated?: boolean;
}

/** `faviconChange` push (Latest class): the settled absolute href. */
export interface WebviewFaviconChangePush {
  windowId: WindowId;
  webviewId: WebviewId;
  seq: number;
  href: string;
}

type UrlChangeHandler = (event: WebviewUrlChangePush) => void;
type TitleChangeHandler = (event: WebviewTitleChangePush) => void;
type FocusedHandler = (event: WebviewFocusedPush) => void;
type GeometryChangeHandler = (event: WebviewGeometryChangePush) => void;
type LoadStateHandler = (event: WebviewLoadStatePush) => void;
type NavigationActionHandler = (event: WebviewNavigationActionPush) => void;
type FaviconChangeHandler = (event: WebviewFaviconChangePush) => void;

/** One child webview inside a window session (frozen wire ids only). */
export interface WebviewChildHandle {
  readonly id: WebviewId;
  readonly windowId: WindowId;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  focus(): Promise<void>;
  /** Current URL with its sequence number (D19 subscribe-then-query rule). */
  getUrl(): Promise<WebviewUrlQueryResult>;
  /** Current title with its sequence number (D19 subscribe-then-query rule). */
  getTitle(): Promise<WebviewTitleQueryResult>;
  onUrlChange(handler: UrlChangeHandler): () => void;
  onTitleChange(handler: TitleChangeHandler): () => void;
  onFocused(handler: FocusedHandler): () => void;
  onGeometryChange(handler: GeometryChangeHandler): () => void;
  /** Navigation lifecycle pushes (D24): no query pair — edges only. */
  onLoadState(handler: LoadStateHandler): () => void;
  /**
   * Navigation decision pushes: one per native decision point, before the
   * load surfaces as `loadState` phases. Edge class, no query pair.
   */
  onNavigationAction(handler: NavigationActionHandler): () => void;
  /**
   * Favicon pushes (Latest class): a settled, changed absolute href. Use
   * `getFavicon()` for the subscribe-then-query current value.
   */
  onFaviconChange(handler: FaviconChangeHandler): () => void;
  /** Current favicon href with its sequence number; `href` unset until observed. */
  getFavicon(): Promise<WebviewFaviconQueryResult>;
  /** Replaces the view's declarative navigation rules (create option). */
  setNavigationRules(rules: readonly { pattern: string; action: "block" }[]): Promise<void>;
  /** Same as the parent window handle's `destroyWebview(id)`. */
  destroy(): Promise<void>;
}

/** Close notice carried by the single observable `onClose` per endpoint. */
export interface ChannelEndpointCloseNotice {
  reason: ChannelCloseReason;
}

/**
 * Host-side endpoint of one message channel (D9). Exactly `post`, `onMessage`,
 * `onClose`, `close`, `destroy`, and the channel id; no port transfer.
 */
export interface ChannelEndpoint {
  readonly id: ChannelId;
  post(payload: ChannelPayload): Promise<void>;
  onMessage(handler: (payload: ChannelPayload) => void): () => void;
  onClose(handler: (notice: ChannelEndpointCloseNotice) => void): () => void;
  /** Graceful close; tombstone stays listed. Idempotent success. */
  close(): Promise<void>;
  /** Removes channel state (and any tombstone). Idempotent no-op. */
  destroy(): Promise<void>;
}

/** `channel.created` push observed on the host facade surface. */
export interface WebviewChannelCreatedNotice {
  channelId: ChannelId;
}

/**
 * Layout sugar inputs: a full document, a bare layer array, or a single root
 * node (wrapped as the only layer). The bare-array member is mutable so
 * `Array.isArray` narrows it away from the node union without casts.
 */
export type WebviewLayoutTreeInput =
  | WebviewLayoutDocument
  | WebviewLayoutLayer[]
  | WebviewLayoutNode;

export interface WebviewLayoutContainerOptions extends WebviewLayoutSizing {
  gap?: number;
}

const sizingFields = [
  "width",
  "height",
  "flex",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
] as const;

type SizingField = (typeof sizingFields)[number];

const pickSizing = (sizing: WebviewLayoutSizing | undefined): WebviewLayoutSizing => {
  const picked: { [K in SizingField]?: number } = {};
  if (sizing !== undefined) {
    for (const field of sizingFields) {
      const value = sizing[field];
      if (value !== undefined) {
        picked[field] = value;
      }
    }
  }
  return picked;
};

/**
 * Layout sugar (webview-layout spec): pure syntax that compiles to the
 * declarative layered-flex object protocol — `row`/`column` containers,
 * `view` references, `fixed` sizes, and `grow` flex children.
 */
export const row = (
  children: readonly WebviewLayoutNode[],
  options?: WebviewLayoutContainerOptions,
): WebviewLayoutContainerNode => ({
  dir: "row",
  ...pickSizing(options),
  ...(options?.gap === undefined ? {} : { gap: options.gap }),
  children,
});

export const column = (
  children: readonly WebviewLayoutNode[],
  options?: WebviewLayoutContainerOptions,
): WebviewLayoutContainerNode => ({
  dir: "column",
  ...pickSizing(options),
  ...(options?.gap === undefined ? {} : { gap: options.gap }),
  children,
});

export const view = (
  id: ViewId,
  sizing?: WebviewLayoutSizing,
): WebviewLayoutViewNode => ({ id, ...pickSizing(sizing) });

/**
 * `fixed(id, 44)` sets a fixed height (the canonical column-child toolbar
 * shape); the object form carries any sizing fields, e.g. `{ width: 200 }`
 * for row children.
 */
export const fixed = (
  id: ViewId,
  size: number | WebviewLayoutSizing,
): WebviewLayoutViewNode =>
  typeof size === "number" ? { id, height: size } : { id, ...pickSizing(size) };

export const grow = (id: ViewId, flex = 1): WebviewLayoutViewNode => ({ id, flex });

const normalizeLayoutDocument = (tree: WebviewLayoutTreeInput): WebviewLayoutDocument => {
  if (Array.isArray(tree)) {
    return { layers: tree };
  }
  // Container nodes carry `dir`; view/box nodes carry `id` — both narrow a
  // bare root node before wrapping it as the only layer.
  if ("dir" in tree || "id" in tree) {
    return { layers: [{ root: tree }] };
  }
  return tree;
};
/**
 * Transport contract the window facade injects: the owner tuple, one Ok-data
 * request port (first response envelope's data), and the ext-event frame tap
 * (the broker mirrors every command-response envelope with a tray scope into
 * an `ext-event` frame, so the tap is the single, duplicate-free delivery
 * source for push frames).
 */
export interface WebviewOrchestrationPort {
  readonly owner: WebviewOwnerTuple;
  request(data: unknown): Promise<unknown>;
  onFrame(handler: (frame: unknown) => void): () => void;
  /**
   * Terminal transport-death tap (D3, harden-lifecycle-ownership). When the
   * hosting connection publishes its death, the orchestration stops
   * delivering, cancels gap-resync bookkeeping, and reports the death through
   * its own terminal surface. Ports without the tap keep the rejection-
   * classifier fallback: a transport-terminal rejection still marks the
   * orchestration dead.
   */
  onDead?(handler: (error: Error) => void): () => void;
}

/** Multi-webview + channel surface bound to one window session id. */
export interface WebviewWindowOrchestration {
  readonly windowId: WindowId;
  createWebview(spec: WebviewChildSpec): Promise<WebviewChildHandle>;
  destroyWebview(webviewId: WebviewId): Promise<void>;
  listWebviews(): Promise<WebviewListEntry[]>;
  setLayout(tree: WebviewLayoutTreeInput): Promise<void>;
  updateLayout(viewId: ViewId, patch: WebviewLayoutNodePatch): Promise<void>;
  createMessageChannel(options: { target: WebviewId }): Promise<ChannelEndpoint>;
  listMessageChannels(): Promise<ChannelListEntry[]>;
  destroyMessageChannel(channelId: ChannelId): Promise<void>;
  onCreatedMessageChannel(
    handler: (notice: WebviewChannelCreatedNotice) => void,
  ): () => void;
  /** Local teardown after window destroy: no wire frames (native owns them). */
  dispose(): void;
  /**
   * Terminal connection-death state: true after the broker connection died.
   * Delivery has stopped, every later command/query rejects instead of
   * hanging, and fire-and-forget failures are absorbed into `deadFailures`.
   */
  readonly connectionDead: boolean;
  /** Terminal death notification; fires exactly once. */
  onConnectionDead(handler: (error: Error) => void): () => void;
  /**
   * Fire-and-forget failures observed after death (bounded, newest last):
   * best-effort subscribe/unsubscribe frames and gap-resync queries whose
   * rejections are explained by the dead transport.
   */
  readonly deadFailures: readonly Error[];
}

interface ChannelEndpointState {
  channelId: ChannelId;
  open: boolean;
  destroyed: boolean;
  closeObserved: boolean;
  /** Buffered closure notice awaiting the first `onClose` registration. */
  closeNotice: ChannelCloseReason | undefined;
  closeHandlers: Set<(notice: ChannelEndpointCloseNotice) => void>;
  messageHandlers: Set<(payload: ChannelPayload) => void>;
  /** Buffered FIFO messages awaiting the first `onMessage` registration. */
  pendingMessages: ChannelPayload[];
}

export const createWebviewOrchestration = (
  port: WebviewOrchestrationPort,
  windowId: WindowId,
): WebviewWindowOrchestration => {
  const { owner } = port;

  const send = async (data: unknown): Promise<Record<string, unknown>> => {
    const result = await port.request(data);
    if (!isRecord(result)) {
      throw new Error(
        `webview extension returned a non-object response for ${(isRecord(data) ? data.type : "command")}: ${JSON.stringify(result)}`,
      );
    }
    return result;
  };

  const sendOrThrowEnvelope = async (data: unknown): Promise<Record<string, unknown>> => {
    const result = await send(data);
    const envelope = webviewErrorEnvelopeOf(result);
    if (envelope !== undefined) {
      throw new WebviewOrchestrationError(envelope.error.code, envelope.error.message);
    }
    return result;
  };

  const expectResult = async (
    data: unknown,
    type: string,
  ): Promise<Record<string, unknown>> => {
    const result = await sendOrThrowEnvelope(data);
    if (result.type !== type) {
      throw new Error(
        `webview extension returned ${String(result.type)} where ${type} was expected`,
      );
    }
    return result;
  };

  const sendAck = async (command: WebviewOrchestrationCommandFrame): Promise<void> => {
    const result = await expectResult(command, "webview-ack");
    if (result.command !== command.type) {
      throw new Error(
        `webview-ack echoed ${String(result.command)} for ${command.type}`,
      );
    }
  };

  // D3 connection-death state (harden-lifecycle-ownership): one terminal
  // transition per orchestration. Death stops delivery, cancels gap-resync
  // bookkeeping, closes channel endpoints locally, and absorbs fire-and-forget
  // failures into an observable state instead of console noise.
  const deadListeners = new Set<(error: Error) => void>();
  const deadFailures: Error[] = [];
  const DEAD_FAILURE_LIMIT = 16;
  let deadError: Error | undefined;

  const isTransportDeathError = (error: unknown): boolean =>
    error instanceof Error && error.message === BROKER_CONNECTION_CLOSED_MESSAGE;

  const markDead = (error: Error): void => {
    if (deadError !== undefined) {
      return;
    }
    deadError = error;
    // Cancel the gap-resync family: the in-flight (value, seq) queries belong
    // to a dead transport; their rejections are absorbed as dead failures.
    resyncInFlight.clear();
    // Stop delivering: handler maps die with the transport so late frames and
    // stale subscriptions can never reach application code.
    urlChangeHandlers.clear();
    titleChangeHandlers.clear();
    focusedHandlers.clear();
    geometryChangeHandlers.clear();
    loadStateHandlers.clear();
    channelCreatedHandlers.clear();
    // Channel endpoints observe a terminal close locally: the broker is gone,
    // so no wire-side flush will ever arrive.
    for (const state of channels.values()) {
      deliverChannelClosed(state.channelId, "session_closed");
    }
    channels.clear();
    for (const listener of [...deadListeners]) {
      try {
        listener(error);
      } catch {
        // One throwing terminal listener must not block the rest.
      }
    }
  };

  const absorbDeadFailure = (error: unknown): void => {
    const failure = error instanceof Error ? error : new Error(String(error));
    deadFailures.push(failure);
    if (deadFailures.length > DEAD_FAILURE_LIMIT) {
      deadFailures.splice(0, deadFailures.length - DEAD_FAILURE_LIMIT);
    }
    // Ports without an onDead tap still reach the terminal state through the
    // rejection classifier: a transport-terminal rejection is death evidence.
    if (deadError === undefined && isTransportDeathError(error)) {
      markDead(failure);
    }
  };

  const stopDeadTap = port.onDead?.((error: Error) => {
    markDead(error);
  });

  // Fire-and-forget wire frames (subscribe/unsubscribe). Observability of a
  // transport failure rides the existing connection lifecycle; report once.
  // Death-explained failures merge into the connection-dead state (D3);
  // only genuinely unexplained failures keep the console channel.
  const sendBestEffort = (command: WebviewOrchestrationCommandFrame): void => {
    if (deadError !== undefined) {
      return;
    }
    void sendOrThrowEnvelope(command).catch((error: unknown) => {
      if (deadError !== undefined || isTransportDeathError(error)) {
        absorbDeadFailure(error);
        return;
      }
      console.error("WebView orchestration frame failed:", error);
    });
  };

  const urlChangeHandlers = new Map<WebviewId, Set<UrlChangeHandler>>();
  const titleChangeHandlers = new Map<WebviewId, Set<TitleChangeHandler>>();
  const focusedHandlers = new Map<WebviewId, Set<FocusedHandler>>();
  const geometryChangeHandlers = new Map<WebviewId, Set<GeometryChangeHandler>>();
  const loadStateHandlers = new Map<WebviewId, Set<LoadStateHandler>>();
  const navigationActionHandlers = new Map<WebviewId, Set<NavigationActionHandler>>();
  const faviconChangeHandlers = new Map<WebviewId, Set<FaviconChangeHandler>>();

  // D19 batch B gap-resync: one per-view sequence counter is shared across
  // all event kinds natively, so the facade observes `seq` for every frame
  // of the view. A jump (> last + 1) means the transport coalesced or lost
  // records (EventPort `Latest` replacement by contract); urlChange and
  // titleChange subscribers then re-read state through the frozen
  // `(value, seq)` query pair and converge on the higher sequence.
  const lastViewSeq = new Map<WebviewId, number>();
  // D19 final review B6: the DELIVERED high-water per (view, kind). The
  // shared counter above is the native authority for gap detection; the
  // discard rule is per kind — each kind's stream is monotonic (a
  // subsequence of the shared native counter), while interleaving kinds
  // legitimately arrive out of shared order.
  const deliveredKindSeq = new Map<string, number>();
  const resyncInFlight = new Set<string>();
  // D19 final review B6: view lifecycle generations. A destroyed webview's
  // in-flight resync query must never deliver into a re-created view that
  // happens to reuse the id (its native ViewEvents restarts at seq 1, so
  // the old query's higher seq would otherwise look authoritative).
  const viewGenerations = new Map<WebviewId, number>();

  /** Observes one wire frame's seq; returns the previous observed seq. */
  const observeSeq = (webviewId: WebviewId, seq: number): number | undefined => {
    const previous = lastViewSeq.get(webviewId);
    if (previous === undefined || seq > previous) {
      lastViewSeq.set(webviewId, seq);
    }
    return previous;
  };

  const kindSeqKey = (webviewId: WebviewId, kind: WebviewEventKind): string =>
    `${kind}:${webviewId}`;

  /**
   * Observes one delivered (view, kind) seq; returns the previously
   * delivered seq of that kind, or undefined when this is the kind's first
   * delivery for the view.
   */
  const observeKindSeq = (
    webviewId: WebviewId,
    kind: WebviewEventKind,
    seq: number,
  ): number | undefined => {
    const key = kindSeqKey(webviewId, kind);
    const previous = deliveredKindSeq.get(key);
    if (previous === undefined || seq > previous) {
      deliveredKindSeq.set(key, seq);
    }
    return previous;
  };

  /**
   * Sequence-gap repair for the two Latest-class kinds: queries the current
   * `(value, seq)` and, when the query outranks the delivered frame,
   * delivers the higher observation to the view's handlers. Fire-and-forget
   * observability matches the subscribe frames' transport-failure rule.
   *
   * Completion re-checks (D19 final review B6): the query result is
   * discarded unless it still outranks the view's CURRENT high-water (a
   * higher frame may have arrived while the query was in flight — its
   * result would then be a stale lower observation) and the view's
   * lifecycle generation still matches the one the query was issued for
   * (destroy/recreate must not adopt an old generation's answer).
   */
  const resyncAfterGap = (
    webviewId: WebviewId,
    kind: "urlChange" | "titleChange" | "faviconChange",
    deliveredSeq: number,
  ): void => {
    if (deadError !== undefined) {
      return;
    }
    // The in-flight marker is generation-qualified: a destroy/recreate
    // bumps the generation, so an old promise's finally can never remove a
    // new generation's marker (final review P2).
    const generation = viewGenerations.get(webviewId) ?? 0;
    const inflightKey = `${kind}:${webviewId}#${generation}`;
    if (resyncInFlight.has(inflightKey)) {
      return;
    }
    resyncInFlight.add(inflightKey);
    const commandType =
      kind === "urlChange" ? "get-webview-url" : kind === "titleChange" ? "get-webview-title" : "get-webview-favicon";
    void expectResult(
      {
        owner,
        type: commandType,
        windowId,
        webviewId,
      } as WebviewOrchestrationCommandFrame,
      `${commandType}-result`,
    )
      .then((result) => {
        if (deadError !== undefined) {
          return;
        }
        if ((viewGenerations.get(webviewId) ?? 0) !== generation) {
          // The view this query was issued for is gone (destroyed and
          // possibly re-created under the same id); its answer must not
          // reach the new view's handlers.
          return;
        }
        const querySeq = Number(result.seq);
        const currentKindHighWater = deliveredKindSeq.get(kindSeqKey(webviewId, kind));
        if (
          !Number.isFinite(querySeq) ||
          querySeq <= deliveredSeq ||
          (currentKindHighWater !== undefined && querySeq <= currentKindHighWater)
        ) {
          return;
        }
        observeSeq(webviewId, querySeq);
        observeKindSeq(webviewId, kind, querySeq);
        if (kind === "urlChange") {
          const set = urlChangeHandlers.get(webviewId);
          if (set !== undefined) {
            callHandlers(set, {
              windowId,
              webviewId,
              seq: querySeq,
              url: String(result.url),
            });
          }
        }
        if (kind === "faviconChange") {
          const set = faviconChangeHandlers.get(webviewId);
          if (set !== undefined && result.href !== undefined && result.href !== null) {
            callHandlers(set, {
              windowId,
              webviewId,
              seq: querySeq,
              href: String(result.href),
            });
          }
        } else {
          const set = titleChangeHandlers.get(webviewId);
          if (set !== undefined) {
            callHandlers(set, {
              windowId,
              webviewId,
              seq: querySeq,
              title: String(result.title),
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (deadError !== undefined || isTransportDeathError(error)) {
          // D3: the resync query died with the transport; its cancellation is
          // part of the connection-dead state, not console noise.
          absorbDeadFailure(error);
          return;
        }
        console.error("WebView orchestration sequence-gap resync failed:", error);
      })
      .finally(() => {
        resyncInFlight.delete(inflightKey);
      });
  };

  const channels = new Map<ChannelId, ChannelEndpointState>();
  const channelCreatedHandlers = new Set<(notice: WebviewChannelCreatedNotice) => void>();

  const subscribeFrame = (
    type: "subscribe-webview-events" | "unsubscribe-webview-events",
    webviewId: WebviewId,
    kind: WebviewEventKind,
  ): void => {
    sendBestEffort({
      owner,
      type,
      windowId,
      webviewId,
      kinds: [kind],
    } as WebviewOrchestrationCommandFrame);
  };

  const addViewListener = <THandler>(
    handlers: Map<WebviewId, Set<THandler>>,
    webviewId: WebviewId,
    kind: WebviewEventKind,
    handler: THandler,
  ): (() => void) => {
    const set = handlers.get(webviewId) ?? new Set<THandler>();
    const wasEmpty = set.size === 0;
    set.add(handler);
    handlers.set(webviewId, set);
    if (wasEmpty) {
      subscribeFrame("subscribe-webview-events", webviewId, kind);
    }
    return () => {
      const active = handlers.get(webviewId);
      if (active === undefined || !active.delete(handler)) {
        return;
      }
      if (active.size === 0) {
        handlers.delete(webviewId);
        subscribeFrame("unsubscribe-webview-events", webviewId, kind);
      }
    };
  };

  const dropViewListeners = (webviewId: WebviewId): void => {
    urlChangeHandlers.delete(webviewId);
    titleChangeHandlers.delete(webviewId);
    focusedHandlers.delete(webviewId);
    geometryChangeHandlers.delete(webviewId);
    loadStateHandlers.delete(webviewId);
    navigationActionHandlers.delete(webviewId);
    faviconChangeHandlers.delete(webviewId);
    // A destroyed webview's per-view sequence counter dies with it; a
    // re-created id must not inherit a stale high-water mark (its native
    // ViewEvents restarts at seq 1).
    lastViewSeq.delete(webviewId);
    // Exact-kind prefix + suffix match is ambiguous when a webview id
    // itself contains the separator; scan with a precise per-kind key set
    // instead (final review P2 opaque-id boundary).
    for (const kind of ["urlChange", "titleChange", "faviconChange"] as const) {
      deliveredKindSeq.delete(`${kind}:${webviewId}`);
    }
    // D19 final review B6: bump the lifecycle generation so an in-flight
    // resync query issued for the destroyed view cannot deliver into a
    // re-created view under the same id.
    viewGenerations.set(webviewId, (viewGenerations.get(webviewId) ?? 0) + 1);
    // Generation-qualified markers only: remove every generation of this
    // (kind, webview) pair; the `#gen` suffix cannot appear ambiguously in a
    // foreign id's marker because the kind prefix is a fixed enum.
    for (const key of [...resyncInFlight]) {
      for (const kind of ["urlChange", "titleChange", "faviconChange"] as const) {
        if (key.startsWith(`${kind}:${webviewId}#`)) {
          resyncInFlight.delete(key);
        }
      }
    }
  };

  const callHandlers = <TEvent>(
    handlers: Set<(event: TEvent) => void>,
    event: TEvent,
  ): void => {
    for (const handler of [...handlers]) {
      handler(event);
    }
  };

  const deliverViewEvent = (frame: WebviewEventFrame): void => {
    if (deadError !== undefined || frame.windowId !== windowId) {
      return;
    }
    const previousSeq = observeSeq(frame.webviewId, frame.seq);
    // D19 final review B6: stale frames are discarded at the entry, before
    // any handler runs. Within one (view, kind) stream a record whose seq
    // does not exceed the delivered high-water is an older observation the
    // transport reordered or a duplicate the coalescing window emitted —
    // never new truth. Other kinds keep their own monotonic streams.
    const previousKindSeq = observeKindSeq(frame.webviewId, frame.kind, frame.seq);
    if (previousKindSeq !== undefined && frame.seq <= previousKindSeq) {
      return;
    }
    const identity = {
      windowId: frame.windowId,
      webviewId: frame.webviewId,
      seq: frame.seq,
    };
    switch (frame.kind) {
      case "urlChange": {
        const set = urlChangeHandlers.get(frame.webviewId);
        if (set !== undefined) {
          callHandlers(set, { ...identity, url: frame.payload.url });
          if (previousSeq !== undefined && frame.seq > previousSeq + 1) {
            resyncAfterGap(frame.webviewId, "urlChange", frame.seq);
          }
        }
        return;
      }
      case "titleChange": {
        const set = titleChangeHandlers.get(frame.webviewId);
        if (set !== undefined) {
          callHandlers(set, { ...identity, title: frame.payload.title });
          if (previousSeq !== undefined && frame.seq > previousSeq + 1) {
            resyncAfterGap(frame.webviewId, "titleChange", frame.seq);
          }
        }
        return;
      }
      case "focused": {
        const set = focusedHandlers.get(frame.webviewId);
        if (set !== undefined) {
          callHandlers(set, { ...identity, focused: frame.payload.focused });
        }
        return;
      }
      case "geometryChange": {
        const set = geometryChangeHandlers.get(frame.webviewId);
        if (set !== undefined) {
          callHandlers(set, { ...identity, rect: frame.payload.rect });
        }
        return;
      }
      case "loadState": {
        const set = loadStateHandlers.get(frame.webviewId);
        if (set !== undefined) {
          const { phase, url, errorCode, progress } = frame.payload;
          callHandlers(set, {
            ...identity,
            phase,
            url,
            ...(errorCode === undefined ? {} : { errorCode }),
            ...(progress === undefined ? {} : { progress }),
          });
        }
        return;
      }
      case "navigationAction": {
        const set = navigationActionHandlers.get(frame.webviewId);
        if (set !== undefined) {
          const { url, navigationType, isUserInitiated } = frame.payload;
          callHandlers(set, {
            ...identity,
            url,
            navigationType,
            ...(isUserInitiated === undefined ? {} : { isUserInitiated }),
          });
        }
        return;
      }
      case "faviconChange": {
        const set = faviconChangeHandlers.get(frame.webviewId);
        if (set !== undefined) {
          callHandlers(set, { ...identity, href: frame.payload.href });
          if (previousSeq !== undefined && frame.seq > previousSeq + 1) {
            resyncAfterGap(frame.webviewId, "faviconChange", frame.seq);
          }
        }
        return;
      }
    }
  };

  const deliverChannelMessage = (channelId: ChannelId, payload: unknown): void => {
    const state = channels.get(channelId);
    if (state === undefined || !state.open) {
      return;
    }
    if (state.messageHandlers.size === 0) {
      // Pre-subscription buffering (mirrors the page-bridge D11 clearance):
      // the first onMessage registration drains the FIFO buffer.
      state.pendingMessages.push(payload as ChannelPayload);
      return;
    }
    for (const handler of [...state.messageHandlers]) {
      handler(payload as ChannelPayload);
    }
  };

  const deliverChannelClosed = (channelId: ChannelId, reason: ChannelCloseReason): void => {
    const state = channels.get(channelId);
    if (state === undefined) {
      return;
    }
    state.open = false;
    if (state.closeObserved) {
      return;
    }
    state.closeObserved = true;
    state.closeNotice = reason;
    if (state.closeHandlers.size > 0) {
      for (const handler of [...state.closeHandlers]) {
        handler({ reason });
      }
    }
  };

  const routeFrame = (frame: unknown): void => {
    if (isWebviewEventFrame(frame)) {
      deliverViewEvent(frame);
      return;
    }
    if (!isRecord(frame)) {
      return;
    }
    switch (frame.type) {
      case "channel.created":
        if (typeof frame.channelId === "string") {
          for (const handler of [...channelCreatedHandlers]) {
            handler({ channelId: frame.channelId });
          }
        }
        return;
      case "channel.closed":
        if (
          typeof frame.channelId === "string" &&
          isChannelCloseReason(frame.reason)
        ) {
          deliverChannelClosed(frame.channelId, frame.reason);
        }
        return;
      case "channel.message":
        if (typeof frame.channelId === "string") {
          deliverChannelMessage(frame.channelId, frame.payload);
        }
        return;
      default:
        return;
    }
  };

  const stopFrameTap = port.onFrame(routeFrame);

  const endpointOf = (state: ChannelEndpointState): ChannelEndpoint => ({
    get id(): ChannelId {
      return state.channelId;
    },
    async post(payload: ChannelPayload): Promise<void> {
      if (!state.open) {
        throw new WebviewOrchestrationError(
          "not_open",
          `channel ${state.channelId} is not open`,
        );
      }
      try {
        await expectResult(
          {
            owner,
            type: "channel.post",
            channelId: state.channelId,
            payload,
          },
          "channel.post-result",
        );
      } catch (error) {
        // `not_open` and `queue_overflow` both imply the channel is now
        // closed; record the local transition instead of round-tripping
        // the next post through the same rejection.
        if (
          error instanceof WebviewOrchestrationError &&
          (error.code === "not_open" || error.code === "queue_overflow")
        ) {
          state.open = false;
        }
        throw error;
      }
    },
    onMessage(handler: (payload: ChannelPayload) => void): () => void {
      state.messageHandlers.add(handler);
      if (state.pendingMessages.length > 0) {
        const buffered = state.pendingMessages.splice(0);
        for (const payload of buffered) {
          handler(payload);
        }
      }
      return () => {
        state.messageHandlers.delete(handler);
      };
    },
    onClose(handler: (notice: ChannelEndpointCloseNotice) => void): () => void {
      state.closeHandlers.add(handler);
      const buffered = state.closeNotice;
      if (buffered !== undefined && state.closeObserved) {
        state.closeNotice = undefined;
        handler({ reason: buffered });
      }
      return () => {
        state.closeHandlers.delete(handler);
      };
    },
    async close(): Promise<void> {
      if (!state.open) {
        return;
      }
      await expectResult(
        { owner, type: "channel.close", channelId: state.channelId },
        "channel.close-result",
      );
      state.open = false;
    },
    async destroy(): Promise<void> {
      if (state.destroyed) {
        return;
      }
      await expectResult(
        { owner, type: "channel.destroy", channelId: state.channelId },
        "channel.destroy-result",
      );
      state.destroyed = true;
      state.open = false;
    },
  });

  const childHandle = (webviewId: WebviewId): WebviewChildHandle => ({
    id: webviewId,
    windowId,
    navigate(url: string): Promise<void> {
      return sendAck({
        owner,
        type: "navigate-webview",
        windowId,
        webviewId,
        url,
      } as WebviewOrchestrationCommandFrame);
    },
    back(): Promise<void> {
      return sendAck({
        owner,
        type: "back-webview",
        windowId,
        webviewId,
      } as WebviewOrchestrationCommandFrame);
    },
    forward(): Promise<void> {
      return sendAck({
        owner,
        type: "forward-webview",
        windowId,
        webviewId,
      } as WebviewOrchestrationCommandFrame);
    },
    focus(): Promise<void> {
      return sendAck({
        owner,
        type: "focus-webview",
        windowId,
        webviewId,
      } as WebviewOrchestrationCommandFrame);
    },
    async getUrl(): Promise<WebviewUrlQueryResult> {
      const result = await expectResult(
        { owner, type: "get-webview-url", windowId, webviewId } as WebviewOrchestrationCommandFrame,
        "get-webview-url-result",
      );
      const seq = Number(result.seq);
      // D19 final review B6: a successful (value, seq) query is itself a
      // sequence observation — the native counter is at least at `seq`, so
      // a later-arriving frame at or below it is stale and dropped at the
      // delivery entry (the subscription-race contract the facade owns).
      if (Number.isFinite(seq)) {
        observeSeq(webviewId, seq);
        observeKindSeq(webviewId, "urlChange", seq);
      }
      return { url: String(result.url), seq };
    },
    async getTitle(): Promise<WebviewTitleQueryResult> {
      const result = await expectResult(
        {
          owner,
          type: "get-webview-title",
          windowId,
          webviewId,
        } as WebviewOrchestrationCommandFrame,
        "get-webview-title-result",
      );
      const seq = Number(result.seq);
      if (Number.isFinite(seq)) {
        observeSeq(webviewId, seq);
        observeKindSeq(webviewId, "titleChange", seq);
      }
      return { title: String(result.title), seq };
    },
    onUrlChange(handler: UrlChangeHandler): () => void {
      return addViewListener(urlChangeHandlers, webviewId, "urlChange", handler);
    },
    onTitleChange(handler: TitleChangeHandler): () => void {
      return addViewListener(titleChangeHandlers, webviewId, "titleChange", handler);
    },
    onFocused(handler: FocusedHandler): () => void {
      return addViewListener(focusedHandlers, webviewId, "focused", handler);
    },
    onGeometryChange(handler: GeometryChangeHandler): () => void {
      return addViewListener(geometryChangeHandlers, webviewId, "geometryChange", handler);
    },
    onLoadState(handler: LoadStateHandler): () => void {
      return addViewListener(loadStateHandlers, webviewId, "loadState", handler);
    },
    onNavigationAction(handler: NavigationActionHandler): () => void {
      return addViewListener(navigationActionHandlers, webviewId, "navigationAction", handler);
    },
    onFaviconChange(handler: FaviconChangeHandler): () => void {
      return addViewListener(faviconChangeHandlers, webviewId, "faviconChange", handler);
    },
    async getFavicon(): Promise<WebviewFaviconQueryResult> {
      const result = await expectResult(
        {
          owner,
          type: "get-webview-favicon",
          windowId,
          webviewId,
        } as WebviewOrchestrationCommandFrame,
        "get-webview-favicon-result",
      );
      const seq = Number(result.seq);
      if (Number.isFinite(seq)) {
        observeSeq(webviewId, seq);
        observeKindSeq(webviewId, "faviconChange", seq);
      }
      return {
        ...(result.href === undefined || result.href === null ? {} : { href: String(result.href) }),
        seq,
      };
    },
    setNavigationRules(rules: readonly { pattern: string; action: "block" }[]): Promise<void> {
      if (rules.some((rule) => !isWebviewNavigationRule(rule))) {
        return Promise.reject(
          new Error("setNavigationRules requires { pattern: non-empty string, action: 'block' } entries"),
        );
      }
      return sendAck({
        owner,
        type: "set-webview-navigation-rules",
        windowId,
        webviewId,
        rules,
      } as WebviewOrchestrationCommandFrame);
    },
    destroy(): Promise<void> {
      return destroyWebview(webviewId);
    },
  });

  const createWebview = async (spec: WebviewChildSpec): Promise<WebviewChildHandle> => {
    if (spec.id.length === 0) {
      throw new Error("createWebview requires a non-empty webview id");
    }
    if (spec.url === undefined === (spec.html === undefined)) {
      throw new Error("createWebview requires exactly one of url or html");
    }
    await sendAck({
      owner,
      type: "create-webview",
      windowId,
      webviewId: spec.id,
      ...(spec.url === undefined ? {} : { url: spec.url }),
      ...(spec.html === undefined ? {} : { html: spec.html }),
      ...(spec.bridge === undefined ? {} : { bridge: resolveWebviewBridgePolicy(spec.bridge) }),
      ...(spec.browser === undefined ? {} : { browser: spec.browser }),
      ...(spec.favicon === undefined ? {} : { favicon: spec.favicon }),
      ...(spec.navigationRules === undefined ? {} : { navigationRules: spec.navigationRules }),
    } as WebviewOrchestrationCommandFrame);
    return childHandle(spec.id);
  };

  const destroyWebview = async (webviewId: WebviewId): Promise<void> => {
    await sendAck({
      owner,
      type: "destroy-webview",
      windowId,
      webviewId,
    } as WebviewOrchestrationCommandFrame);
    // The native view state (and its subscriptions) died with the webview;
    // only the local routing entries need clearing.
    dropViewListeners(webviewId);
  };

  const listWebviews = async (): Promise<WebviewListEntry[]> => {
    const result = await expectResult(
      { owner, type: "list-webviews", windowId } as WebviewOrchestrationCommandFrame,
      "list-webviews-result",
    );
    const webviews = result.webviews;
    if (!Array.isArray(webviews) || !webviews.every((entry) => isRecord(entry))) {
      throw new Error("list-webviews-result carried a malformed webviews array");
    }
    return webviews as unknown as WebviewListEntry[];
  };

  const setLayout = async (tree: WebviewLayoutTreeInput): Promise<void> => {
    await sendAck({
      owner,
      type: "set-webview-layout",
      windowId,
      layout: normalizeLayoutDocument(tree),
    } as WebviewOrchestrationCommandFrame);
  };

  const updateLayout = async (
    viewId: ViewId,
    patch: WebviewLayoutNodePatch,
  ): Promise<void> => {
    await sendAck({
      owner,
      type: "update-webview-layout",
      windowId,
      viewId,
      patch: pickSizing(patch),
    } as WebviewOrchestrationCommandFrame);
  };

  const createMessageChannel = async (options: {
    target: WebviewId;
  }): Promise<ChannelEndpoint> => {
    const result = await expectResult(
      { owner, type: "channel.create", target: options.target },
      "channel.create-result",
    );
    const channelId = result.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      throw new Error("channel.create-result carried a malformed channelId");
    }
    const state: ChannelEndpointState = {
      channelId,
      open: true,
      destroyed: false,
      closeObserved: false,
      closeNotice: undefined,
      closeHandlers: new Set(),
      messageHandlers: new Set(),
      pendingMessages: [],
    };
    channels.set(channelId, state);
    return endpointOf(state);
  };

  const listMessageChannels = async (): Promise<ChannelListEntry[]> => {
    const result = await expectResult(
      { owner, type: "channel.list" },
      "channel.list-result",
    );
    const entries = result.channels;
    if (!Array.isArray(entries) || !entries.every((entry) => isChannelListEntry(entry))) {
      throw new Error("channel.list-result carried a malformed channels array");
    }
    return entries;
  };

  const destroyMessageChannel = async (channelId: ChannelId): Promise<void> => {
    const state = channels.get(channelId);
    if (state !== undefined && state.destroyed) {
      return;
    }
    await expectResult(
      { owner, type: "channel.destroy", channelId },
      "channel.destroy-result",
    );
    if (state !== undefined) {
      state.destroyed = true;
      state.open = false;
    }
  };

  const onCreatedMessageChannel = (
    handler: (notice: WebviewChannelCreatedNotice) => void,
  ): (() => void) => {
    channelCreatedHandlers.add(handler);
    return () => {
      channelCreatedHandlers.delete(handler);
    };
  };

  const dispose = (): void => {
    stopFrameTap();
    stopDeadTap?.();
    urlChangeHandlers.clear();
    titleChangeHandlers.clear();
    focusedHandlers.clear();
    geometryChangeHandlers.clear();
    loadStateHandlers.clear();
    lastViewSeq.clear();
    resyncInFlight.clear();
    channels.clear();
    channelCreatedHandlers.clear();
    deadListeners.clear();
  };

  return {
    windowId,
    createWebview,
    destroyWebview,
    listWebviews,
    setLayout,
    updateLayout,
    createMessageChannel,
    listMessageChannels,
    destroyMessageChannel,
    onCreatedMessageChannel,
    dispose,
    get connectionDead(): boolean {
      return deadError !== undefined;
    },
    onConnectionDead(handler: (error: Error) => void): () => void {
      deadListeners.add(handler);
      return () => {
        deadListeners.delete(handler);
      };
    },
    get deadFailures(): readonly Error[] {
      return deadFailures;
    },
  };
};
