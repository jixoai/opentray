// Orthogonal intents (2026-07-21; original user request: reopen the most
// recently active retained app-mode window from a live Dock entry):
// 1. Prove app-mode and bootstrap eligibility.
// 2. Prove MRU reveal-before-focus ordering.
// 3. Prove duplicate intents coalesce and stale candidates fall through.

import { describe, expect, it } from "vitest";

import { getAppReopenCoordinator } from "./app-reopen";

describe("app-mode WebView reopen coordinator", () => {
  it("ignores utility and unbootstrapped windows", async () => {
    const coordinator = getAppReopenCoordinator("test-empty-app");
    const registration = coordinator.register({
      async toVisible() {},
      async focus() {},
    });
    registration.setAppMode(true);

    await expect(coordinator.reopen()).resolves.toBe(false);
  });

  it("reveals then focuses the most recently active app-mode window", async () => {
    const calls: string[] = [];
    const coordinator = getAppReopenCoordinator("test-mru-app");
    const first = coordinator.register({
      async toVisible() {
        calls.push("first:visible");
      },
      async focus() {
        calls.push("first:focus");
      },
    });
    const second = coordinator.register({
      async toVisible() {
        calls.push("second:visible");
      },
      async focus() {
        calls.push("second:focus");
      },
    });
    for (const registration of [first, second]) {
      registration.setAppMode(true);
      registration.setBootstrapped(true);
    }
    second.markActive();
    first.markActive();

    await expect(coordinator.reopen()).resolves.toBe(true);
    expect(calls).toEqual(["first:visible", "first:focus"]);
  });

  it("coalesces duplicate intents and falls through a stale MRU target", async () => {
    const calls: string[] = [];
    const coordinator = getAppReopenCoordinator("test-fallback-app");
    const fallback = coordinator.register({
      async toVisible() {
        calls.push("fallback:visible");
      },
      async focus() {
        calls.push("fallback:focus");
      },
    });
    const stale = coordinator.register({
      async toVisible() {
        calls.push("stale:visible");
        throw new Error("stale window");
      },
      async focus() {
        calls.push("stale:focus");
      },
    });
    for (const registration of [fallback, stale]) {
      registration.setAppMode(true);
      registration.setBootstrapped(true);
      registration.markActive();
    }

    const first = coordinator.reopen();
    const duplicate = coordinator.reopen();
    expect(duplicate).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(calls).toEqual([
      "stale:visible",
      "fallback:visible",
      "fallback:focus",
    ]);
  });
});

