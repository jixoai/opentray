import { describe, expect, it } from "vitest";

import {
  deriveDefaultAppId,
  deriveDefaultAppName,
  isValidAppId,
  toProjectDirectoryName,
} from "./app-id";
import { tokenizeCommandLine } from "./tokenize";

describe("deriveDefaultAppId", () => {
  it("derives the user's example exactly", () => {
    const tokens = tokenizeCommandLine("npx somecommand start --xx");
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(deriveDefaultAppId(tokens.tokens)).toBe("start.somecommand.npx");
  });

  it("stops at the first option-like token", () => {
    expect(deriveDefaultAppId(["npx", "tool", "-p", "3000", "start"])).toBe("tool.npx");
  });

  it("reverses and dot-joins all pre-option tokens", () => {
    expect(deriveDefaultAppId(["bun", "run", "dev"])).toBe("dev.run.bun");
  });

  it("falls back when only options are present", () => {
    expect(deriveDefaultAppId(["--help"])).toBe("app.opentray");
  });

  it("strips path segments from tokens", () => {
    expect(deriveDefaultAppId(["./bin/server.js", "start"])).toBe("start.server.js");
  });

  it("derives scoped package commands the way the user reads them", () => {
    // 用户规则：`npx @deepseek-ai/dsh@latest web` → 拆分后 `@scope` 段丢弃、
    // `name@version` 只保留 name → ['npx','dsh','web'] → 反转点接。
    const tokens = tokenizeCommandLine("npx @deepseek-ai/dsh@latest web");
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(deriveDefaultAppId(tokens.tokens)).toBe("web.dsh.npx");
  });

  it("drops a bare @scope segment and version pins", () => {
    expect(deriveDefaultAppId(["pnpm", "@deepseek-ai", "dsh@1.2.0", "web"])).toBe("web.dsh.pnpm");
  });

  it("keeps the last segment for absolute paths", () => {
    expect(deriveDefaultAppId(["/usr/local/bin/node", "server.js"])).toBe("server.js.node");
  });
});

describe("deriveDefaultAppName", () => {
  it("title-cases the appId segments", () => {
    expect(deriveDefaultAppName(["npx", "somecommand", "start", "--xx"])).toBe(
      "Start Somecommand Npx",
    );
  });
});

describe("toProjectDirectoryName", () => {
  it("normalizes dots to dashes", () => {
    expect(toProjectDirectoryName("start.somecommand.npx")).toBe("start-somecommand-npx");
  });

  it("keeps a fallback for empty input", () => {
    expect(toProjectDirectoryName("...")).toBe("opentray-app");
  });
});

describe("isValidAppId", () => {
  it("accepts the derived shape", () => {
    expect(isValidAppId("start.somecommand.npx")).toBe(true);
  });

  it("rejects single segments and empty values", () => {
    expect(isValidAppId("somecommand")).toBe(false);
    expect(isValidAppId("")).toBe(false);
  });
});
