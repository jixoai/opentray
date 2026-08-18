import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isDirectoryOccupied, detectPackageManager } from "./materialize";
import { writeScaffold } from "./scaffold";

const config = {
  schemaVersion: 1 as const,
  appId: "start.somecommand.npx",
  appName: "Somecommand Start",
  command: { command: "/usr/local/bin/somecommand", args: ["start"], cwd: "/tmp/xyz" },
  service: { port: 19080 },
  window: { width: 1200, height: 800 },
};

describe("writeScaffold", () => {
  it("writes the full project shape with frozen identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-test-"));
    const result = await writeScaffold({
      config,
      targetDir: dir,
      dependencyRange: "^0.18.0",
    });

    const files = await readdir(dir);
    expect(files).toEqual(
      expect.arrayContaining([
        "package.json",
        "opentray.app.json",
        "main.mjs",
        // D2: shell host is unconditional (terminal = abnormal-exit surface).
        "app-shell-server.mjs",
        "README.md",
        ".gitignore",
        "app-icon",
      ]),
    );
    expect(result.entryPath.endsWith("main.mjs")).toBe(true);

    const persisted = JSON.parse(await readFile(result.configPath, "utf8"));
    expect(persisted).toEqual(config);

    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(packageJson.name).toBe("start-somecommand-npx");
    expect(packageJson.dependencies.opentray).toBe("^0.18.0");
    expect(packageJson.dependencies["@opentray/ext-webview"]).toBe("^0.18.0");
    // D4: the PTY dependency is unconditional (preview-parity TTY).
    expect(packageJson.dependencies["@lydell/node-pty"]).toBe("^1.1.0");
  });

  it("generates an entry that supervises the command and opens an appMode window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-test-"));
    await writeScaffold({ config, targetDir: dir, dependencyRange: "^0.18.0" });
    const entry = await readFile(join(dir, "main.mjs"), "utf8");

    expect(entry).toContain('from "opentray"');
    expect(entry).toContain('from "@opentray/ext-webview"');
    expect(entry).toContain("appMode: true");
    // 服务窗口只由持续 monitor 驱动（一端口一窗）：没有阻塞启动门，也没有
    // ready marker（首启验证已随 D1 移除）。
    expect(entry).toContain("ensureServiceWindow(service.port)");
    expect(entry).not.toContain("sniffServicePort");
    expect(entry).not.toContain("waitForServicePort");
    expect(entry).not.toContain("opentray: ready");
    // D4: 命令恒走 PTY，加载失败降级 pipes 并记录降级。
    expect(entry).toContain('await import("@lydell/node-pty")');
    expect(entry).toContain("degraded to pipes");
    // D2: 异常退出（非零/信号码，或先于任何已验证服务退出）强制弹终端窗。
    expect(entry).toContain("sawVerifiedService");
    expect(entry).toContain("revealTerminalWindow");
    // D3: 无时间上限的自适应嗅探：≈1s 活跃，≤5s 安静/高负载。
    expect(entry).toContain("FAST_INTERVAL_MS = 1000");
    expect(entry).toContain("SLOW_INTERVAL_MS = 5000");
    expect(entry).toContain("loadavg()");
    // D5: 退出时整树清理（POSIX 组杀 + PPid sweep；Windows taskkill /T）。
    expect(entry).toContain("listProcessTreePids(command.pid)");
    expect(entry).toContain("taskkill");
    // D6: 顶层错误边界把启动失败连同堆栈写入 app.log。
    expect(entry).toContain("startup failed");
    expect(entry).toContain("primaryEvent");
    // The persisted launch vector must be shell-free and absolute.
    expect(entry).toContain("command: nodeRuntime()");
    expect(entry).toContain("start.somecommand.npx");
    expect(entry).toContain("Somecommand Start");
    expect(entry).toContain('app-icon", "app-icon.json');
  });
});

describe("isDirectoryOccupied", () => {
  it("treats missing and ignorable-only directories as empty", async () => {
    const base = await mkdtemp(join(tmpdir(), "occupied-test-"));
    expect(await isDirectoryOccupied(join(base, "does-not-exist"))).toBe(false);

    const ignorable = join(base, "ignorable");
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(ignorable);
    await writeFile(join(ignorable, ".DS_Store"), "");
    expect(await isDirectoryOccupied(ignorable)).toBe(false);
  });

  it("detects foreign files", async () => {
    const base = await mkdtemp(join(tmpdir(), "occupied-test-"));
    const occupied = join(base, "occupied");
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(occupied);
    await writeFile(join(occupied, "keep.txt"), "data");
    expect(await isDirectoryOccupied(occupied)).toBe(true);
  });
});

describe("detectPackageManager", () => {
  it("prefers lockfiles", () => {
    expect(detectPackageManager(["pnpm-lock.yaml"], undefined)).toBe("pnpm");
    expect(detectPackageManager(["bun.lockb"], undefined)).toBe("bun");
    expect(detectPackageManager(["package-lock.json"], undefined)).toBe("npm");
  });

  it("falls back to the user agent", () => {
    expect(detectPackageManager([], "pnpm/10 npm/? node/v20")).toBe("pnpm");
    expect(detectPackageManager([], "bun/1.3")).toBe("bun");
    expect(detectPackageManager([], undefined)).toBe("npm");
  });
});
