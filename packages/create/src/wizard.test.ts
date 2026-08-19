import { describe, expect, it } from "vitest";

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile, mkdir, symlink, writeFile, stat } from "node:fs/promises";
import { createWizardSession, type WizardEvent, type WizardOptions } from "./wizard";
import type { CommandRun, CommandRunEvent, CommandRunOptions } from "@create-opentray/core";
import type { DiscoveredService } from "@create-opentray/core";
import type { ScrapeResult } from "@create-opentray/core";
import type { MaterializeContext } from "@create-opentray/core";

const neverResolve = (): Promise<{ code: number | null }> =>
  new Promise<{ code: number | null }>(() => {});

interface Harness {
  homeDir(): string;
  lastRunOptions(): CommandRunOptions | undefined;
  events: WizardEvent[];
  session: ReturnType<typeof createWizardSession>;
  setListeners(listeners: ReadonlySet<number>): void;
  setVerified(ports: readonly number[]): void;
  setScrape(result: MutableScrapeState): void;
  emitRunExit(code: number | null): void;
  killRun(): void;
}

interface MutableScrapeState {
  title?: string | undefined;
  iconPath?: string | undefined;
}

const createHarness = (overrides: Partial<WizardOptions> = {}): Harness => {
  const events: WizardEvent[] = [];
  let listeners = new Set<number>();
  let verified: readonly number[] = [];
  let scrapeState: MutableScrapeState = {};
  // Generated projects default into ~/.opentray/create — tests must anchor
  // that root in a throwaway home so they never touch the real one.
  const homeDir = overrides.homeDir ?? mkdtempSync(join(tmpdir(), "wizard-home-"));
  // exactOptionalPropertyTypes: never spread explicit undefined into options.
  const overridesDefined = Object.fromEntries(
    Object.entries(overrides).filter((entry) => entry[1] !== undefined),
  ) as Partial<WizardOptions>;

  let runOnEvent: ((event: CommandRunEvent) => void) | undefined;
  let lastRunOptions: CommandRunOptions | undefined;

  const fakeRun = async (options: CommandRunOptions): Promise<CommandRun> => {
    runOnEvent = options.onEvent;
    lastRunOptions = options;
    return {
      pid: 4321,
      pty: false,
      exited: neverResolve(),
      output: [],
      write: () => {},
      resize: () => {},
      kill: async () => {},
    };
  };

  const session = createWizardSession({
    cwd: "/tmp/wizard-cwd",
    skipInstall: true,
    dependencyRange: "^0.0.0-test",
    emit: (event) => events.push(event),
    spawnRun: fakeRun,
    listListeners: async () => listeners,
    verifyHttp: async (port) => verified.includes(port),
    listPortOwners: async () =>
      new Map([...listeners].map((port) => [port, new Set<number>([4321])])),
    homeDir,
    pollIntervalMs: 1,
    scrapeIntervalMs: 1,
    scrape: async (port): Promise<ScrapeResult> => ({
      ok: true,
      title: scrapeState.title,
      iconPath: scrapeState.iconPath,
      ...(scrapeState.iconPath === undefined
        ? { icons: [] }
        : {
            icons: [
              {
                index: 0,
                url: `http://127.0.0.1:${port}/x.png`,
                path: scrapeState.iconPath,
                width: 128,
                height: 128,
                format: "png",
                variant: "original",
              },
            ],
          }),
    }),
    resolveVector: async ({ tokens, cwd }) => ({
      command: `/resolved/${tokens[0]}`,
      args: tokens.slice(1),
      cwd,
    }),
    ...overridesDefined,
  });

  return {
    events,
    session,
    homeDir: () => homeDir,
    lastRunOptions: () => lastRunOptions,
    setListeners(next) {
      listeners = new Set(next);
      verified = [...next];
    },
    setVerified(next) {
      verified = next;
    },
    setScrape(next) {
      scrapeState = next;
    },
    emitRunExit() {
      runOnEvent?.({ type: "exit", code: 1 });
    },
    killRun() {
      runOnEvent?.({ type: "exit", code: 137 });
    },
  };
};

const waitFor = async (
  predicate: () => boolean,
  // Generous budget: the suite shares a process with real sharp pipelines
  // (1024² icon compositions) whose CPU bursts stall these real-timer polls;
  // 2s flaked under that contention.
  timeoutMs = 15_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not met before timeout");
};

const serviceEvent = (events: readonly WizardEvent[]) => {
  const serviceEvents = events.filter(
    (event): event is Extract<WizardEvent, { type: "services" }> => event.type === "services",
  );
  return serviceEvents.at(-1);
};

