import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawn } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CreateConfigV1 } from "./config";
import { CONFIG_FILENAME, parseCreateConfig } from "./config";
import { applyCreate, planCreate, stopRunningApp, uninstallApp, type DesiredState } from "./lifecycle";
import { listRegistrations } from "./registry";
import { writeRuntimeRecord } from "./runtime-record";

// Materialize is stubbed: filesystem/ownership semantics are under test, not
// the icon/install pipeline (covered by its own tests).
vi.mock("./materialize", async (importOriginal) => {
  const original = await importOriginal<typeof import("./materialize")>();
  return {
    ...original,
    materializePayload: vi.fn(async (input) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(input.targetDir, { recursive: true });
      await writeFile(join(input.targetDir, "main.mjs"), "// generated\n", "utf8");
      await writeFile(join(input.targetDir, "package.json"), "{}\n", "utf8");
      return { scaffold: { projectDir: input.targetDir } as never, projectDir: input.targetDir };
    }),
    launchGeneratedApp: vi.fn(async (input, _context, payload) => ({
      scaffold: payload.scaffold,
      projectDir: payload.projectDir,
      bundlePath: undefined,
    })),
  };
});

let home: string;

const config = (appId: string, name = "App"): CreateConfigV1 => ({
  schemaVersion: 1,
  appId,
  appName: name,
  command: { executable: "/usr/bin/node", args: ["serve"], cwd: "/tmp/project" },
  packageManager: "npm",
  icons: { imageSmoothingEnabled: true, background: "transparent", scale: 0.8 },
  window: { width: 1_200, height: 800 },
  developerMode: false,
});

const desired = (c: CreateConfigV1): DesiredState => ({
  config: c,
  appIconSource: undefined,
  trayIconSource: undefined,
});

