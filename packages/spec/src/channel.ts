import { canonicalJsonEncode, utf8ByteCount } from "./canonical-json";
import type { WebviewId, WebviewOrchestrationErrorCode, WebviewOwnerTuple } from "./webview";
import { isWebviewOrchestrationErrorCode } from "./webview";

/**
 * Message-channel wire protocol (D9–D11, D20): targeted connections without
 * port transfer, an explicit observable lifecycle state machine, exact queue
 * bounds, and the frozen seven-frame inventory below. Errors use the
 * typed-code envelope `{ error: { code, message } }` and the owner tuple
 * rides every frame envelope. The Rust mirror lives in
 * `crates/opentray-spec/src/channel.rs`; both sides are pinned to the same
 * wire shapes by the shared fixtures in `fixtures/frames/channel-frames.json`.
 */

/** Opaque channel id, unique within its session scope. */
export type ChannelId = string;

export type ChannelEndpointSide = "creator" | "target";

/** Listed channel states; `destroyed` channels are never listed. */
export type ChannelState = "open" | "closed";

/**
 * Channel close reasons (D11/D20). `queue_overflow` also appears in the
 * error-code registry as the `channel.post` failure code — it is the one
 * value shared across the reason and error namespaces.
 */
export const CHANNEL_CLOSE_REASONS = [
  "explicit",
  "destroyed",
  "peer_webview_destroyed",
  "window_destroyed",
  "session_closed",
  "document_navigated",
  "queue_overflow",
] as const;

export type ChannelCloseReason = (typeof CHANNEL_CLOSE_REASONS)[number];

export const isChannelCloseReason = (value: unknown): value is ChannelCloseReason =>
  typeof value === "string" && (CHANNEL_CLOSE_REASONS as readonly unknown[]).includes(value);

/** Exact queue bounds (D20): boundary values themselves are legal. */
export const CHANNEL_QUEUE_MAX_MESSAGES = 1000;

/** 1 MiB cumulative payload byte budget per port queue. */
export const CHANNEL_QUEUE_MAX_BYTES = 1_048_576;

/** Per-session closed-tombstone retention bound (oldest evicted). */
export const CHANNEL_TOMBSTONE_LIMIT = 32;

/** Error codes each command may legitimately return (frozen registry). */
export const CHANNEL_CREATE_ERROR_CODES = [
  "unknown_view",
  "bridge_required",
  "session_scope",
] as const;

export const CHANNEL_POST_ERROR_CODES = [
  "not_open",
  "invalid_payload",
  "payload_too_large",
  "queue_overflow",
] as const;

/** Channel payload: a UTF-8 string or any RFC 8785-encodable JSON value. */
export type ChannelPayload =
  | string
  | number
  | boolean
  | null
  | ChannelJsonObject
  | readonly ChannelPayload[];

export interface ChannelJsonObject {
  [key: string]: ChannelPayload;
}

/**
 * The frozen wire inventory: create / post / close / destroy / list plus the
 * `created` / `closed` push events (seven frame families), their result
 * frames, and the typed error envelope.
 */
export type ChannelFrame = { owner: WebviewOwnerTuple } &
  (
    | { type: "channel.create"; target: WebviewId }
    | { type: "channel.create-result"; channelId: ChannelId }
    | { type: "channel.post"; channelId: ChannelId; payload: ChannelPayload }
    | { type: "channel.post-result" }
    | { type: "channel.close"; channelId: ChannelId }
    | { type: "channel.close-result" }
    | { type: "channel.destroy"; channelId: ChannelId }
    | { type: "channel.destroy-result" }
    | { type: "channel.list" }
    | { type: "channel.list-result"; channels: ChannelListEntry[] }
    | {
        type: "channel.error";
        error: { code: WebviewOrchestrationErrorCode; message: string };
      }
    | { type: "channel.created"; channelId: ChannelId }
    | { type: "channel.closed"; channelId: ChannelId; reason: ChannelCloseReason }
  );

const CHANNEL_FRAME_TYPES = [
  "channel.create",
  "channel.create-result",
  "channel.post",
  "channel.post-result",
  "channel.close",
  "channel.close-result",
  "channel.destroy",
  "channel.destroy-result",
  "channel.list",
  "channel.list-result",
  "channel.error",
  "channel.created",
  "channel.closed",
] as const satisfies ReadonlyArray<ChannelFrame["type"]>;

/** Host-facing endpoint descriptor: side plus the peer (webview id or `"host"`). */
export interface ChannelEndpointDescriptor {
  side: ChannelEndpointSide;
  peer: WebviewId | "host";
}

/** One listed channel (live or closed tombstone with its close reason). */
export interface ChannelListEntry {
  channelId: ChannelId;
  state: ChannelState;
  reason?: ChannelCloseReason;
  endpoints: readonly ChannelEndpointDescriptor[];
}

