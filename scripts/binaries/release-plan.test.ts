import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveReleaseNativePlan } from "./release-plan";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("Feature: selective native release planner", () => {
  test("Scenario: Given no pending changesets When the planner runs Then native work is skipped", async () => {
    const root = await createTempChangesetDir();
    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("no pending changesets");
    expect(plan.jobs).toEqual([]);
  });

  test("Scenario: Given WebView pending changesets When the planner runs Then Lynx work is excluded", async () => {
    const root = await createTempChangeset(
      "webview.md",
      `---
"@opentray/ext-webview": patch
---
`,
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual(["webview"]);
    expect(plan.jobs).toHaveLength(6);
    expect(plan.jobs.every((job) => job.componentsCsv === "webview")).toBe(true);
    const artifactKinds = plan.stageEntries.flatMap((entry) => entry.artifactKinds);
    expect(artifactKinds).not.toContain("lynx");
    expect(artifactKinds).not.toContain("lynx-runtime");
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-webview-darwin-arm64",
      "packages/ext-webview-darwin-x64",
      "packages/ext-webview-linux-arm64",
      "packages/ext-webview-linux-x64",
      "packages/ext-webview-windows-arm64",
      "packages/ext-webview-windows-x64",
    ]);
  });

  test("Scenario: Given Lynx pending changesets When the planner runs Then only darwin native and runtime jobs remain", async () => {
    const root = await createTempChangeset(
      "lynx.md",
      `---
"@opentray/ext-lynx": patch
---
`,
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual(["lynx", "lynx-runtime"]);
    expect(plan.jobs.map((job) => job.target)).toEqual(["darwin-arm64", "darwin-x64"]);
    expect(plan.jobs.every((job) => job.buildsLynxRuntime)).toBe(true);
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-lynx-darwin-arm64",
      "packages/ext-lynx-darwin-x64",
    ]);
  });
});

async function createTempChangesetDir(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/opentray-release-plan-`);
  tempDirs.push(root);
  await mkdir(join(root, ".changeset"), { recursive: true });
  return root;
}

async function createTempChangeset(fileName: string, content: string): Promise<string> {
  const root = await createTempChangesetDir();
  await writeFile(join(root, ".changeset", fileName), content, "utf8");
  return root;
}