/** Latest form event's defaults (placeholder suggestions). */
const lastFormDefaults = (events: readonly WizardEvent[]) => {
  const formEvents = events.filter(
    (event): event is Extract<WizardEvent, { type: "form" }> => event.type === "form",
  );
  return formEvents.at(-1)?.defaults;
};

describe("wizard session", () => {
  it("walks idle → running → discovered and updates placeholder defaults from the scrape", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    expect(harness.session.state).toBe("running");

    harness.setScrape({ title: "Scraped Title" });
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");

    await waitFor(() => lastFormDefaults(harness.events)?.appName === "Scraped Title");
    // Values stay empty (placeholders carry the suggestions).
    expect(harness.session.form.appName).toBe("");
    expect(harness.session.form.appId).toBe("");
    expect(lastFormDefaults(harness.events)?.appId).toBe("start.somecommand.npmjs");
    expect(harness.session.selectedPort).toBe(19080);
    // The nav bar learns the raw command.
    expect(
      harness.events.some(
        (event) =>
          event.type === "command-display" && event.command === "npx somecommand start --xx",
      ),
    ).toBe(true);
  });

  it("never overwrites user-edited fields", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");

    harness.session.updateForm({ appName: "My Custom Name" });
    harness.setScrape({ title: "Later Title" });
    await waitFor(() =>
      harness.events.some((event) => event.type === "scrape" && event.title === "Later Title"),
    );
    expect(harness.session.form.appName).toBe("My Custom Name");
  });

  it("lists multiple services in first-seen order and selects the first", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx tool serve");

    harness.setListeners(new Set([19080]));
    await waitFor(() => serviceEvent(harness.events)?.services.length === 1);
    harness.setListeners(new Set([19080, 19081]));
    await waitFor(() => serviceEvent(harness.events)?.services.length === 2);

    const services: readonly DiscoveredService[] = serviceEvent(harness.events)!.services;
    expect(services.map((service) => service.port)).toEqual([19080, 19081]);
    expect(harness.session.selectedPort).toBe(19080);

    harness.session.selectService(19081);
    expect(harness.session.selectedPort).toBe(19081);
  });

  it("freezes resolved placeholder defaults at confirmation", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    harness.setScrape({ title: "Frozen Title" });
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");
    await waitFor(() => lastFormDefaults(harness.events)?.appName === "Frozen Title");

    // Untouched fields resolve to their placeholder defaults at confirm.
    harness.session.confirm();
    expect(harness.session.state).toBe("frozen");
    expect(harness.session.form.appName).toBe("Frozen Title");
    expect(harness.session.form.appId).toBe("start.somecommand.npmjs");

    harness.setScrape({ title: "Post-freeze Title" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.session.form.appName).toBe("Frozen Title");
  });

  it("confirms without a sniffed port and records the zero hint", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    // No service was sniffed (listeners empty): confirm must still succeed —
    // the generated app sniffs ports at runtime; the frozen hint is 0.
    harness.session.confirm();
    expect(harness.session.state).toBe("frozen");
  });

  it("emits the running state immediately and forwards terminal I/O", async () => {
    const writes: string[] = [];
    const resizes: { cols: number; rows: number }[] = [];
    const events: WizardEvent[] = [];
    let listeners = new Set<number>();
    const session = createWizardSession({
      cwd: "/tmp/wizard-cwd",
      skipInstall: true,
      force: true,
      dependencyRange: "^0.0.0-test",
      emit: (event) => events.push(event),
      spawnRun: async () => ({
        pid: 555,
        pty: true,
        exited: neverResolve(),
        output: [],
        write: (data) => writes.push(data),
        resize: (size) => resizes.push(size),
        kill: async () => {},
      }),
      listListeners: async () => listeners,
      verifyHttp: async () => true,
      listPortOwners: async () =>
        new Map([...listeners].map((port) => [port, new Set<number>([555])])),
      scrape: async (): Promise<ScrapeResult> => ({
        ok: true,
        title: "T",
        iconPath: undefined,
        icons: [],
      }),
      pollIntervalMs: 1,
      scrapeIntervalMs: 1,
      resolveVector: async ({ tokens, cwd }) => ({
        command: `/resolved/${tokens[0]}`,
        args: tokens.slice(1),
        cwd,
      }),
    });

    await session.submitCommand("npx tool start");
    expect(session.state).toBe("running");
    // The session publishes its initial command-options snapshot (with the
    // resolved USER_HOME default) at creation; drop it for this assertion.
    const runEvents = events[0]?.type === "command-options" ? events.slice(1) : events;
    // The running state must be emitted before any awaits (temp dirs, listener
    // baselines, PTY probes); only the synchronous command display precedes it.
    expect(runEvents[0]?.type).toBe("command-display");
    expect(runEvents[1]).toMatchObject({ type: "state", state: "running" });

    session.terminalInput("hi\n");
    session.terminalResize({ cols: 120, rows: 40 });
    expect(writes).toEqual(["hi\n"]);
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);

    listeners = new Set([19080]);
    await waitFor(() => session.state === "discovered");
    // Terminal stays live after discovery.
    session.terminalInput("more\n");
    expect(writes).toEqual(["hi\n", "more\n"]);
  });

  it("emits run-status lifecycle and keeps discovered state when the process dies", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    // Spawn emitted running:true.
    expect(
      harness.events.some(
        (event) => event.type === "run-status" && event.running === true,
      ),
    ).toBe(true);

    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");
    // Externally kill: the fake run's exit must flip liveness and stop timers
    // without destroying the discovered state.
    await harness.killRun();
    await waitFor(() =>
      harness.events.some(
        (event) => event.type === "run-status" && event.running === false,
      ),
    );
    expect(harness.session.runAlive).toBe(false);
    expect(harness.session.state).toBe("discovered");
    // Re-submission is allowed after the process died.
    await harness.session.submitCommand("npx other-tool serve");
    expect(harness.session.state).toBe("running");
  });

  it("primes placeholder defaults from command text without spawning", async () => {
    let spawned = 0;
    const events: WizardEvent[] = [];
    const session = createWizardSession({
      cwd: "/tmp/wizard-cwd",
      skipInstall: true,
      force: true,
      dependencyRange: "^0.0.0-test",
      emit: (event) => events.push(event),
      spawnRun: async () => {
        spawned += 1;
        return {
          pid: 1,
          pty: false,
          exited: neverResolve(),
          output: [],
          write: () => {},
          resize: () => {},
          kill: async () => {},
        };
      },
      listListeners: async () => new Set<number>(),
      verifyHttp: async () => false,
      scrape: async (): Promise<ScrapeResult> => ({
        ok: true,
        title: undefined,
        iconPath: undefined,
        icons: [],
      }),
      resolveVector: async ({ tokens, cwd }) => ({
        command: `/resolved/${tokens[0]}`,
        args: tokens.slice(1),
        cwd,
      }),
    });

    session.prime("npx primed-tool start --xx");
    expect(spawned).toBe(0);
    expect(session.state).toBe("idle");
    const defaults = lastFormDefaults(events);
    expect(defaults?.appId).toBe("start.primed-tool.npmjs");
  });

  it("confirms and materializes from idle without any run", async () => {
    const events: WizardEvent[] = [];
    let materializePort = -1;
    const session = createWizardSession({
      cwd: "/tmp/wizard-cwd",
      homeDir: mkdtempSync(join(tmpdir(), "wizard-home-")),
      skipInstall: true,
      force: true,
      dependencyRange: "^0.0.0-test",
      platform: "linux",
      emit: (event) => events.push(event),
      listListeners: async () => new Set<number>(),
      verifyHttp: async () => false,
      scrape: async (): Promise<ScrapeResult> => ({
        ok: true,
        title: undefined,
        iconPath: undefined,
        icons: [],
      }),
      resolveVector: async ({ tokens, cwd }) => ({
        command: `/resolved/${tokens[0]}`,
        args: tokens.slice(1),
        cwd,
      }),
      materializeContext: {
        generateIcon: (async () => ({
          schemaVersion: 1,
          sourceSha256: "",
          sourceImplementationSha256: null,
          implementationSha256: "",
          recipeVersion: "",
          sharpVersion: "",
          iconEncoderVersion: "",
          figmaSquircleVersion: "",
          outputPath: "",
          icnsOutputPath: "",
          icoOutputPath: "",
          linuxPngOutputPaths: [],
          manifestOutputPath: "",
          appIcon: [],
        })) as unknown as NonNullable<MaterializeContext["generateIcon"]>,
        runInstall: async ({ log }) => {
          void log;
        },
      },
    });
    void materializePort;

    session.prime("npx manual-port-tool serve");
    session.confirm();
    expect(session.state).toBe("frozen");
    expect(session.form.appId).toBe("serve.manual-port-tool.npmjs");
    await session.create();
    expect(session.state).toBe("success");
    const success = events.find(
      (event): event is Extract<WizardEvent, { type: "success" }> => event.type === "success",
    );
    expect(success).toBeDefined();
  }, 20_000);

  it("confirms from a primed command with no sniffed service", async () => {
    const session = createWizardSession({
      cwd: "/tmp/wizard-cwd",
      skipInstall: true,
      force: true,
      dependencyRange: "^0.0.0-test",
      emit: () => {},
      listListeners: async () => new Set<number>(),
      verifyHttp: async () => false,
      scrape: async (): Promise<ScrapeResult> => ({
        ok: true,
        title: undefined,
        iconPath: undefined,
        icons: [],
      }),
      resolveVector: async ({ tokens, cwd }) => ({
        command: `/resolved/${tokens[0]}`,
        args: tokens.slice(1),
        cwd,
      }),
    });
    session.prime("npx portless-tool serve");
    session.confirm();
    expect(session.state).toBe("frozen");
  });

  it("submits argv verbatim in array mode with custom cwd and env", async () => {
    const harness = createHarness({ homeDir: "/tmp/wizard-home" });
    harness.session.updateCommandOptions({
      argsMode: "array",
      cwd: "sub/dir",
      env: [
        { key: "FOO", value: "bar" },
        { key: "", value: "skipped" },
        { key: "BAZ", value: "qux" },
      ],
    });
    await harness.session.submitCommand(["npx", "weird arg with  spaces", "--x=1"]);
    // Array elements pass through VERBATIM — no string splitting ever runs.
    expect(harness.lastRunOptions()?.tokens).toEqual([
      "npx",
      "weird arg with  spaces",
      "--x=1",
    ]);
    // cwd default is USER_HOME (owner law); relative paths resolve from home;
    // env overlay drops empty keys; the npx env preset injects npm_config_yes.
    expect(harness.lastRunOptions()?.cwd).toBe("/tmp/wizard-home/sub/dir");
    expect(harness.lastRunOptions()?.env).toEqual({
      FOO: "bar",
      BAZ: "qux",
      npm_config_yes: "true",
    });
    // The command display joins for presentation only.
    const display = harness.events.find(
      (event): event is Extract<WizardEvent, { type: "command-display" }> =>
        event.type === "command-display",
    );
    expect(display?.command).toBe("npx weird arg with  spaces --x=1");
  });

  it("injects the npm-series env preset, honors explicit entries, and disables cleanly", async () => {
    const harness = createHarness({ homeDir: "/tmp/wizard-home" });
    // npx 命令自动注入 npm_config_yes=true（add-create-command-family D4）。
    await harness.session.submitCommand("npx tool serve");
    expect(harness.lastRunOptions()?.env).toEqual({ npm_config_yes: "true" });
    // 用户显式配置的同名条目优先，预设永不覆盖。
    harness.session.updateCommandOptions({ env: [{ key: "npm_config_yes", value: "false" }] });
    await harness.session.submitCommand("npx tool serve");
    expect(harness.lastRunOptions()?.env).toEqual({ npm_config_yes: "false" });
    // envPresetDisabled 整体关闭注入（清掉上面的显式条目再验证）；
    // 空 overlay 时向导不传 env 键（既有 spawn 接缝契约）。
    harness.session.updateCommandOptions({ env: [], envPresetDisabled: true });
    await harness.session.submitCommand("npx tool serve");
    expect(harness.lastRunOptions()?.env).toBeUndefined();
    // 非 npx/pnpx runner 与其它系列不注入。
    harness.session.updateCommandOptions({ env: [] });
    await harness.session.submitCommand("bunx tool serve");
    expect(harness.lastRunOptions()?.env).toBeUndefined();
    await harness.session.submitCommand("go run rsc.io/fortune@latest");
    expect(harness.lastRunOptions()?.env).toBeUndefined();
  });

  it("honors the explicit family authoring state over command-derived parsing (D11)", async () => {
    const harness = createHarness({ homeDir: "/tmp/wizard-home" });
    // rust 作者状态：命令串只是运行行（rg --json .），crate/binary 无法从
    // 命令串恢复，必须来自投影（Codex B1）。
    harness.session.updateCommandOptions({
      family: {
        family: "rust",
        runner: "",
        runnerFlags: "",
        pkg: "ripgrep",
        version: "",
        args: "--json .",
        binary: "rg",
        raw: "",
      },
    });
    await harness.session.submitCommand("rg --json .");
    expect(lastFormDefaults(harness.events)?.appId).toBe("rg.rust");
    // npm 作者状态同样优先；执行向量仍是命令串。
    harness.session.updateCommandOptions({
      family: {
        family: "npm",
        runner: "npx",
        runnerFlags: "",
        pkg: "cowsay",
        version: "",
        args: "hello",
        binary: "",
        raw: "",
      },
    });
    await harness.session.submitCommand("cowsay hello");
    expect(lastFormDefaults(harness.events)?.appId).toBe("hello.cowsay.npmjs");
    expect(harness.lastRunOptions()?.tokens).toEqual(["cowsay", "hello"]);
    expect(harness.lastRunOptions()?.env).toEqual({ npm_config_yes: "true" });
  });

  it("refuses to run cargo install commands (D7/D11 / Codex B1)", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("cargo install ripgrep");
    expect(harness.session.state).toBe("failed");
    const failReason = harness.events.find(
      (event): event is Extract<WizardEvent, { type: "state" }> =>
        event.type === "state" && event.state === "failed",
    )?.reason;
    expect(failReason).toContain("cargo install 不会被执行");
    // 绝不 spawn：安装命令从未到达执行层。
    expect(harness.lastRunOptions()).toBeUndefined();
  });

  it("refuses cargo install via absolute path by resolved executable (Codex R3-B1)", async () => {
    const harness = createHarness();
    // 路径形式的 cargo：字面头判定不命中，必须按解析后可执行文件名拒绝。
    await harness.session.submitCommand(["/opt/homebrew/bin/cargo", "install", "ripgrep"]);
    expect(harness.session.state).toBe("failed");
    expect(harness.lastRunOptions()).toBeUndefined();
    // 裸名 + seam 解析到 cargo 同样拒绝。
    const seam = createHarness({
      resolveOnPath: async () => "/usr/local/bin/cargo",
    });
    await seam.session.submitCommand(["cargo", "--offline", "install", "ripgrep"]);
    expect(seam.session.state).toBe("failed");
    expect(seam.lastRunOptions()).toBeUndefined();
    // 非 cargo 的普通命令不受影响。
    const normal = createHarness({
      resolveOnPath: async () => "/usr/local/bin/node",
    });
    await normal.session.submitCommand("node server.js");
    expect(normal.session.state).not.toBe("failed");
    expect(normal.lastRunOptions()?.tokens).toEqual(["node", "server.js"]);
  });

  it("refuses cargo install behind value-bearing flags, toolchain prefixes, symlinks, and case (Codex R4-B1)", async () => {
    // 带值全局选项（--color always / -C <dir>）与 rustup `+nightly` 前缀都会
    // 推移子命令位置；判定改取「argv 含独立 install token」的保守语义。
    const withFlags = createHarness({
      resolveOnPath: async () => "/usr/local/bin/cargo",
    });
    for (const argv of [
      ["cargo", "--color", "always", "install", "ripgrep"],
      ["cargo", "-C", "/tmp", "install", "ripgrep"],
      ["cargo", "+nightly", "install", "ripgrep"],
    ]) {
      await withFlags.session.submitCommand(argv);
      expect(withFlags.session.state).toBe("failed");
      expect(withFlags.lastRunOptions()).toBeUndefined();
    }
    // Windows 大小写：CARGO.EXE 同样拒绝。
    await withFlags.session.submitCommand(["CARGO.EXE", "install", "ripgrep"]);
    expect(withFlags.session.state).toBe("failed");
    // PATH 软链接别名：ci -> cargo 经 realpath 归一后拒绝。
    const aliasDir = mkdtempSync(join(tmpdir(), "cargo-alias-"));
    const cargoPath = join(aliasDir, "cargo");
    const aliasPath = join(aliasDir, "ci");
    await writeFile(cargoPath, "#!/bin/sh\n", "utf8");
    await symlink(cargoPath, aliasPath);
    const aliased = createHarness({
      resolveOnPath: async () => aliasPath,
    });
    await aliased.session.submitCommand(["ci", "install", "ripgrep"]);
    expect(aliased.session.state).toBe("failed");
    expect(aliased.lastRunOptions()).toBeUndefined();
  });

  it("defaults the command cwd to USER_HOME and publishes it", async () => {
    const harness = createHarness({ homeDir: "/tmp/wizard-home" });
    // The initial snapshot carries the resolved default for the UI.
    const snapshot = harness.events.find(
      (event): event is Extract<WizardEvent, { type: "command-options" }> =>
        event.type === "command-options",
    );
    expect(snapshot?.defaultCwd).toBe("/tmp/wizard-home");
    expect(snapshot?.options.cwd).toBe("");
    // Empty cwd = home; no explicit resolution against the wizard cwd.
    await harness.session.submitCommand("npx homebased serve");
    expect(harness.lastRunOptions()?.cwd).toBe("/tmp/wizard-home");
    // An absolute override passes through unchanged.
    harness.session.updateCommandOptions({ cwd: "/var/abs" });
    await harness.session.submitCommand("npx homebased serve");
    expect(harness.lastRunOptions()?.cwd).toBe("/var/abs");
  });

  it("defaults the project directory into the OpenTray create root", async () => {
    const harness = createHarness();
    harness.session.prime("npx homed-tool serve");
    const defaults = lastFormDefaults(harness.events);
    // Stable per-app home under ~/.opentray/create — never the invocation dir.
    expect(defaults?.targetDir).toBe(
      join(harness.homeDir(), ".opentray", "create", "serve-homed-tool-npmjs"),
    );
  });

  it("force wipes an occupied target directory before regenerating", async () => {
    const harness = createHarness({
      materializeContext: {
        generateIcon: (async () => ({
          schemaVersion: 1,
          sourceSha256: "",
          sourceImplementationSha256: null,
          implementationSha256: "",
          recipeVersion: "",
          sharpVersion: "",
          iconEncoderVersion: "",
          figmaSquircleVersion: "",
          outputPath: "",
          icnsOutputPath: "",
          icoOutputPath: "",
          linuxPngOutputPaths: [],
          manifestOutputPath: "",
          appIcon: [],
        })) as unknown as NonNullable<MaterializeContext["generateIcon"]>,
        runInstall: async () => {},
      },
    });
    // Simulate a stale previous generation BEFORE priming, so the existence
    // probe (fired by prime) observes the occupied directory.
    const target = join(harness.homeDir(), ".opentray", "create", "serve-wipe-tool-npmjs");
    await mkdir(join(target, "node_modules", "stale"), { recursive: true });
    await writeFile(join(target, "node_modules", "stale", "junk.txt"), "old", "utf8");
    harness.session.prime("npx wipe-tool serve");
    expect(lastFormDefaults(harness.events)?.targetDir).toBe(target);
    // The form event flags the occupied directory for the UI warning.
    await waitFor(() =>
      harness.events.some((event) => event.type === "form" && event.targetDirExists === true),
    );
    // Without force, confirm+create fails with guidance toward the toggle.
    harness.session.confirm();
    await harness.session.create();
    expect(harness.session.state).toBe("failed");
    const failReason = harness.events.find(
      (event): event is Extract<WizardEvent, { type: "state" }> =>
        event.type === "state" && event.state === "failed",
    )?.reason;
    expect(failReason).toContain("强制覆盖");
    // With force: the stale tree is wiped and generation succeeds.
    harness.session.updateForm({ force: true });
    harness.session.confirm();
    await harness.session.create();
    expect(harness.session.state).toBe("success");
    const staleExists = await stat(join(target as string, "node_modules", "stale", "junk.txt"))
      .then(
        () => true,
        () => false,
      );
    expect(staleExists).toBe(false);
  }, 20_000);

  it("keeps the env overlay on the frozen launch vector", async () => {
    const harness = createHarness({
      materializeContext: {
        generateIcon: (async () => ({
          schemaVersion: 1,
          sourceSha256: "",
          sourceImplementationSha256: null,
          implementationSha256: "",
          recipeVersion: "",
          sharpVersion: "",
          iconEncoderVersion: "",
          figmaSquircleVersion: "",
          outputPath: "",
          icnsOutputPath: "",
          icoOutputPath: "",
          linuxPngOutputPaths: [],
          manifestOutputPath: "",
          appIcon: [],
        })) as unknown as NonNullable<MaterializeContext["generateIcon"]>,
        runInstall: async () => {},
      },
    });
    harness.session.updateCommandOptions({
      argsMode: "string",
      env: [{ key: "TOKEN", value: "sekret" }],
    });
    await harness.session.submitCommand("npx somecommand start --xx");
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");
    harness.session.confirm();
    await harness.session.create();
    expect(harness.session.state).toBe("success");
    // The frozen config carries the env overlay for the generated app.
    const configPath = harness.session.result?.scaffold.configPath;
    expect(configPath).toBeDefined();
    const frozenConfig = JSON.parse(
      await readFile(configPath as string, "utf8"),
    ) as { command: { env?: Record<string, string> } };
    expect(frozenConfig.command.env).toEqual({ TOKEN: "sekret", npm_config_yes: "true" });
  }, 20_000);

  it("materializes through the frozen form and reaches success", async () => {
    const events: WizardEvent[] = [];
    let runKilled = false;
    let listeners = new Set<number>();
    const session = createWizardSession({
      cwd: "/tmp/wizard-cwd",
      homeDir: mkdtempSync(join(tmpdir(), "wizard-home-")),
      skipInstall: true,
      force: true,
      dependencyRange: "^0.0.0-test",
      platform: "linux",
      pollIntervalMs: 1,
      scrapeIntervalMs: 1,
      emit: (event) => events.push(event),
      spawnRun: async (): Promise<CommandRun> => ({
        pid: 100,
        pty: false,
        exited: neverResolve(),
        output: [],
        write: () => {},
        resize: () => {},
        kill: async () => {
          runKilled = true;
        },
      }),
      listListeners: async () => listeners,
      verifyHttp: async () => true,
      listPortOwners: async () =>
        new Map([...listeners].map((port) => [port, new Set<number>([100])])),
      scrape: async (): Promise<ScrapeResult> => ({
        ok: true,
        title: "Materialize Title",
        iconPath: undefined,
        icons: [],
      }),
      resolveVector: async ({ tokens, cwd }) => ({
        command: `/resolved/${tokens[0]}`,
        args: tokens.slice(1),
        cwd,
      }),
      materializeContext: {
        generateIcon: (async () => ({
          schemaVersion: 1,
          sourceSha256: "",
          sourceImplementationSha256: null,
          implementationSha256: "",
          recipeVersion: "",
          sharpVersion: "",
          iconEncoderVersion: "",
          figmaSquircleVersion: "",
          outputPath: "",
          icnsOutputPath: "",
          icoOutputPath: "",
          linuxPngOutputPaths: [],
          manifestOutputPath: "",
          appIcon: [],
        })) as unknown as NonNullable<MaterializeContext["generateIcon"]>,
      },
    });

    await session.submitCommand("npx somecommand start --xx");
    listeners = new Set([19080]);
    await waitFor(() => session.state === "discovered");
    await waitFor(() => lastFormDefaults(events)?.appName === "Materialize Title");

    session.confirm();
    await session.create();

    expect(session.state).toBe("success");
    expect(runKilled).toBe(true);
    const success = events.find(
      (event): event is Extract<WizardEvent, { type: "success" }> => event.type === "success",
    );
    expect(success?.projectDir).toContain("start-somecommand-npmjs");
    expect(success?.pinHint).toBeTruthy();
    expect(session.result?.projectDir).toContain("start-somecommand-npmjs");
  }, 20_000);
});

