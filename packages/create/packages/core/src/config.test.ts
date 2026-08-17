import { describe, expect, it } from "vitest";

import {
  isContainedPath,
  parseCreateConfig,
  serializeCreateConfig,
  type CreateConfigV1,
} from "./config";

const validConfig = (overrides: Partial<CreateConfigV1> = {}): CreateConfigV1 => ({
  schemaVersion: 1,
  appId: "app.example",
  appName: "Example",
  command: {
    executable: "/usr/bin/node",
    args: ["server.js", "--port", "3000"],
    cwd: "/Users/me/project",
  },
  packageManager: "npm",
  icons: {
    imageSmoothingEnabled: true,
    background: "transparent",
    scale: 0.8,
  },
  window: { width: 1_200, height: 800 },
  developerMode: false,
  ...overrides,
});

describe("parseCreateConfig", () => {
  it("accepts a minimal valid v1 document and applies defaults", () => {
    const result = parseCreateConfig(validConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.icons.imageSmoothingEnabled).toBe(true);
      expect(result.value.icons.background).toBe("transparent");
      expect(result.value.icons.scale).toBe(0.8);
      expect(result.value.developerMode).toBe(false);
      expect(result.value.window).toEqual({ width: 1_200, height: 800 });
    }
  });

  it("rejects a newer schema version as incompatible read-only evidence", () => {
    const result = parseCreateConfig(validConfig({ schemaVersion: 2 as unknown as 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("incompatible_version");
    }
  });

  it("rejects an invalid appId before mutation", () => {
    const result = parseCreateConfig(validConfig({ appId: "not a dotted id" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_config");
      expect(result.error.message).toContain("appId");
    }
  });

  it("rejects metacharacter-bearing env keys/values that are malformed", () => {
    const result = parseCreateConfig(
      validConfig({
        command: {
          executable: "node",
          args: [],
          cwd: "/x",
          env: { "": "v" },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("keeps && as a literal argument (no shell semantics)", () => {
    const result = parseCreateConfig(
      validConfig({ command: { executable: "echo", args: ["a", "&&", "rm -rf /"], cwd: "/x" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.command.args).toEqual(["a", "&&", "rm -rf /"]);
    }
  });

  it("rejects absolute or escaping resource paths", () => {
    const base = validConfig();
    for (const path of ["/etc/passwd", "../outside.png", "a/../../b.png"]) {
      const result = parseCreateConfig({
        ...base,
        icons: {
          ...base.icons,
          appIcon: { path, format: "png", sha256: "a".repeat(64), source: { kind: "file", ref: path } },
        },
      });
      expect(result.ok, path).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(
          /resource path must be relative|resource path must not escape|resource path escapes/,
        );
      }
    }
  });

  it("round-trips through serialize", () => {
    const config = validConfig();
    const result = parseCreateConfig(JSON.parse(serializeCreateConfig(config)));
    expect(result).toEqual({ ok: true, value: config });
  });

  it("defaults imageSmoothingEnabled to true and validates it as boolean", () => {
    const bad = validConfig();
    (bad.icons as { imageSmoothingEnabled?: unknown }).imageSmoothingEnabled = "no";
    expect(parseCreateConfig(bad).ok).toBe(false);
  });
});

describe("isContainedPath", () => {
  it("accepts nested children and rejects siblings/escapes/self", () => {
    expect(isContainedPath("/r/app", "/r/app/x.png")).toBe(true);
    expect(isContainedPath("/r/app", "/r/app/sub/x")).toBe(true);
    expect(isContainedPath("/r/app", "/r/application")).toBe(false);
    expect(isContainedPath("/r/app", "/r/app")).toBe(false);
    expect(isContainedPath("/r/app", "/r/../etc")).toBe(false);
  });
});
