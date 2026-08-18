import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findCreateEntry, listCreateEntries, readWizardProjectIcon } from "./scan";

const writeWizardProject = async (dir: string, over: Record<string, unknown> = {}): Promise<void> => {
  await mkdir(join(dir, "app-icon"), { recursive: true });
  await writeFile(
    join(dir, "opentray.app.json"),
    JSON.stringify({
      schemaVersion: 1,
      appId: "web.dsh.npx",
      appName: "DeepSeek Harness",
      command: {
        command: "/usr/local/bin/node",
        args: ["npx", "-y", "@deepseek-ai/dsh@latest", "web"],
        cwd: "/tmp/home",
        env: { TOKEN: "secret-value" },
      },
      service: { port: 3080 },
      window: { width: 1200, height: 800 },
      developerMode: true,
      ...over,
    }),
  );
  await writeFile(join(dir, "main.mjs"), "// generated\n");
  await writeFile(join(dir, "pnpm-lock.yaml"), "");
  const png = Buffer.alloc(8, 0x89);
  await writeFile(join(dir, "app-icon", "app-icon.png"), png);
};

const writeRegistration = async (dir: string): Promise<void> => {
  await mkdir(join(dir, "app"), { recursive: true });
  await writeFile(
    join(dir, "create-opentray.json"),
    JSON.stringify({
      schemaVersion: 1,
      appId: "start.somecommand.npx",
      appName: "Somecommand Start",
      command: { executable: "/usr/bin/node", args: ["serve"], cwd: "/tmp/project" },
      packageManager: "npm",
      icons: { imageSmoothingEnabled: true, background: "transparent", scale: 0.8 },
      window: { width: 1200, height: 800 },
      developerMode: false,
    }),
  );
  await writeFile(join(dir, "app", "main.mjs"), "// generated\n");
};

describe("listCreateEntries", () => {
  it("projects both layouts from one create root", async () => {
    const home = await mkdtemp(join(tmpdir(), "scan-test-"));
    const root = join(home, ".opentray", "create");
    await writeWizardProject(join(root, "web-dsh-npx"));
    await writeRegistration(join(root, "start-somecommand-npx"));
    await mkdir(join(root, "foreign-dir"), { recursive: true });
    await writeFile(join(root, "loose-file.txt"), "x");

    const entries = await listCreateEntries(home);
    expect(entries.map((entry) => entry.key)).toEqual([
      "start-somecommand-npx",
      "web-dsh-npx",
    ]);
    const registered = entries[0]!;
    expect(registered.source).toBe("registered");
    const wizard = entries[1]!;
    if (wizard.source !== "wizard") throw new Error("expected wizard entry");
    // 投影：命令向量 / env / pm(lockfile 推断) / 窗口 / 图标稳定路径。
    expect(wizard.config?.appId).toBe("web.dsh.npx");
    expect(wizard.config?.command.executable).toBe("/usr/local/bin/node");
    expect(wizard.config?.command.args).toContain("@deepseek-ai/dsh@latest");
    expect(wizard.config?.command.env).toEqual({ TOKEN: "secret-value" });
    expect(wizard.config?.packageManager).toBe("pnpm");
    expect(wizard.config?.developerMode).toBe(true);
    expect(wizard.config?.servicePort).toBe(3080);
    expect(wizard.config?.iconSourcePath).toBe(join(root, "web-dsh-npx", "app-icon", "app-icon.png"));
  });

  it("keeps foreign directories invisible", async () => {
    const home = await mkdtemp(join(tmpdir(), "scan-test-"));
    const root = join(home, ".opentray", "create");
    // 只有 opentray.app.json 没有 main.mjs：不完整标记，不算向导项目。
    await mkdir(join(root, "half-marker"), { recursive: true });
    await writeFile(join(root, "half-marker", "opentray.app.json"), "{}");
    const entries = await listCreateEntries(home);
    expect(entries).toEqual([]);
  });

  it("returns empty for an absent root", async () => {
    const home = await mkdtemp(join(tmpdir(), "scan-test-"));
    expect(await listCreateEntries(home)).toEqual([]);
  });

  it("follows symlinked registration directories", async () => {
    const home = await mkdtemp(join(tmpdir(), "scan-test-"));
    const root = join(home, ".opentray", "create");
    const target = join(home, "external-reg");
    await writeRegistration(target);
    await mkdir(root, { recursive: true });
    await symlink(target, join(root, "linked-reg"));
    const entries = await listCreateEntries(home);
    expect(entries[0]?.source).toBe("registered");
    expect(entries[0]?.key).toBe("linked-reg");
  });
});

describe("findCreateEntry", () => {
  it("resolves a wizard entry by key", async () => {
    const home = await mkdtemp(join(tmpdir(), "scan-test-"));
    const root = join(home, ".opentray", "create");
    await writeWizardProject(join(root, "web-dsh-npx"));
    const entry = await findCreateEntry("web-dsh-npx", home);
    expect(entry?.source).toBe("wizard");
    expect(await findCreateEntry("no-such-key", home)).toBeUndefined();
  });
});

describe("readWizardProjectIcon", () => {
  it("reads the stable icon asset with its digest", async () => {
    const home = await mkdtemp(join(tmpdir(), "scan-test-"));
    const dir = join(home, ".opentray", "create", "web-dsh-npx");
    await writeWizardProject(dir);
    const icon = await readWizardProjectIcon(dir);
    expect(icon).toBeDefined();
    expect(icon?.bytes.byteLength).toBe(8);
    expect(icon?.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
