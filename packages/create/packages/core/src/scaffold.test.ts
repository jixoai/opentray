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
    // P0 (2026-09-14): a Dock-resurrected cold start yields the broker
    // session to the live owner — clean exit(0), evidence in app.log, and
    // the supervised command (started before createTray) is taken down.
    expect(entry).toContain("OPENTRAY_BROKER_SINGLE_SESSION");
    expect(entry).toContain("(yield)");
    expect(entry).toContain("command.killDirect()");
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
    expect(entry).toContain("{ url: config.url }");
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
    expect(entry).toContain("if (toolbarMode)");
    // D6 同法：启动失败写入 app.log。
    expect(entry).toContain("startup failed");
    expect(entry).toContain("primaryEvent");
    // P0 (2026-09-14)：Dock 复活的冷启动把 broker 会话让给活实例——干净
    // exit(0)，证据落 app.log（URL entry 无被监督命令，无需清理）。
    expect(entry).toContain("OPENTRAY_BROKER_SINGLE_SESSION");
    expect(entry).toContain("(yield)");
    // README 呈现 URL 形态。
    const readme = await readFile(join(dir, "README.md"), "utf8");
    expect(readme).toContain("https://example.com");
    expect(readme).not.toContain("Command:");
  });
});

// D12/D13（add-webview-orchestration）：URL toolbar 模式——shell 资产回来
// （仍无 PTY 依赖），窗口 = toolbar webview + content webview 的多 webview
// 载体（无 iframe 包装产物）。
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

  it("hosts the shell server and toolbar assets without the PTY dependency", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-url-toolbar-"));
    await writeScaffold({ config: toolbarConfig, targetDir: dir, dependencyRange: "^0.18.0" });

    const files = await readdir(dir);
    expect(files).toContain("app-shell-server.mjs");
    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(packageJson.dependencies["@lydell/node-pty"]).toBeUndefined();
    // Toolbar context-menu guard (user walkthrough finding, 2026-09-15):
    // the generated server injects the page-layer suppression only into
    // toolbar.html responses — input/textarea/contenteditable keep the
    // native menu, every other trusted-shell surface never shows the
    // engine context menu.
    const server = await readFile(join(dir, "app-shell-server.mjs"), "utf8");
    expect(server).toContain("injectToolbarGuard");
    expect(server).toContain(
      't.closest("input,textarea,[contenteditable]:not([contenteditable=\\"false\\"])")',
    );
    expect(server).toContain('target === join(SHELL_DIR, "toolbar.html")');

    const entry = await readFile(join(dir, "main.mjs"), "utf8");
    // 双 webview：toolbar（shell 资产 URL，显式 bridge 策略）+ content
    // （冻结 URL 直接加载，无 bridge 策略 = 无桥）。
    expect(entry).toContain("attachToolbarCarrier");
    expect(entry).toContain("id: \"toolbar\"");
    expect(entry).toContain("id: \"content\"");
    expect(entry).toContain("bridge: { webviewId: true, messageChannels: true }");
    expect(entry).toContain("contentUrl: config.url");
    expect(entry).toContain("/toolbar.html");
    // 声明式 column 布局：toolbar 固定 44px，content 填充。
    expect(entry).toContain("column([fixed(\"toolbar\", 44), grow(\"content\")])");
    // 通道导航接口（create 包私有 schema，D12）：指令 navigate/back/forward/
    // reload、查询 get-url、事件 url——全部 JSON over channel payload。
    expect(entry).toContain('createMessageChannel({ target: "toolbar" })');
    expect(entry).toContain('kind === "navigate"');
    expect(entry).toContain('kind === "back"');
    expect(entry).toContain('kind === "forward"');
    expect(entry).toContain('kind === "reload"');
    expect(entry).toContain('kind === "get-url"');
    expect(entry).toContain('{ kind: "url", url:');
    // 无 iframe 包装产物：不加载 browse 包装页，不再 encodeURIComponent 目标。
    expect(entry).not.toContain("browse.html");
    expect(entry).not.toContain("encodeURIComponent");
    expect(entry).not.toContain("<iframe");
    // windowOnly 会话：窗口本身不携带 url。
    expect(entry).toContain("windowOnly: true");
    // 托盘 Reload → content 原生重载（navigate 当前 URL，不再 evaluate 于包装层）。
    expect(entry).toContain("await content.getUrl()");
    expect(entry).toContain("await content.navigate(url)");
    // titleSync 投影到 content 真文档（entry 侧 onTitleChange → 原生 re-show
    // 标题更新；v1 冻结面没有 host set-title 命令）。
    expect(entry).toContain("onTitleChange");
    expect(entry).toContain("shell.show({ title, windowOnly: true })");
    // shell server 的 toolbar 导航面没有导航 HTTP 端点（D12：静态 + 终端监督端点）。
    const shell = await readFile(join(dir, "app-shell-server.mjs"), "utf8");
    expect(shell).not.toContain("/api/navigate");
    expect(shell).not.toContain("/api/back");
    expect(shell).not.toContain("/api/forward");
    expect(shell).not.toContain("/api/reload");
  });
});

// D13（add-webview-orchestration R2-B12）：命令应用获得同等的 toolbar 生成
// 契约——window.toolbar 组合同一 toolbar 载体于服务窗，行为闭环与 URL 模式
// 平价；旧 showAddressBar 字段退役，无 iframe browse 产物。
describe("writeScaffold command application toolbar mode", () => {
  const commandToolbarConfig = {
    schemaVersion: 1 as const,
    appId: "cmd.example",
    appName: "Cmd Example",
    command: { command: "/usr/local/bin/serve", args: ["start"], cwd: "/tmp/xyz" },
    service: { port: 0 },
    window: {
      width: 1200,
      height: 800,
      toolbar: true,
      titleFollowsDocument: true,
      iconFollowsDocument: false,
    },
    shell: { showTerminal: false },
  };

  it("composes the same native carrier over the service window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-cmd-toolbar-"));
    await writeScaffold({ config: commandToolbarConfig, targetDir: dir, dependencyRange: "^0.18.0" });
    const entry = await readFile(join(dir, "main.mjs"), "utf8");

    // 服务窗 = 同一载体：toolbar webview + content webview + column 布局 + 通道。
    expect(entry).toContain("attachToolbarCarrier");
    expect(entry).toContain("toolbarMode && shellPort !== null");
    expect(entry).toContain('toolbarUrl: `http://127.0.0.1:${shellPort}/toolbar.html`');
    expect(entry).toContain("contentUrl: direct");
    expect(entry).toContain("column([fixed(\"toolbar\", 44), grow(\"content\")])");
    expect(entry).toContain('createMessageChannel({ target: "toolbar" })');
    // 命令监督法不变：PTY / 端口嗅探 / 进程树清理原样保留。
    expect(entry).toContain('await import("@lydell/node-pty")');
    expect(entry).toContain("ensureServiceWindow");
    expect(entry).toContain("listProcessTreePids");
    // 无 iframe browse 产物；旧 showAddressBar 分支已删除。
    expect(entry).not.toContain("browse.html");
    expect(entry).not.toContain("showAddressBar");
    expect(entry).not.toContain("<iframe");
  });
});
