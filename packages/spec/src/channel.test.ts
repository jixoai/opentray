import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ChannelFrame, ChannelListEntry } from "./channel";
import {
  CHANNEL_CLOSE_REASONS,
  CHANNEL_CREATE_ERROR_CODES,
  CHANNEL_POST_ERROR_CODES,
  CHANNEL_QUEUE_MAX_BYTES,
  CHANNEL_QUEUE_MAX_MESSAGES,
  CHANNEL_TOMBSTONE_LIMIT,
  channelListEntryForPage,
  channelPayloadByteCount,
  isChannelCloseReason,
  isChannelFrame,
  isChannelListEntry,
  isChannelPayload,
} from "./channel";

const owner = { appId: "app-1", trayId: "tray-1", sessionId: "session-1" } as const;

interface FrameFixture {
  name: string;
  frame: unknown;
}

const loadFrameFixtures = (): FrameFixture[] =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../fixtures/frames/channel-frames.json", import.meta.url)),
      "utf8",
    ),
  ) as FrameFixture[];

const frameBuilders: Record<string, () => ChannelFrame> = {
  "channel.create request": () => ({ owner, type: "channel.create", target: "toolbar" }),
  "channel.create result": () => ({
    owner,
    type: "channel.create-result",
    channelId: "ch-7f3a",
  }),
  "channel.post with string payload": () => ({
    owner,
    type: "channel.post",
    channelId: "ch-7f3a",
    payload: "reload",
  }),
  "channel.post with json payload": () => ({
    owner,
    type: "channel.post",
    channelId: "ch-7f3a",
    payload: { type: "navigate", url: "https://example.com" },
  }),
  "channel.post result ok": () => ({ owner, type: "channel.post-result" }),
  "channel.close request": () => ({ owner, type: "channel.close", channelId: "ch-7f3a" }),
  "channel.close result ok (idempotent)": () => ({ owner, type: "channel.close-result" }),
  "channel.destroy request": () => ({ owner, type: "channel.destroy", channelId: "ch-7f3a" }),
  "channel.destroy result ok (idempotent)": () => ({
    owner,
    type: "channel.destroy-result",
  }),
  "channel.list request": () => ({ owner, type: "channel.list" }),
  "channel.list result with live channel and closed tombstone": () => ({
    owner,
    type: "channel.list-result",
    channels: [
      {
        channelId: "ch-7f3a",
        state: "open",
        endpoints: [
          { side: "creator", peer: "host" },
          { side: "target", peer: "toolbar" },
        ],
      },
      {
        channelId: "ch-2b91",
        state: "closed",
        reason: "explicit",
        endpoints: [
          { side: "creator", peer: "toolbar" },
          { side: "target", peer: "content" },
        ],
      },
    ],
  }),
  "channel.error typed envelope": () => ({
    owner,
    type: "channel.error",
    error: { code: "queue_overflow", message: "queue byte budget exceeded" },
  }),
  "channel.created push event to the target webview": () => ({
    owner,
    type: "channel.created",
    channelId: "ch-7f3a",
  }),
  "channel.closed push event with reason": () => ({
    owner,
    type: "channel.closed",
    channelId: "ch-7f3a",
    reason: "peer_webview_destroyed",
  }),
};

/**
 * Shared wire-shape suite: `crates/opentray-spec/src/channel.rs` builds the
 * same frames from the same fixture names, so the TypeScript and Rust DTOs
 * are pinned to identical field-level wire shapes for the seven-frame
 * inventory plus result frames and the typed error envelope.
 */
describe("channel wire fixtures", () => {
  const fixtures = loadFrameFixtures();

  it("covers the seven-frame inventory plus results and errors", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(14);
  });

  for (const { name, frame } of fixtures) {
    it(`serializes to the shared wire shape: ${name}`, () => {
      const builder = frameBuilders[name];
      if (builder === undefined) {
        throw new Error(`missing builder for fixture ${name}`);
      }
      expect(JSON.parse(JSON.stringify(builder()))).toEqual(frame);
    });

    it(`passes the incoming-frame guard: ${name}`, () => {
      expect(isChannelFrame(frame)).toBe(true);
    });
  }

  it("rejects corrupted channel frames", () => {
    expect(isChannelFrame({ owner, type: "channel.create" })).toBe(false); // missing target
    expect(isChannelFrame({ owner, type: "channel.create", target: 7 })).toBe(false);
    expect(isChannelFrame({ type: "channel.list" })).toBe(false); // owner tuple is required
    expect(
      isChannelFrame({
        owner,
        type: "channel.error",
        error: { code: "made_up_code", message: "x" },
      }),
    ).toBe(false);
    expect(
      isChannelFrame({
        owner,
        type: "channel.closed",
        channelId: "ch-7f3a",
        reason: "because",
      }),
    ).toBe(false);
    expect(
      isChannelFrame({
        owner,
        type: "channel.post",
        channelId: "ch-7f3a",
        payload: Number.NaN,
      }),
    ).toBe(false);
  });
});