describe("cancel thaws a frozen confirmation", () => {
  it("returns to editable after cancel and allows re-confirm", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");

    harness.session.confirm();
    expect(harness.session.state).toBe("frozen");
    // Frozen gate: form edits are ignored while frozen.
    harness.session.updateForm({ appName: "Ignored While Frozen" });
    expect(harness.session.form.appName).not.toBe("Ignored While Frozen");

    harness.session.cancel();
    expect(["discovered", "running"]).toContain(harness.session.state);

    // Thawed: edits land again, and a second confirm-refreeze works.
    harness.session.updateForm({ appName: "Edited after thaw" });
    expect(harness.session.form.appName).toBe("Edited after thaw");
    harness.session.confirm();
    expect(harness.session.state).toBe("frozen");
    expect(harness.session.form.appName).toBe("Edited after thaw");
  });

  it("rejects cancel outside frozen", () => {
    const harness = createHarness();
    expect(() => harness.session.cancel()).toThrow(/cannot cancel while idle/);
  });
});

// 冻结参数分享（wizard-share-and-list-scan D3）：未生成即可导出。
describe("frozen-parameter sharing (exportFrozen)", () => {
  it("exports a sh script from the frozen state without creating anything", async () => {
    const harness = createHarness();
    harness.session.prime("npx @deepseek-ai/dsh@latest web");
    harness.session.confirm();
    expect(harness.session.state).toBe("frozen");

    const result = await harness.session.exportFrozen({ format: "sh", acknowledgeEnv: true });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "script") return;
    expect(result.filename).toBe("create-opentray.sh");
    // appId 由 prime 默认推导（npm 系列尾段 npmjs）。
    expect(result.content).toContain("web.dsh.npmjs");
    // npx 环境变量预设随冻结参数进入分享脚本。
    expect(result.content).toContain("npm_config_yes=true");
    // 向量在分享时现算（resolveVector seam）。
    expect(result.content).toContain("/resolved/npx");
    expect(result.content).toContain("@deepseek-ai/dsh@latest");
    expect(result.content).toContain("--pm");

    // 分享绝不物化：create root 仍为空。
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const createRoot = join(harness.homeDir(), ".opentray", "create");
    await expect(readdir(createRoot)).rejects.toThrow();
  });

  it("refuses until env acknowledged, then includes the entries", async () => {
    const harness = createHarness();
    harness.session.updateCommandOptions({ env: [{ key: "API_TOKEN", value: "secret" }] });
    harness.session.prime("npx tool serve");
    harness.session.confirm();

    const refused = await harness.session.exportFrozen({ format: "sh" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("env_ack_required");
      expect(refused.message).not.toContain("secret");
    }

    const allowed = await harness.session.exportFrozen({ format: "sh", acknowledgeEnv: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok && allowed.kind === "script") {
      expect(allowed.content).toContain("API_TOKEN=secret"); // 已确认的完整导出含值
    }
  });

  it("defaults local uploads to embedded bytes and shares by path when inline is off", async () => {
    const harness = createHarness();
    const { writeFile } = await import("node:fs/promises");
    const upload = await harness.session.saveIconUpload(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    );
    harness.session.updateForm({ iconPath: upload });
    harness.session.prime("npx tool serve");
    harness.session.confirm();

    const embeddedShare = await harness.session.exportFrozen({ format: "sh", acknowledgeEnv: true });
    expect(embeddedShare.ok).toBe(true);
    if (!embeddedShare.ok || embeddedShare.kind !== "script") return;
    expect(embeddedShare.iconReference).toBe("local");
    expect(embeddedShare.iconSharedAs).toBe("embedded");
    expect(embeddedShare.content).toContain("app_icon_tmp");

    const referenceShare = await harness.session.exportFrozen({ format: "sh", inlineIcon: false, acknowledgeEnv: true });
    expect(referenceShare.ok).toBe(true);
    if (!referenceShare.ok || referenceShare.kind !== "script") return;
    expect(referenceShare.iconSharedAs).toBe("local");
    expect(referenceShare.content).toContain("--app-icon");
    expect(referenceShare.content).toContain(upload);
    expect(referenceShare.content).not.toContain("base64");
  });

  it("state-gates sharing to a frozen parameter set", async () => {
    const harness = createHarness();
    const result = await harness.session.exportFrozen({ format: "sh" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("state_error");
    }
  });
});

  it("shares scraped icons as their http URL plus generation flags by default", async () => {
    const harness = createHarness();
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    // PNG magic 足够 detectImageFormat 识别（内联分支需要可读文件）。
    const iconPath = join(harness.homeDir(), "favicon.png");
    await writeFile(iconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    harness.setScrape({ title: "Titled Service", iconPath });
    harness.session.updateForm({ iconBackground: "black", iconScale: 0.72 });
    await harness.session.submitCommand("npx tool serve");
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");
    harness.session.confirm();

    const urlShare = await harness.session.exportFrozen({ format: "sh", acknowledgeEnv: true });
    expect(urlShare.ok).toBe(true);
    if (!urlShare.ok || urlShare.kind !== "script") return;
    expect(urlShare.iconSharedAs).toBe("url");
    // 原始网页图标以 http 链接分享，并携带生成参数。
    expect(urlShare.content).toContain("http://127.0.0.1:19080/x.png");
    expect(urlShare.content).toContain("--icon-background");
    expect(urlShare.content).toContain("black");
    expect(urlShare.content).toContain("--icon-scale");
    expect(urlShare.content).toContain("0.72");
    expect(urlShare.content).not.toContain("base64");

    // inlineIcon 显式开启才内联字节。
    const inlineShare = await harness.session.exportFrozen({ format: "sh", inlineIcon: true, acknowledgeEnv: true });
    expect(inlineShare.ok).toBe(true);
    if (!inlineShare.ok || inlineShare.kind !== "script") return;
    expect(inlineShare.iconSharedAs).toBe("embedded");
    expect(inlineShare.content).toContain("app_icon_tmp");
    expect(inlineShare.content).toContain("base64");
    expect(inlineShare.content).not.toContain("http://127.0.0.1:19080/x.png");
  });
