import { describe, expect, it } from "vitest";

import {
  appSourceOf,
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
  window: { width: 1_200, height: 800, titleFollowsDocument: true, iconFollowsDocument: false },
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
      expect(result.value.window).toEqual({
        width: 1_200,
        height: 800,
        titleFollowsDocument: true,
        iconFollowsDocument: false,
      });
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
      expect(result.value.command?.args).toEqual(["a", "&&", "rm -rf /"]);
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

// add-create-url-apps D1/D4: url 是与 command 互斥的应用源；仅 http(s)。
describe("parseCreateConfig URL source (add-create-url-apps)", () => {
  const { command: _command, ...urlBase } = validConfig();
  const urlConfig = (url: string = "https://example.com"): Record<string, unknown> => ({
    ...urlBase,
    url,
  });

  it("accepts a url-only document and synthesizes no command defaults", () => {
    const result = parseCreateConfig(urlConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe("https://example.com");
      expect(result.value.command).toBeUndefined();
    }
  });

  it("rejects command and url together", () => {
    const result = parseCreateConfig({ ...urlConfig(), command: validConfig().command });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_config");
      expect(result.error.message).toContain("exactly one source");
    }
  });

  it("rejects neither command nor url", () => {
    const result = parseCreateConfig({ ...urlBase });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_config");
      expect(result.error.message).toContain("exactly one source");
    }
  });

  it("rejects non-http(s) URL schemes", () => {
    for (const url of ["file:///Users/me/site", "ftp://example.com", "example.com"]) {
      const result = parseCreateConfig(urlConfig(url));
      expect(result.ok, url).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_config");
      }
    }
  });

  it("serializes a url app without a command field", () => {
    const result = parseCreateConfig(urlConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(serializeCreateConfig(result.value)).not.toContain('"command"');
    }
  });

  it("appSourceOf discriminates the single source", () => {
    const urlResult = parseCreateConfig(urlConfig());
    expect(urlResult.ok && appSourceOf(urlResult.value)).toEqual({ kind: "url", url: "https://example.com" });
    const commandResult = parseCreateConfig(validConfig());
    expect(commandResult.ok && appSourceOf(commandResult.value).kind).toBe("command");
  });
});

// D12/D13：window 行为字段是持久化事实——默认可省略，显式值往返保留。
describe("parseCreateConfig window behavior options", () => {
  const { command: _c, ...urlBase } = validConfig();

  it("applies durable sync defaults for absent fields", () => {
    const result = parseCreateConfig({ ...urlBase, url: "https://example.com" });
    expect(result.ok && result.value.window.titleFollowsDocument).toBe(true);
    expect(result.ok && result.value.window.iconFollowsDocument).toBe(false);
    expect(result.ok && result.value.window.toolbar).toBeUndefined();
  });

  it("preserves explicit toolbar and sync deviations", () => {
    const result = parseCreateConfig({
      ...urlBase,
      url: "https://example.com",
      window: { width: 800, height: 600, toolbar: true, titleFollowsDocument: false, iconFollowsDocument: true },
    });
    expect(result.ok && result.value.window.toolbar).toBe(true);
    expect(result.ok && result.value.window.titleFollowsDocument).toBe(false);
    expect(result.ok && result.value.window.iconFollowsDocument).toBe(true);
  });
});