const minimalPng = (): Uint8Array => {
  const png = Buffer.alloc(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  return new Uint8Array(png);
};

const apply = (c: CreateConfigV1, extra: Partial<Parameters<typeof applyCreate>[0]> = {}) =>
  applyCreate({
    desired: desired(c),
    dependencyRange: "^0.0.0-test",
    skipInstall: true,
    homeDir: home,
    ...extra,
  });

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "create-core-test-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("plan/apply", () => {
  it("creates a registration with config authority and managed payload", async () => {
    const result = await apply(config("first.example"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registrationDir).toBe(join(home, ".opentray", "create", "first-example"));
    const raw = JSON.parse(
      await readFile(join(result.value.registrationDir, CONFIG_FILENAME), "utf8"),
    );
    const parsed = parseCreateConfig(raw);
    expect(parsed.ok).toBe(true);
    expect(result.value.isLink).toBe(false);
  });

  it("rejects force against an unknown non-empty directory without deleting anything", async () => {
    const dir = join(home, ".opentray", "create", "occupied-example");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "user-notes.txt"), "precious\n", "utf8");
    const result = await apply(config("occupied.example"), { force: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ownership_unverified");
    }
    const entries = await readdir(dir);
    expect(entries).toContain("user-notes.txt");
  });

  it("converges a drifted generated file from create-opentray.json alone", async () => {
    const c = config("drift.example");
    const first = await apply(c);
    expect(first.ok).toBe(true);
    // Simulate drift in generated output.
    const entry = join(home, ".opentray", "create", "drift-example", "app", "main.mjs");
    await writeFile(entry, "// drifted\n", "utf8");
    const second = await apply(c);
    expect(second.ok).toBe(true);
    expect(await readFile(entry, "utf8")).toBe("// generated\n");
  });

  it("rejects an appId change as an identity migration", async () => {
    await apply(config("stable.example"));
    const result = await apply(config("other.example"));
    // Different key = new registration, not a migration; the original stays.
    expect(result.ok).toBe(true);
    const original = await readFile(
      join(home, ".opentray", "create", "stable-example", CONFIG_FILENAME),
      "utf8",
    );
    expect(JSON.parse(original).appId).toBe("stable.example");
  });

  it("requires env acknowledgement flag on the plan when env is non-empty", async () => {
    const withEnv = { ...config("env.example"), command: { ...config("env.example").command, env: { API_TOKEN: "hunter2" } } };
    const plan = await planCreate({
      desired: desired(withEnv),
      skipInstall: true,
      homeDir: home,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.requiresEnvAcknowledgement).toBe(true);
    }
  });

  it("links an external payload directory and reports both paths", async () => {
    const external = await mkdtemp(join(tmpdir(), "create-external-"));
    const result = await apply(config("linked.example"), {
      externalPayloadDir: external,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isLink).toBe(true);
    expect(result.value.payloadDir).toBe(external);
  });

  it("reuses a committed snapshot when the source repeats", async () => {
    const dir = join(tmpdir(), `create-icon-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const iconPath = join(dir, "icon.png");
    await writeFile(iconPath, minimalPng());
    const c = config("icon.example");
    const first = await applyCreate({
      desired: {
        config: c,
        appIconSource: { kind: "file", path: iconPath },
        trayIconSource: { kind: "file", path: iconPath },
      },
      dependencyRange: "^0",
      skipInstall: true,
      homeDir: home,
    });
    expect(first.ok).toBe(true);
    const regDir = join(home, ".opentray", "create", "icon-example");
    const entries = await readdir(regDir);
    expect(entries).toContain("app-icon.png");
    // Tray explicitly follows the app icon: no second copy.
    expect(entries).not.toContain("tray-icon.png");
    const committed = JSON.parse(await readFile(join(regDir, CONFIG_FILENAME), "utf8"));
    expect(committed.icons.appIcon.path).toBe("app-icon.png");
    expect(committed.icons.trayIcon.path).toBe("app-icon.png");
  });
});

describe("list", () => {
  it("classifies broken links and ignores legacy directories", async () => {
    await apply(config("list.example"));
    // Broken link registration: config + dangling directory symlink.
    const brokenDir = join(home, ".opentray", "create", "broken-example");
    await mkdir(brokenDir, { recursive: true });
    await symlink("/nonexistent/target-dir", join(brokenDir, "app"), "dir");
    await writeFile(
      join(brokenDir, CONFIG_FILENAME),
      `${JSON.stringify(config("broken.example"), null, 2)}\n`,
      "utf8",
    );
    // Legacy marker-only directory.
    const legacyDir = join(home, ".opentray", "create", "legacy-project");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "opentray.app.json"), "{}\n", "utf8");
    await writeFile(join(legacyDir, "main.mjs"), "\n", "utf8");

    const records = await listRegistrations(home);
    const keys = records.map((record) => record.key);
    expect(keys).toContain("list-example");
    expect(keys).toContain("broken-example");
    expect(keys).not.toContain("legacy-project");
    const broken = records.find((record) => record.key === "broken-example");
    expect(broken?.status).toBe("broken-link");
    expect(broken?.payloadPath).toBe("/nonexistent/target-dir");
  });
});

describe("running-process conservation", () => {
  it("blocks apply/uninstall on a live verified process and refuses stale PIDs", async () => {
    await apply(config("running.example"));
    const regDir = join(home, ".opentray", "create", "running-example");
    // A real child process owns the record — never this test worker itself.
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    expect(child.pid).toBeDefined();
    const pid = child.pid!;
    const startedAt = await import("./runtime-record").then((m) =>
      m.readProcessStartEpochMs(pid),
    );
    await writeRuntimeRecord(regDir, {
      pid,
      token: "t".repeat(32),
      startedAt: startedAt ?? null,
      launchedAt: Date.now(),
    });
    const blocked = await apply(config("running.example"));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.code).toBe("app_running");
    }
    const uninstallBlocked = await uninstallApp({
      appId: "running.example",
      homeDir: home,
    });
    expect(uninstallBlocked.ok).toBe(false);

    // A dead PID record is reclaimed, not acted on.
    await writeRuntimeRecord(regDir, {
      pid: 999_999,
      token: "t".repeat(32),
      startedAt: null,
      launchedAt: Date.now(),
    });
    const stopped = await stopRunningApp({ appId: "running.example", homeDir: home });
    expect(stopped.ok).toBe(true);
    if (stopped.ok) {
      expect(stopped.value.stopped).toBe(false);
    }

    // A live PID WITHOUT a start fingerprint is unverified → refuse to kill.
    await writeRuntimeRecord(regDir, {
      pid,
      token: "t".repeat(32),
      startedAt: null,
      launchedAt: Date.now(),
    });
    const refused = await stopRunningApp({ appId: "running.example", homeDir: home });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("pid_reused");
    }
    // Verified stop tears down the child and clears the record.
    await writeRuntimeRecord(regDir, {
      pid,
      token: "t".repeat(32),
      startedAt: startedAt ?? null,
      launchedAt: Date.now(),
    });
    const verifiedStop = await stopRunningApp({ appId: "running.example", homeDir: home });
    expect(verifiedStop.ok).toBe(true);
    if (verifiedStop.ok) {
      expect(verifiedStop.value.stopped).toBe(true);
    }
  });
});

describe("uninstall", () => {
  it("retains a linked external target and reports retention explicitly", async () => {
    const external = await mkdtemp(join(tmpdir(), "create-external-"));
    await writeFile(join(external, "keep.txt"), "user data\n", "utf8");
    await apply(config("unlink.example"), { externalPayloadDir: external });
    const result = await uninstallApp({ appId: "unlink.example", homeDir: home });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.linkRemoved).toBe(true);
    expect(result.value.targetRetained).toBe(true);
    expect(result.value.targetDeleted).toBe(false);
    expect(await readFile(join(external, "keep.txt"), "utf8")).toBe("user data\n");
    expect(result.value.manualPinCleanupHint).toMatch(/Dock|taskbar/u);
  });

  it("purges the external target only under explicit authorization", async () => {
    const external = await mkdtemp(join(tmpdir(), "create-external-"));
    await apply(config("purge.example"), { externalPayloadDir: external });
    const result = await uninstallApp({
      appId: "purge.example",
      homeDir: home,
      purgeTarget: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.targetDeleted).toBe(true);
    expect(result.value.targetRetained).toBe(false);
  });

  it("removes a managed payload with the registration", async () => {
    await apply(config("managed.example"));
    const result = await uninstallApp({ appId: "managed.example", homeDir: home });
    expect(result.ok).toBe(true);
    const remaining = await listRegistrations(home);
    expect(remaining.map((record) => record.key)).not.toContain("managed-example");
  });
});
