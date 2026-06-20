import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProtocolDistTagPlan } from "./protocol-dist-tags";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("Feature: protocol-line npm dist-tag planner", () => {
  test("Scenario: Given public workspace packages When stable plan is resolved Then one extension-agnostic protocol-line tag is applied to all packages", async () => {
    const root = await createWorkspace({
      opentray: { name: "opentray", version: "0.5.1" },
      "ext-webview": { name: "@opentray/ext-webview", version: "0.4.0" },
      "ext-lynx": { name: "@opentray/ext-lynx", version: "0.1.2" },
    });

    const plan = await resolveProtocolDistTagPlan({
      root,
      channel: "stable",
      apply: false,
      packages: [],
    });

    expect(plan.dryRun).toBe(true);
    expect(plan.protocolLine).toBe("opentray-protocol/1.1");
    expect(plan.tag).toBe("stable-1-1");
    expect(plan.entries.map((entry) => entry.packageName)).toEqual([
      "@opentray/ext-lynx",
      "@opentray/ext-webview",
      "opentray",
    ]);
    expect(plan.entries.every((entry) => entry.tag === "stable-1-1")).toBe(true);
    expect(plan.entries.map((entry) => entry.command.join(" "))).toEqual([
      "npm dist-tag add @opentray/ext-lynx@0.1.2 stable-1-1",
      "npm dist-tag add @opentray/ext-webview@0.4.0 stable-1-1",
      "npm dist-tag add opentray@0.5.1 stable-1-1",
    ]);
  });

  test("Scenario: Given alpha channel When plan is resolved Then alpha is only a release channel over the same protocol line", async () => {
    const root = await createWorkspace({
      opentray: { name: "opentray", version: "0.5.1" },
    });

    const plan = await resolveProtocolDistTagPlan({
      root,
      channel: "alpha",
      apply: false,
      packages: ["opentray"],
    });

    expect(plan.channel).toBe("alpha");
    expect(plan.protocolLine).toBe("opentray-protocol/1.1");
    expect(plan.tag).toBe("alpha-1-1");
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.command).toEqual([
      "npm",
      "dist-tag",
      "add",
      "opentray@0.5.1",
      "alpha-1-1",
    ]);
  });

  test("Scenario: Given private packages When plan is resolved Then private packages are ignored", async () => {
    const root = await createWorkspace({
      opentray: { name: "opentray", version: "0.5.1" },
      hidden: { name: "@opentray/hidden", version: "0.0.0", private: true },
    });

    const plan = await resolveProtocolDistTagPlan({
      root,
      channel: "stable",
      apply: false,
      packages: [],
    });

    expect(plan.entries.map((entry) => entry.packageName)).toEqual(["opentray"]);
  });

  test("Scenario: Given unknown package filter When plan is resolved Then the error is explicit", async () => {
    const root = await createWorkspace({
      opentray: { name: "opentray", version: "0.5.1" },
    });

    await expect(
      resolveProtocolDistTagPlan({
        root,
        channel: "stable",
        apply: false,
        packages: ["@opentray/missing"],
      }),
    ).rejects.toThrow("package is not a public workspace package: @opentray/missing");
  });
});

interface TestManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
}

async function createWorkspace(packages: Record<string, TestManifest>): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/opentray-protocol-tags-`);
  tempDirs.push(root);
  await mkdir(join(root, "packages"), { recursive: true });
  for (const [dirName, manifest] of Object.entries(packages)) {
    const dir = join(root, "packages", dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return root;
}
