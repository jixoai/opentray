import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveVerifyNativePlan } from "./verify-native-plan";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        force: true,
        recursive: true,
      })
    )
  );
});

describe("Feature: native verification planner", () => {
  test("Scenario: Given no scoped release intent When the plan is resolved Then all native atoms remain verified independently", async () => {
    const root = await createTempWorkspace();
    const plan = await resolveVerifyNativePlan(root);

    expect(plan.jobs.every((job) => job.components.length === 1)).toBe(true);
    expect(new Set(plan.jobs.map((job) => job.artifactName)).size).toBe(
      plan.jobs.length
    );
    expect(
      plan.stageEntries.every((entry) => entry.artifactName.startsWith("native-"))
    ).toBe(true);
  });

  test("Scenario: Given pending runtime and extension changesets When the plan is resolved Then requested native atoms remain independent", async () => {
    const root = await createTempWorkspace();
    await writeFile(
      join(root, ".changeset", "release.md"),
      `---
"opentray": patch
"@opentray/ext-webview": patch
"@opentray/ext-badge": patch
---
`
    );

    const plan = await resolveVerifyNativePlan(root);

    expect(plan.components).toEqual(["runtime", "webview", "badge"]);
    expect(plan.jobs.every((job) => job.components.length === 1)).toBe(true);
    expect(plan.validatePackageDirs).toContain("packages/ext-webview-darwin-arm64");
    expect(plan.validatePackageDirs).toContain("packages/ext-badge-darwin-arm64");
  });

  test("Scenario: Given a pending embedded dialog changeset When the plan is resolved Then the four dialog matrix jobs stage into one facade dir", async () => {
    const root = await createTempWorkspace();
    await writeFile(
      join(root, ".changeset", "release.md"),
      `---
"@opentray/ext-dialog": patch
---
`
    );

    const plan = await resolveVerifyNativePlan(root);

    expect(plan.components).toEqual(["dialog"]);
    expect(plan.jobs.map((job) => job.target)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "windows-arm64",
      "windows-x64",
    ]);
    expect(
      plan.jobs.every((job) => job.artifactName === `native-${job.target}-dialog`)
    ).toBe(true);
    expect(plan.validatePackageDirs).toEqual(["packages/ext-dialog"]);
    // Embedded pack evidence gate sees dialog in the stage plan.
    expect(
      plan.stageEntries.some((entry) => entry.artifactKinds.includes("dialog"))
    ).toBe(true);
    expect(plan.embeddedPackages).toEqual(["packages/ext-dialog"]);
  });

  test("Scenario: Given a pending embedded sound changeset When the plan is resolved Then the mirrored sound matrix stages generically", async () => {
    const root = await createTempWorkspace();
    await writeFile(
      join(root, ".changeset", "release.md"),
      `---
"@opentray/ext-sound": patch
---
`
    );

    const plan = await resolveVerifyNativePlan(root);

    expect(plan.components).toEqual(["sound"]);
    expect(
      plan.jobs.every((job) => job.artifactName === `native-${job.target}-sound`)
    ).toBe(true);
    expect(plan.validatePackageDirs).toEqual(["packages/ext-sound"]);
    // The embedded pack-evidence input is derived from staged kinds, not a
    // hardcoded extension name (add-ext-sound task 5.1).
    expect(plan.embeddedPackages).toEqual(["packages/ext-sound"]);
  });
});

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opentray-verify-native-plan-"));
  tempDirs.push(root);
  await mkdir(join(root, ".changeset"), { recursive: true });
  await writeFile(
    join(root, ".changeset", "config.json"),
    JSON.stringify(
      {
        fixed: [
          [
            "opentray",
            "@opentray/ext-webview",
            "@opentray/ext-badge",
            "@opentray/ext-webview-darwin-arm64",
            "@opentray/ext-webview-darwin-x64",
            "@opentray/ext-webview-windows-arm64",
            "@opentray/ext-webview-windows-x64",
            "@opentray/ext-badge-darwin-arm64",
            "@opentray/ext-badge-darwin-x64",
            "@opentray/ext-badge-windows-arm64",
            "@opentray/ext-badge-windows-x64",
          ],
        ],
      },
      null,
      2
    )
  );
  return root;
}