/** Page-facing endpoint descriptor: side label only, never a peer webview id. */
export interface PageChannelEndpointDescriptor {
  side: ChannelEndpointSide;
}

/** Page-visible list entry: peers are reduced to side labels. */
export interface PageChannelListEntry {
  channelId: ChannelId;
  state: ChannelState;
  reason?: ChannelCloseReason;
  endpoints: readonly PageChannelEndpointDescriptor[];
}

/**
 * Projects one list entry to the page-visible shape: page peers see the side
 * label only — peer webview ids are never exposed to pages (D20 visibility).
 */
export const channelListEntryForPage = (entry: ChannelListEntry): PageChannelListEntry => {
  const pageEntry: PageChannelListEntry = {
    channelId: entry.channelId,
    state: entry.state,
    endpoints: entry.endpoints.map((endpoint) => ({ side: endpoint.side })),
  };
  if (entry.reason !== undefined) {
    pageEntry.reason = entry.reason;
  }
  return pageEntry;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Field-level guard for incoming channel frames. */
export const isChannelFrame = (value: unknown): value is ChannelFrame => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (!(CHANNEL_FRAME_TYPES as readonly unknown[]).includes(value.type)) {
    return false;
  }
  const owner = value.owner;
  if (
    !isRecord(owner) ||
    typeof owner.appId !== "string" ||
    typeof owner.trayId !== "string" ||
    typeof owner.sessionId !== "string"
  ) {
    return false;
  }
  switch (value.type) {
    case "channel.create":
      return typeof value.target === "string";
    case "channel.post":
      return (
        typeof value.channelId === "string" &&
        isChannelPayload(value.payload)
      );
    case "channel.close":
    case "channel.destroy":
    case "channel.created":
      return typeof value.channelId === "string";
    case "channel.closed":
      return typeof value.channelId === "string" && isChannelCloseReason(value.reason);
    case "channel.list":
      return true;
    case "channel.error":
      return (
        isRecord(value.error) &&
        typeof value.error.message === "string" &&
        isWebviewOrchestrationErrorCode(value.error.code)
      );
    default:
      // create-result / post-result / close-result / destroy-result / list-result
      return isChannelFrameResult(value);
  }
};

const isChannelFrameResult = (value: Record<string, unknown>): boolean => {
  switch (value.type) {
    case "channel.create-result":
      return typeof value.channelId === "string";
    case "channel.post-result":
    case "channel.close-result":
    case "channel.destroy-result":
      return true;
    case "channel.list-result":
      return Array.isArray(value.channels) && value.channels.every(isChannelListEntry);
    default:
      return false;
  }
};

/** Structural guard for one `channel.list` entry. */
export const isChannelListEntry = (value: unknown): value is ChannelListEntry => {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.channelId !== "string" || (value.state !== "open" && value.state !== "closed")) {
    return false;
  }
  if (value.reason !== undefined && !isChannelCloseReason(value.reason)) {
    return false;
  }
  if (!Array.isArray(value.endpoints)) {
    return false;
  }
  return value.endpoints.every(
    (endpoint) =>
      isRecord(endpoint) &&
      (endpoint.side === "creator" || endpoint.side === "target") &&
      (endpoint.peer === "host" || typeof endpoint.peer === "string"),
  );
};

/** Returns true for values inside the channel payload domain. */
export const isChannelPayload = (value: unknown): value is ChannelPayload => {
  if (typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean" || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isChannelPayload);
  }
  if (isRecord(value)) {
    // Object members with present-undefined values are outside the domain
    // (the canonical encoder rejects them); reject here too.
    return Object.values(value).every((entry) => isChannelPayload(entry));
  }
  return false;
};

export type ChannelPayloadByteCountResult =
  | { readonly ok: true; readonly byteCount: number }
  | { readonly ok: false; readonly error: string };

/**
 * Byte accounting for the queue budget (D20): a string payload counts its
 * raw UTF-8 bytes; any other JSON payload counts the UTF-8 bytes of its
 * RFC 8785 serialization. Values outside the RFC 8785 domain
 * (NaN/Infinity/undefined/functions) reject — callers map that rejection to
 * the typed error `invalid_payload`.
 */
export const channelPayloadByteCount = (payload: unknown): ChannelPayloadByteCountResult => {
  if (typeof payload === "string") {
    return { ok: true, byteCount: utf8ByteCount(payload) };
  }
  const canonical = canonicalJsonEncode(payload);
  if (!canonical.ok) {
    return { ok: false, error: canonical.error };
  }
  return { ok: true, byteCount: canonical.bytes.byteLength };
};
