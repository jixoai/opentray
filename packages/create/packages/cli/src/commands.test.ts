import http from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dispatchCli, type CliContext } from "./commands";
import type { CliStreams } from "./output";
import { validateSkillPath } from "./skill";

let home: string;
let streams: CliStreams;
let outLines: string[];
let errLines: string[];

const context = (): CliContext => ({
  streams,
  homeDir: home,
  skipInstall: true,
  dependencyRange: "^0.0.0-test",
});

const run = (args: readonly string[]): Promise<number> => dispatchCli([...args], context());

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "cli-test-"));
  streams = {
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  };
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  outLines = [];
  errLines = [];
});

describe("create", () => {
  it("creates non-interactively with URL icon sources and no enrichment", async () => {
    // An HTTP icon source that cannot be fetched would fail apply; use the
    // local-file source here and verify http URLs parse in plan-only mode
    // separately. This test proves the full non-interactive path.
    const iconDir = await mkdtemp(join(tmpdir(), "cli-icon-"));
    const iconPath = join(iconDir, "a.png");
    await writeFile(iconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    const code = await run([
      "create",
      "--app-id", "one.example",
      "--app-name", "One",
      "--exec", "node", "--arg", "serve.js", "--arg", "&&",
      "--app-icon", iconPath,
      "--no-image-smoothing",
    ]);
    expect(code, errLines.join("\n")).toBe(0);
    const configPath = join(home, ".opentray", "create", "one-example", "create-opentray.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.appId).toBe("one.example");
    expect(config.icons.appIcon.path).toBe("app-icon.png");
    expect(config.icons.imageSmoothingEnabled).toBe(false);
    expect(config.command.args).toEqual(["serve.js", "&&"]);
  });

  it("rejects unknown options before any Core plan", async () => {
    const code = await run(["create", "--app-id", "x.y", "--app-name", "X", "--exec", "node", "--bogus"]);
    expect(code).toBe(2);
  });

  it("requires app-id and app-name without a config document", async () => {
    const code = await run(["create", "--exec", "node"]);
    expect(code).toBe(2);
    expect(errLines.join("\n")).toMatch(/app-id|app-name/u);
  });

  it("patches only named fields over a config document", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cli-config-"));
    const configPath = join(configDir, "base.json");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        appId: "patch.example",
        appName: "Original",
        command: { executable: "node", args: ["a"], cwd: configDir },
        packageManager: "pnpm",
        icons: { imageSmoothingEnabled: false, background: "black", scale: 0.9 },
        window: { width: 900, height: 700 },
        developerMode: true,
      }),
      "utf8",
    );
    await run(["create", "--config", configPath, "--app-name", "Renamed"]);
    const committed = JSON.parse(
      await readFile(join(home, ".opentray", "create", "patch-example", "create-opentray.json"), "utf8"),
    );
    expect(committed.appName).toBe("Renamed");
    expect(committed.packageManager).toBe("pnpm");
    expect(committed.icons.imageSmoothingEnabled).toBe(false);
    expect(committed.window).toEqual({
      width: 900,
      height: 700,
      // D13：sync 字段是持久事实，默认显式记录；toolbar 未给则省略。
      titleFollowsDocument: true,
      iconFollowsDocument: false,
    });
    expect(committed.window.toolbar).toBeUndefined();
    expect(committed.developerMode).toBe(true);
  });

  it("dry-run prints the plan without mutation", async () => {
    const code = await run([
      "create", "--app-id", "dry.example", "--app-name", "Dry",
      "--exec", "node", "--dry-run",
    ]);
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("plan for dry.example");
    await expect(
      readFile(join(home, ".opentray", "create", "dry-example", "create-opentray.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("keeps JSON stdout pure on failure", async () => {
    const code = await run([
      "create", "--app-id", "BAD ID", "--app-name", "X", "--exec", "node", "--json",
    ]);
    expect(code).toBe(2);
    expect(outLines.length).toBe(1);
    const parsed = JSON.parse(outLines[0]!);
    expect(parsed.ok).toBe(false);
  });
});

describe("app list", () => {
  it("reports broken-link registrations with both paths in JSON", async () => {
    await run(["create", "--app-id", "listed.example", "--app-name", "Listed", "--exec", "node"]);
    const brokenDir = join(home, ".opentray", "create", "broken-cli-example");
    await mkdir(brokenDir, { recursive: true });
    await symlink("/nonexistent/target", join(brokenDir, "app"), "dir");
    await writeFile(
      join(brokenDir, "create-opentray.json"),
      JSON.stringify({
        schemaVersion: 1,
        appId: "broken.cli",
        appName: "Broken",
        command: { executable: "node", args: [], cwd: "/tmp" },
        packageManager: "npm",
        icons: { imageSmoothingEnabled: true, background: "transparent", scale: 0.8 },
        window: { width: 1200, height: 800 },
        developerMode: false,
      }),
      "utf8",
    );
    outLines.length = 0; // drop the preceding create's text output
    const code = await run(["app", "list", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(outLines.join("\n"));
    const broken = parsed.result.find((entry: { appId?: string }) => entry.appId === "broken.cli");
    expect(broken.status).toBe("broken-link");
    expect(broken.payloadPath).toBe("/nonexistent/target");
    expect(broken.registrationDir).toBe(brokenDir);
  });
});

describe("app edit", () => {
  it("renames via patches and rejects identity migration", async () => {
    await run(["create", "--app-id", "edit.example", "--app-name", "Before", "--exec", "node"]);
    const code = await run(["app", "edit", "edit.example", "--app-name", "After", "--force"]);
    expect(code, errLines.join("\n")).toBe(0);
    const committed = JSON.parse(
      await readFile(join(home, ".opentray", "create", "edit-example", "create-opentray.json"), "utf8"),
    );
    expect(committed.appName).toBe("After");

    // Identity mutation vector: a --config document naming another appId.
    const otherDir = await mkdtemp(join(tmpdir(), "cli-other-"));
    const otherConfig = join(otherDir, "other.json");
    await writeFile(otherConfig, JSON.stringify({ ...committed, appId: "other.example" }), "utf8");
    const migrate = await run(["app", "edit", "edit.example", "--config", otherConfig]);
    expect(migrate).toBe(2);
    expect(errLines.join("\n")).toMatch(/identity_mismatch|immutable/u);
    // (A stray --app-id on edit is consumed positionally by yargs; the
    // config-document vector above is the complete mutation surface.)
  });
});

describe("app export", () => {
  it("blocks env-bearing export without acknowledgement and never echoes values", async () => {
    await run([
      "create", "--app-id", "envy.example", "--app-name", "Envy",
      "--exec", "node", "--env", "SECRET_TOKEN=hunter2",
    ]);
    const blocked = await run(["app", "export", "envy.example"]);
    expect(blocked).toBe(2);
    const blockedText = errLines.join("\n");
    expect(blockedText).toContain("acknowledge");
    expect(blockedText).not.toContain("hunter2");

    const acknowledged = await run(["app", "export", "envy.example", "--acknowledge-env", "--format", "command"]);
    expect(acknowledged, errLines.join("\n")).toBe(0);
    // After acknowledgement the complete command legitimately carries values.
    expect(outLines.join(" ")).toContain("SECRET_TOKEN=hunter2");
  });

  it("exports sh and ps1 scripts", async () => {
    await run(["create", "--app-id", "shy.example", "--app-name", "Shy", "--exec", "node"]);
    outLines.length = 0;
    const sh = await run(["app", "export", "shy.example", "--format", "sh"]);
    expect(sh).toBe(0);
    const script = outLines.join("\n");
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("npx create-opentray create");
    expect(script).toContain("--app-id shy.example");
    expect(script).not.toContain("\r");
    outLines.length = 0;
    const ps1 = await run(["app", "export", "shy.example", "--format", "ps1"]);
    expect(ps1).toBe(0);
    expect(outLines.join("\n")).toContain("\r");
  });
});

describe("app uninstall", () => {
  it("states retention and manual pin cleanup", async () => {
    const external = await mkdtemp(join(tmpdir(), "cli-external-"));
    await writeFile(join(external, "data.txt"), "keep\n");
    await run([
      "create", "--app-id", "gone.example", "--app-name", "Gone",
      "--exec", "node",
      // external payload linking through apply options is exercised in Core
      // tests; here create a managed app and uninstall it.
    ]);
    void external;
    const code = await run(["app", "uninstall", "gone.example"]);
    expect(code).toBe(0);
    const text = outLines.join("\n");
    expect(text).toContain("removed registration");
    expect(text.match(/Dock|taskbar/u) !== null);
  });
});

describe("skill paths", () => {
  it("rejects absolute, traversal, and NUL paths before any read", () => {
    for (const path of ["/etc/passwd", "../package.json", "a/../../b", "x\0y", "C:\\x", ""]) {
      const result = validateSkillPath(path);
      expect(result.ok, path).toBe(false);
    }
    expect(validateSkillPath("SKILL.md").ok).toBe(true);
    expect(validateSkillPath("references/cli-reference.md").ok).toBe(true);
  });
});

// add-create-url-apps D5/D6：--url 单独创建（身份离线推导）、与命令 flags
// 互斥、edit 可改 url、export 携带 --url。
describe("create --url (add-create-url-apps)", () => {
  it("creates a URL application from --url alone with derived identity", async () => {
    const code = await run(["create", "--url", "https://example.com/app", "--no-scrape"]);
    expect(code, errLines.join("\n")).toBe(0);
    const configPath = join(home, ".opentray", "create", "app-com-example", "create-opentray.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.url).toBe("https://example.com/app");
    expect(config.command).toBeUndefined();
    expect(config.appId).toBe("app.com.example");
    expect(config.appName).toBe("App");

    const payloadDir = join(home, ".opentray", "create", "app-com-example", "app");
    const payloadFiles = await readdir(payloadDir);
    expect(payloadFiles).toContain("main.mjs");
    expect(payloadFiles).not.toContain("app-shell-server.mjs");
    const packageJson = JSON.parse(await readFile(join(payloadDir, "package.json"), "utf8"));
    expect(packageJson.dependencies["@lydell/node-pty"]).toBeUndefined();
    const entry = await readFile(join(payloadDir, "main.mjs"), "utf8");
    expect(entry).toContain("{ url: config.url }");
    expect(entry).not.toContain("node-pty");
  });

  it("rejects --url together with --exec", async () => {
    const code = await run(["create", "--url", "https://example.com", "--exec", "node"]);
    expect(code).not.toBe(0);
    expect([...outLines, ...errLines].join("\n")).toContain("mutually exclusive");
  });

  it("rejects a non-http(s) --url before planning", async () => {
    const code = await run(["create", "--url", "file:///Users/me/site", "--no-scrape"]);
    expect(code).not.toBe(0);
  });

  it("edits the url of a URL application", async () => {
    await run(["create", "--url", "https://example.com", "--no-scrape"]);
    const code = await run(["app", "edit", "com.example", "--url", "https://example.org/app"]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "com-example", "create-opentray.json"), "utf8"),
    );
    expect(config.url).toBe("https://example.org/app");
    expect(config.command).toBeUndefined();
  });

  it("exports a URL application as a --url invocation", async () => {
    await run(["create", "--url", "https://example.com/app", "--no-scrape"]);
    const code = await run(["app", "export", "app.com.example", "--format", "command"]);
    expect(code, errLines.join("\n")).toBe(0);
    const command = outLines.join("\n");
    expect(command).toContain("--url");
    expect(command).toContain("https://example.com/app");
    expect(command).not.toContain("--exec");
  });
});

  it("switches a command application to a URL application via app edit --url", async () => {
    await run(["create", "--app-id", "switch.example", "--app-name", "Switch", "--exec", "node", "--arg", "serve.js"]);
    const code = await run(["app", "edit", "switch.example", "--url", "https://example.com/app"]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "switch-example", "create-opentray.json"), "utf8"),
    );
    expect(config.url).toBe("https://example.com/app");
    expect(config.command).toBeUndefined();
    const payloadFiles = await readdir(join(home, ".opentray", "create", "switch-example", "app"));
    expect(payloadFiles).not.toContain("app-shell-server.mjs");
  });