describe("channel registries and bounds", () => {
  it("freezes the close reason set", () => {
    expect(CHANNEL_CLOSE_REASONS).toEqual([
      "explicit",
      "destroyed",
      "peer_webview_destroyed",
      "window_destroyed",
      "session_closed",
      "document_navigated",
      "queue_overflow",
    ]);
    expect(isChannelCloseReason("document_navigated")).toBe(true);
    expect(isChannelCloseReason("explicit")).toBe(true);
    expect(isChannelCloseReason("queue_overflow")).toBe(true);
    expect(isChannelCloseReason("timeout")).toBe(false);
  });

  it("freezes the exact queue bounds and tombstone limit", () => {
    expect(CHANNEL_QUEUE_MAX_MESSAGES).toBe(1000);
    expect(CHANNEL_QUEUE_MAX_BYTES).toBe(1_048_576);
    expect(CHANNEL_TOMBSTONE_LIMIT).toBe(32);
  });

  it("freezes per-command error codes", () => {
    expect(CHANNEL_CREATE_ERROR_CODES).toEqual(["unknown_view", "bridge_required", "session_scope"]);
    expect(CHANNEL_POST_ERROR_CODES).toEqual([
      "not_open",
      "invalid_payload",
      "payload_too_large",
      "queue_overflow",
    ]);
  });

  it("queue_overflow lives in both the reason and error namespaces", () => {
    expect(CHANNEL_CLOSE_REASONS).toContain("queue_overflow");
    expect(CHANNEL_POST_ERROR_CODES).toContain("queue_overflow");
  });
});

describe("payload accounting", () => {
  it("counts string payloads as raw UTF-8 bytes", () => {
    expect(channelPayloadByteCount("héllo")).toEqual({ ok: true, byteCount: 6 });
    expect(channelPayloadByteCount("reload")).toEqual({ ok: true, byteCount: 6 });
    expect(channelPayloadByteCount("😀")).toEqual({ ok: true, byteCount: 4 });
  });

  it("counts JSON payloads by their RFC 8785 serialization bytes", () => {
    expect(channelPayloadByteCount({ type: "navigate", url: "https://example.com" })).toEqual({
      ok: true,
      byteCount: Buffer.byteLength('{"type":"navigate","url":"https://example.com"}', "utf8"),
    });
    // Key order is canonicalized: the byte count is order-independent.
    expect(
      channelPayloadByteCount({ b: 1, a: ["x", 2] }),
    ).toEqual({ ok: true, byteCount: Buffer.byteLength('{"a":["x",2],"b":1}', "utf8") });
  });

  it("rejects values outside the RFC 8785 domain with an error", () => {
    expect(channelPayloadByteCount(Number.NaN).ok).toBe(false);
    expect(channelPayloadByteCount(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(channelPayloadByteCount({ a: undefined }).ok).toBe(false);
    expect(channelPayloadByteCount([() => {}]).ok).toBe(false);
  });

  it("validates the payload domain structurally", () => {
    expect(isChannelPayload("x")).toBe(true);
    expect(isChannelPayload(4.5)).toBe(true);
    expect(isChannelPayload(-0)).toBe(true);
    expect(isChannelPayload(null)).toBe(true);
    expect(isChannelPayload({ a: [1, "two", false, null] })).toBe(true);
    expect(isChannelPayload(Number.NaN)).toBe(false);
    expect(isChannelPayload(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isChannelPayload(undefined)).toBe(false);
    expect(isChannelPayload(() => {})).toBe(false);
    expect(isChannelPayload(1n)).toBe(false);
    expect(isChannelPayload({ a: { b: Number.NaN } })).toBe(false);
  });
});

describe("page visibility projection", () => {
  it("reduces peers to side labels without exposing webview ids", () => {
    const hostEntry: ChannelListEntry = {
      channelId: "ch-7f3a",
      state: "closed",
      reason: "peer_webview_destroyed",
      endpoints: [
        { side: "creator", peer: "host" },
        { side: "target", peer: "toolbar" },
      ],
    };
    expect(channelListEntryForPage(hostEntry)).toEqual({
      channelId: "ch-7f3a",
      state: "closed",
      reason: "peer_webview_destroyed",
      endpoints: [{ side: "creator" }, { side: "target" }],
    });
    const openEntry: ChannelListEntry = {
      channelId: "ch-2b91",
      state: "open",
      endpoints: [{ side: "creator", peer: "toolbar" }],
    };
    expect(channelListEntryForPage(openEntry)).toEqual({
      channelId: "ch-2b91",
      state: "open",
      endpoints: [{ side: "creator" }],
    });
    expect(JSON.stringify(channelListEntryForPage(hostEntry))).not.toContain("toolbar");
  });

  it("validates list entries structurally", () => {
    expect(
      isChannelListEntry({
        channelId: "ch-1",
        state: "open",
        endpoints: [{ side: "creator", peer: "host" }],
      }),
    ).toBe(true);
    expect(
      isChannelListEntry({ channelId: "ch-1", state: "destroyed", endpoints: [] }),
    ).toBe(false);
    expect(
      isChannelListEntry({
        channelId: "ch-1",
        state: "closed",
        reason: "not_a_reason",
        endpoints: [],
      }),
    ).toBe(false);
    expect(isChannelListEntry({ channelId: "ch-1", state: "open" })).toBe(false);
  });
});
