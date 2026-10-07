// add-create-kernel-upgrade BDD (plan D1–D6): version truth from node_modules,
// stop-before-upgrade, install-failure surface, already-up-to-date, restart
// folding the first-start observation, and dependency-family discovery.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { upgradeAppKernel, type RunKernelInstallInput } from "./kernel-upgrade";

interface Fixture {
  readonly dir: string;
  writeKernel: (versions: Readonly<Record<string, string>>) => Promise<void>;
}

const fixture = async (dependencies: Record<string, string>): Promise<Fixture> => {
  const dir = await mkdtemp(join(tmpdir(), "kernel-upgrade-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "upgrade-fixture", private: true, dependencies }, null, 2),
    "utf8",
  );
  await writeFile(join(dir, "package-lock.json"), "{}\n", "utf8");
  const writeKernel = async (versions: Readonly<Record<string, string>>): Promise<void> => {
    for (const [name, version] of Object.entries(versions)) {
      const pkgDir = join(dir, "node_modules", name);
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({ name, version }, null, 2),
        "utf8",
      );
    }
  };
  return { dir, writeKernel };
};

const noStop = {
  // Replace-semantics stop seam: finds nothing in these fixtures by design.
  findPids: async () => [],
};

describe("upgradeAppKernel", () => {
  it("stops live instances BEFORE running the install (D2)", async () => {
    const { dir } = await fixture({ opentray: "^0.34.0", "@opentray/ext-webview": "^0.34.0" });
    const order: string[] = [];
    const result = await upgradeAppKernel(dir, {
      probe: {
        findPids: async () => {
          order.push("stop");
          return [];
        },
      },
      runInstall: async () => {
        order.push("install");
        return { code: 0, output: "" };
      },
    });
    expect(order).toEqual(["stop", "install"]);
    expect(result.ok).toBe(true);
  });

  it("reports from/to version truth from node_modules, not the manifest (D3)", async () => {
    const { dir, writeKernel } = await fixture({
      opentray: "^0.34.0",
      "@opentray/ext-webview": "^0.34.0",
    });
    await writeKernel({ opentray: "0.34.1", "@opentray/ext-webview": "0.34.1" });
    const result = await upgradeAppKernel(dir, {
      probe: noStop,
      runInstall: async () => {
        await writeKernel({ opentray: "0.35.0", "@opentray/ext-webview": "0.35.0" });
        return { code: 0, output: "" };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.from).toEqual({ opentray: "0.34.1", "@opentray/ext-webview": "0.34.1" });
    expect(result.to).toEqual({ opentray: "0.35.0", "@opentray/ext-webview": "0.35.0" });
    expect(result.upgraded).toEqual(["opentray", "@opentray/ext-webview"]);
    expect(result.alreadyUpToDate).toBe(false);
    expect(result.packageManager).toBe("npm");
    expect(result.installTail).toBeUndefined();
  });

  it("installs every declared kernel package at the target spec with the lockfile runner (D1)", async () => {
    const { dir } = await fixture({ opentray: "*", "@opentray/ext-webview": "*" });
    const installs: RunKernelInstallInput[] = [];
    await upgradeAppKernel(dir, {
      probe: noStop,
      target: "0.36.0",
      runInstall: async (input) => {
        installs.push(input);
        return { code: 0, output: "" };
      },
    });
    expect(installs).toHaveLength(1);
    expect(installs[0]!.packageManager).toBe("npm");
    expect(installs[0]!.specs).toEqual(["opentray@0.36.0", "@opentray/ext-webview@0.36.0"]);
  });

  it("surfaces a bounded install-output tail on failure and claims no success (D5)", async () => {
    const { dir } = await fixture({ opentray: "^0.34.0" });
    const result = await upgradeAppKernel(dir, {
      probe: noStop,
      runInstall: async () => ({
        code: 1,
        output: `noise\n${"x".repeat(6000)}\nETARGET: version not found: opentray@9.9.9\n`,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exited with 1");
    expect(result.installTail).toBeDefined();
    expect(result.installTail!.length).toBeLessThanOrEqual(4096);
    expect(result.installTail).toContain("ETARGET");
    expect(result.installTail).not.toContain("noise");
  });

  it("reports alreadyUpToDate as a successful no-op when versions did not move (D6)", async () => {
    const { dir, writeKernel } = await fixture({ opentray: "^0.35.0" });
    await writeKernel({ opentray: "0.35.0" });
    const result = await upgradeAppKernel(dir, {
      probe: noStop,
      runInstall: async () => ({ code: 0, output: "" }),
    });
    expect(result.ok).toBe(true);
    expect(result.alreadyUpToDate).toBe(true);
    expect(result.upgraded).toEqual([]);
    expect(result.to).toEqual({ opentray: "0.35.0" });
  });

  it("rejects a project carrying no kernel packages", async () => {
    const { dir } = await fixture({ express: "^4.0.0" });
    const result = await upgradeAppKernel(dir, { probe: noStop });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no kernel packages");
  });

  it("folds the first-start observation into the restart result (D5)", async () => {
    const { dir } = await fixture({ opentray: "^0.34.0" });
    const result = await upgradeAppKernel(dir, {
      probe: noStop,
      restart: true,
      runInstall: async () => ({ code: 0, output: "" }),
    });
    expect(result.ok).toBe(true);
    // No descriptor, no bundle: the restart cold-starts the (absent) entry —
    // the open path reports what it did, upgrade success stays independent.
    expect(result.restart).toBeDefined();
    expect(result.restart!.detail).toContain("pid");
  });
});