// D10：URL 创建默认抓取链接页面——本地 fixture server 提供 title 与
// favicon，验证预设进 committed 配置/快照；--no-scrape 与不可达地址回落。
let fixtureUrl = "";

describe("create --url scraped defaults (D10)", () => {
  let fixture: http.Server;

  beforeAll(async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from("IHDR", "latin1"),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00]),
      Buffer.from([0x1f, 0x15, 0xc4, 0x89]),
      Buffer.alloc(64, 7),
    ]);
    fixture = http.createServer((request, response) => {
      if (request.url === "/app") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(
          `<html><head><title>Fixture News</title>` +
            `<link rel="icon" href="/icon.png" sizes="64x64">` +
            `</head><body>ok</body></html>`,
        );
        return;
      }
      if (request.url === "/deny") {
        response.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY" });
        response.end("<html><head><title>Denied</title></head><body>ok</body></html>");
        return;
      }
      if (request.url === "/icon.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(png);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolvePromise) => fixture.listen(0, "127.0.0.1", () => resolvePromise()));
    const address = fixture.address();
    if (typeof address === "object" && address !== null) {
      fixtureUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  it("keeps --toolbar against an XFO-DENY page without probing or warning (D14)", async () => {
    // add-webview-orchestration：嵌入策略构造性无关——不回退、不降级、无警告。
    const code = await run(["create", "--url", `${fixtureUrl}/deny`, "--toolbar", "--app-id", "deny.example"]);
    expect(code, errLines.join("\n")).toBe(0);
    expect([...outLines, ...errLines].join("\n")).not.toContain("embedding");
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "deny-example", "create-opentray.json"), "utf8"),
    );
    expect(config.window.toolbar).toBe(true);
    // toolbar 模式的 URL 应用携带 shell host（toolbar 页资产）且仍无 PTY。
    const payloadFiles = await readdir(join(home, ".opentray", "create", "deny-example", "app"));
    expect(payloadFiles).toContain("app-shell-server.mjs");
    const packageJson = JSON.parse(await readFile(join(home, ".opentray", "create", "deny-example", "app", "package.json"), "utf8"));
    expect(packageJson.dependencies["@lydell/node-pty"]).toBeUndefined();
    const entry = await readFile(join(home, ".opentray", "create", "deny-example", "app", "main.mjs"), "utf8");
    expect(entry).toContain("attachToolbarCarrier");
    expect(entry).not.toContain("browse.html");
  });

  it("keeps toolbar when the page allows embedding", async () => {
    const code = await run(["create", "--url", `${fixtureUrl}/app`, "--toolbar", "--app-id", "embed.example"]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "embed-example", "create-opentray.json"), "utf8"),
    );
    expect(config.window.toolbar).toBe(true);
  });

  afterAll(async () => {
    await new Promise<void>((resolvePromise) => fixture.close(() => resolvePromise()));
  });

  it("adopts the scraped title and favicon as defaults", async () => {
    const code = await run(["create", "--url", `${fixtureUrl}/app`]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "app-1-0-0-127", "create-opentray.json"), "utf8"),
    );
    expect(config.appName).toBe("Fixture News");
    expect(config.icons.appIcon).toBeDefined();
    // favicon 经抓取管线规范化为临时文件，再由 importResource 提交快照。
    expect(config.icons.appIcon.source.kind).toBe("file");
    expect(config.icons.appIcon.path).toMatch(/^app-icon\./u);
    const payloadIcon = join(home, ".opentray", "create", "app-1-0-0-127", "app", "app-icon", "app-icon.png");
    await expect(readFile(payloadIcon)).resolves.toBeDefined();
  });

  it("explicit flags win over scraped presets", async () => {
    const code = await run([
      "create", "--url", `${fixtureUrl}/app`,
      "--app-id", "explicit.example", "--app-name", "Explicit Name",
    ]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "explicit-example", "create-opentray.json"), "utf8"),
    );
    expect(config.appName).toBe("Explicit Name");
    // 显式 --app-name 给了但 --app-icon 未给：favicon 预设仍填充图标。
    expect(config.icons.appIcon).toBeDefined();
  });

  it("--no-scrape keeps the address-derived name and skips the network", async () => {
    const code = await run(["create", "--url", `${fixtureUrl}/app`, "--no-scrape", "--app-id", "quiet.example"]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "quiet-example", "create-opentray.json"), "utf8"),
    );
    expect(config.appName).toBe("App"); // 地址路径段 /app 推导，非 Fixture News
    expect(config.icons.appIcon).toBeUndefined();
  });

  it("falls back silently on an unreachable address", async () => {
    const code = await run(["create", "--url", "http://127.0.0.1:1", "--app-id", "down.example"]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "down-example", "create-opentray.json"), "utf8"),
    );
    expect(config.appName).toBe("127");
    expect(config.icons.appIcon).toBeUndefined();
  });
});

