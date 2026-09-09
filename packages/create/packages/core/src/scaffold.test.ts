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
  window: { width: 1200, height: 800, titleFollowsDocument: true, iconFollowsDocument: false },
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

// add-create-url-apps D2/D3：URL payload 与命令 payload 同构，但剥离全部
// 命令宿主资产——无 PTY 依赖、无 shell host、无端口监控；直接窗口。
describe("writeScaffold URL application", () => {
  const urlAppConfig = {
    schemaVersion: 1 as const,
    appId: "com.example",
    appName: "Example",
    url: "https://example.com",
    service: { port: 0 },
    window: { width: 1000, height: 700, titleFollowsDocument: true, iconFollowsDocument: false },
  };

  it("omits command-hosting assets (no PTY dependency, no shell host)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-url-test-"));
    await writeScaffold({ config: urlAppConfig, targetDir: dir, dependencyRange: "^0.18.0" });

    const files = await readdir(dir);
    expect(files).toContain("package.json");
    expect(files).toContain("opentray.app.json");
    expect(files).toContain("main.mjs");
    expect(files).not.toContain("app-shell-server.mjs");
    expect(files).not.toContain("app-shell");

    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(packageJson.dependencies.opentray).toBe("^0.18.0");
    expect(packageJson.dependencies["@lydell/node-pty"]).toBeUndefined();

    const persisted = JSON.parse(await readFile(join(dir, "opentray.app.json"), "utf8"));
    expect(persisted.url).toBe("https://example.com");
    expect(persisted.command).toBeUndefined();
  });

  it("generates an entry that opens the address directly with no supervision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-url-test-"));
    await writeScaffold({ config: urlAppConfig, targetDir: dir, dependencyRange: "^0.18.0" });
    const entry = await readFile(join(dir, "main.mjs"), "utf8");

    // D2：唯一窗口直接指向冻结 URL，窗口尺寸来自 v1 window 选项。
    expect(entry).toContain("url: toolbarUrl ?? config.url");
    expect(entry).toContain("width: config.window.width");
    expect(entry).toContain("appMode: true");
    // D13：标题单向跟随是默认；icon 跟随默认关闭（不再出现 iconSync）。
    expect(entry).toContain("titleSync: { documentToWindow: true }");
    expect(entry).not.toContain("windowToDocument");
    expect(entry).not.toContain("windowToFavicon");
    // icon 跟随是条件项（iconFollows 才注入），默认不激活。
    expect(entry).toContain("...(iconFollows ? { iconSync: { faviconToWindow: true } } : {})");
    // D11：托盘菜单提供 Reload。
    expect(entry).toContain('title: "Reload"');
    // 无命令监督：无 PTY、无命令 spawn、无端口监控、无进程树清理。
    expect(entry).not.toContain("node-pty");
    expect(entry).not.toContain("ensureServiceWindow");
    expect(entry).not.toContain("listOwnedListeningPorts");
    expect(entry).not.toContain("listProcessTreePids");
    // D12：shell host 仅在 toolbar 模式下按需加载（条件表达式），默认直连。
    expect(entry).toContain("toolbarMode && shellPort !== null");
    // D6 同法：启动失败写入 app.log。
    expect(entry).toContain("startup failed");
    expect(entry).toContain("primaryEvent");
    // README 呈现 URL 形态。
    const readme = await readFile(join(dir, "README.md"), "utf8");
    expect(readme).toContain("https://example.com");
    expect(readme).not.toContain("Command:");
  });
});

// D12：URL toolbar 模式——shell 资产回来（仍无 PTY 依赖），窗口加载包装页。
describe("writeScaffold URL application toolbar mode", () => {
  const toolbarConfig = {
    schemaVersion: 1 as const,
    appId: "com.example",
    appName: "Example",
    url: "https://example.com",
    service: { port: 0 },
    window: {
      width: 1200,
      height: 800,
      toolbar: true,
      titleFollowsDocument: true,
      iconFollowsDocument: false,
    },
  };

  it("hosts the shell server and wrapper assets without the PTY dependency", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-url-toolbar-"));
    await writeScaffold({ config: toolbarConfig, targetDir: dir, dependencyRange: "^0.18.0" });

    const files = await readdir(dir);
    expect(files).toContain("app-shell-server.mjs");
    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(packageJson.dependencies["@lydell/node-pty"]).toBeUndefined();

    const entry = await readFile(join(dir, "main.mjs"), "utf8");
    expect(entry).toContain("browse.html?url=");
    expect(entry).toContain("encodeURIComponent(config.url)");
    // toolbar 窗口不设置任何 sync 选项（wrapper 元数据非目标页面元数据）。
    expect(entry).toContain("...(toolbarUrl === null");
  });
});
