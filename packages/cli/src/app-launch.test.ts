// Orthogonal intents (2026-07-20; original user request: empty launch config
// reuses process.argv while explicit scripts remain deterministic):
// 1. Prove automatic invocation capture.
// 2. Prove explicit cwd/path normalization and NUL rejection.

import { describe, expect, it } from "vitest";

import { normalizeAppLaunch } from "./app-launch";

describe("app launch normalization", () => {
  it("captures the runtime executable, argv after the executable, and cwd", () => {
    expect(
      normalizeAppLaunch(null, {
        execPath: "/usr/bin/node",
        argv: ["/usr/bin/node", "/tmp/app.mjs", "--dev"],
        cwd: "/tmp/project",
      }),
    ).toEqual({
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: ["/tmp/app.mjs", "--dev"],
      cwd: "/tmp/project",
    });
  });

  it("resolves path-like explicit commands and relative cwd without a shell", () => {
    expect(
      normalizeAppLaunch(
        {
          command: "./scripts/start.mjs",
          args: ["--worker", ""],
          cwd: "workspace",
        },
        { cwd: "/tmp/project" },
      ),
    ).toEqual({
      schemaVersion: 1,
      command: "/tmp/project/scripts/start.mjs",
      args: ["--worker", ""],
      cwd: "/tmp/project/workspace",
    });
  });

  it("rejects NUL-containing launch fields", () => {
    expect(() => normalizeAppLaunch({ command: "node\u0000bad" })).toThrow("without NUL");
    expect(() => normalizeAppLaunch({ command: "node", cwd: "bad\u0000cwd" })).toThrow(
      "without NUL",
    );
  });

  it("rejects whitespace-only commands", () => {
    expect(() => normalizeAppLaunch({ command: "   " })).toThrow("non-empty string");
  });
});