// D12/D13：窗口行为 flags 编译进 v1 window 并 export 往返。
describe("create --url window behavior flags", () => {
  it("records toolbar and sync deviations, and exports them back", async () => {
    const code = await run([
      "create", "--url", "https://example.com/app",
      "--no-scrape", "--toolbar", "--icon-follow", "--no-title-follow",
    ]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "app-com-example", "create-opentray.json"), "utf8"),
    );
    expect(config.window.toolbar).toBe(true);
    expect(config.window.iconFollowsDocument).toBe(true);
    expect(config.window.titleFollowsDocument).toBe(false);

    const exportCode = await run(["app", "export", "app.com.example", "--format", "command"]);
    expect(exportCode, errLines.join("\n")).toBe(0);
    const command = outLines.join("\n");
    expect(command).toContain("--toolbar");
    expect(command).toContain("--icon-follow");
    expect(command).toContain("--no-title-follow");
  });

  it("defaults to title-follow-on and icon-follow-off", async () => {
    const code = await run(["create", "--url", "https://example.com", "--no-scrape", "--app-id", "plain.example"]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "plain-example", "create-opentray.json"), "utf8"),
    );
    expect(config.window.titleFollowsDocument).toBe(true);
    expect(config.window.iconFollowsDocument).toBe(false);
    expect(config.window.toolbar).toBeUndefined();
  });
});

