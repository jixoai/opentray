import { describe, expect, it } from "vitest";
import { isAbsolute } from "node:path";

import { parseShebangInterpreter, resolveLaunchVector } from "./launch-vector";

const noOpAccess = async (): Promise<void> => {};

describe("parseShebangInterpreter", () => {
  it("reads env interpreters", () => {
    expect(parseShebangInterpreter("#!/usr/bin/env node")).toEqual({
      interpreter: "/usr/bin/env",
      args: ["node"],
    });
  });

  it("reads direct interpreters", () => {
    expect(parseShebangInterpreter("#!/bin/sh")).toEqual({
      interpreter: "/bin/sh",
      args: [],
    });
  });

  it("returns undefined without a shebang", () => {
    expect(parseShebangInterpreter("const x = 1;")).toBeUndefined();
    expect(parseShebangInterpreter(undefined)).toBeUndefined();
  });
});

describe("resolveLaunchVector", () => {
  it("absolute-izes a bare command through PATH", async () => {
    const vector = await resolveLaunchVector({
      tokens: ["somecommand", "start"],
      cwd: "/tmp/project",
      pathEnv: "/usr/local/bin:/opt/bin",
      accessFile: async (path) => {
        if (path === "/usr/local/bin/somecommand") return;
        throw new Error("missing");
      },
      firstLine: async () => undefined,
    });
    expect(vector.command).toBe("/usr/local/bin/somecommand");
    expect(vector.args).toEqual(["start"]);
    expect(vector.cwd).toBe("/tmp/project");
  });

  it("unwraps a node shebang script onto an absolute interpreter", async () => {
    const vector = await resolveLaunchVector({
      tokens: ["./cli.mjs", "--watch"],
      cwd: "/tmp/project",
      accessFile: noOpAccess,
      firstLine: async () => "#!/usr/bin/env node",
    });
    // PATH-independence: the interpreter resolves to its absolute path.
    expect(vector.command.endsWith("node")).toBe(true);
    expect(isAbsolute(vector.command)).toBe(true);
    expect(vector.args).toEqual(["/tmp/project/cli.mjs", "--watch"]);
  });

  it("keeps executable paths without shebangs", async () => {
    const vector = await resolveLaunchVector({
      tokens: ["/opt/server/bin/run", "--port", "8080"],
      cwd: "/tmp/project",
      accessFile: noOpAccess,
      firstLine: async () => undefined,
    });
    expect(vector).toEqual({
      command: "/opt/server/bin/run",
      args: ["--port", "8080"],
      cwd: "/tmp/project",
    });
  });

  it("routes Windows .cmd shims through cmd.exe without a shell string", async () => {
    const vector = await resolveLaunchVector({
      tokens: ["C:\\tools\\server.cmd", "start"],
      cwd: "C:\\project",
      platform: "win32",
      accessFile: noOpAccess,
      firstLine: async () => undefined,
    });
    expect(vector.command.endsWith("cmd.exe")).toBe(true);
    expect(vector.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(vector.args).toContain("C:\\tools\\server.cmd");
  });

  it("resolves env targets through PATH when the script uses env", async () => {
    const vector = await resolveLaunchVector({
      tokens: ["./run.sh"],
      cwd: "/tmp/project",
      pathEnv: "/usr/bin",
      accessFile: async (path) => {
        if (path === "/usr/bin/bun") return;
        throw new Error("missing");
      },
      firstLine: async () => "#!/usr/bin/env bun",
    });
    expect(vector.command).toBe("/usr/bin/bun");
    expect(vector.args[0]).toBe("/tmp/project/run.sh");
  });

  it("rejects an empty command", async () => {
    await expect(
      resolveLaunchVector({
        tokens: [],
        cwd: "/tmp/project",
        accessFile: noOpAccess,
        firstLine: async () => undefined,
      }),
    ).rejects.toThrow("launch vector requires a command");
  });
});
