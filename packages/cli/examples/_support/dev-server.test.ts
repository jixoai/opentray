import { describe, expect, it } from "vitest";

import { waitForUrlReady } from "./dev-server";

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