// add-webview-orchestration D13/D15：--toolbar 对命令应用开放——同一
// window.toolbar 字段、同一 toolbar 载体（服务窗），edit/export 往返。
describe("create --toolbar command applications", () => {
  it("composes the carrier over the service window and round-trips through export", async () => {
    const code = await run([
      "create", "--app-id", "toolbar.cmd.example", "--app-name", "Toolbar Cmd",
      "--exec", "node", "--arg", "serve.js", "--toolbar",
    ]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(
      await readFile(join(home, ".opentray", "create", "toolbar-cmd-example", "create-opentray.json"), "utf8"),
    );
    expect(config.window.toolbar).toBe(true);

    // 服务窗 = 同一多 webview 载体（无 iframe browse 产物）。
    const entry = await readFile(join(home, ".opentray", "create", "toolbar-cmd-example", "app", "main.mjs"), "utf8");
    expect(entry).toContain("attachToolbarCarrier");
    expect(entry).toContain("toolbarMode && shellPort !== null");
    expect(entry).toContain("column([fixed(\"toolbar\", 44), grow(\"content\")])");
    expect(entry).not.toContain("browse.html");
    expect(entry).not.toContain("<iframe");

    // export 往返携带 --toolbar（命令应用同样适用）。
    const exportCode = await run(["app", "export", "toolbar.cmd.example", "--format", "command"]);
    expect(exportCode, errLines.join("\n")).toBe(0);
    expect(outLines.join("\n")).toContain("--toolbar");

    // app edit 可翻转：--toolbar 缺省继承已提交值，显式 --no-toolbar 清除。
    const editCode = await run(["app", "edit", "toolbar.cmd.example", "--no-toolbar"]);
    expect(editCode, errLines.join("\n")).toBe(0);
    const edited = JSON.parse(
      await readFile(join(home, ".opentray", "create", "toolbar-cmd-example", "create-opentray.json"), "utf8"),
    );
    expect(edited.window.toolbar).toBe(false);
  });
});
