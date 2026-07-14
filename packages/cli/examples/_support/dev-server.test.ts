// Orthogonal intents (2026-07-14; original user request: `example:webview-control` exits before Vite readiness):
// 1. Verify Vite Local URL resolution does not parse terminal output.
// 2. Verify loopback readiness retries remain deterministic.

import { describe, expect, it } from "vitest";

import { resolveViteLocalUrl, waitForUrlReady } from "./dev-server";

describe("Vite local URL", () => {
  it("uses Vite's resolved IPv4 loopback URL instead of formatted terminal output", () => {
    expect(resolveViteLocalUrl(["http://127.0.0.1:5174/"])).toBe(
      "http://127.0.0.1:5174",
    );
  });

  it("rejects a server that did not resolve a loopback URL", () => {
    expect(() => resolveViteLocalUrl([])).toThrow(
      "Vite did not expose a loopback URL",
    );
  });

  it("does not accept a network URL", () => {
    expect(() => resolveViteLocalUrl(["http://192.168.1.20:5173/"])).toThrow(
      "Vite did not expose a loopback URL",
    );
  });

  it("does not leak a parser error for a malformed dynamic URL", () => {
    expect(() => resolveViteLocalUrl(["not a URL"])).toThrow(
      "Vite did not expose a loopback URL",
    );
  });
});

describe("waitForUrlReady", () => {
  it("returns true once the route responds", async () => {
    let nowMs = 0;
    let attempts = 0;

    const ready = await waitForUrlReady("http://localhost:5173/download", 500, {
      now: () => nowMs,
      sleepImpl: async (ms) => {
        nowMs += ms;
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("server still compiling");
        }
        return new Response(null, { status: 200 });
      },
      intervalMs: 25,
    });

    expect(ready).toBe(true);
    expect(attempts).toBe(3);
  });

  it("returns false when the route never becomes reachable", async () => {
    let nowMs = 0;
    let attempts = 0;

    const ready = await waitForUrlReady("http://localhost:5173/download", 120, {
      now: () => nowMs,
      sleepImpl: async (ms) => {
        nowMs += ms;
      },
      fetchImpl: async () => {
        attempts += 1;
        throw new Error("connection refused");
      },
      intervalMs: 40,
    });

    expect(ready).toBe(false);
    expect(attempts).toBe(3);
  });
});
