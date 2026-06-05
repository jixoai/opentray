import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePreviewBuildMarker, resolvePreviewBuildPlan } from "./preview-plan";

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

describe("Feature: changeset-gated preview build planner", () => {
  test("Scenario: Given changed changeset without marker When the planner runs Then it no-ops", async () => {
    const root = await createTempChangeset(
      "webview.md",
      `---
"@opentray/ext-webview": patch
---

No preview build requested yet.
`,
    );

    await expect(
      resolvePreviewBuildPlan({
        root,
        changedFiles: [".changeset/webview.md"],
      }),
    ).resolves.toMatchObject({
      enabled: false,
      reason: "no changed changeset contained opentray-preview marker",
    });
  });

  test("Scenario: Given changed WebView changeset with alias When the planner runs Then it infers ext-webview-native only", async () => {
    const root = await createTempChangeset(
      "webview.md",
      `---
"opentray": patch
"@opentray/ext-webview": patch
---

<!-- opentray-preview {"alias":"webview-20260605-1"} -->
`,
    );

    const plan = await resolvePreviewBuildPlan({
      root,
      changedFiles: [".changeset/webview.md"],
    });

    expect(plan.enabled).toBe(true);
    expect(plan.alias).toBe("webview-20260605-1");
    expect(plan.families).toEqual(["ext-webview-native"]);
    expect(plan.targets).toEqual(["darwin-arm64"]);
    expect(plan.jobs.map((job) => job.family)).toEqual(["ext-webview-native"]);
  });

  test("Scenario: Given explicit invalid family in marker When the marker is parsed Then the error is explicit", () => {
    expect(() =>
      parsePreviewBuildMarker(
        `<!-- opentray-preview {"alias":"bad","families":["unknown-family"]} -->`,
      ),
    ).toThrow("unsupported preview build family in opentray-preview: unknown-family");
  });

  test("Scenario: Given two changed marked changesets When the planner runs Then it fails explicitly", async () => {
    const root = await createTempChangeset(
      "one.md",
      `---
"@opentray/ext-webview": patch
---

<!-- opentray-preview {"alias":"one"} -->
`,
    );
    await writeFile(
      join(root, ".changeset", "two.md"),
      `---
"@opentray/ext-webview": patch
---

<!-- opentray-preview {"alias":"two"} -->
`,
      "utf8",
    );

    await expect(
      resolvePreviewBuildPlan({
        root,
        changedFiles: [".changeset/one.md", ".changeset/two.md"],
      }),
    ).rejects.toThrow("multiple changed changesets requested preview builds");
  });

  test("Scenario: Given manual dispatch inputs When the planner runs Then it uses the same family validation path", async () => {
    const plan = await resolvePreviewBuildPlan({
      manualAlias: "manual-webview-1",
      manualFamilies: ["ext-webview-native"],
      manualTargets: ["darwin-arm64"],
      manualSmokes: ["daemon-tray"],
    });

    expect(plan.source).toBe("manual");
    expect(plan.enabled).toBe(true);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.smokes).toEqual(["daemon-tray"]);
  });
});

async function createTempChangeset(fileName: string, content: string): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/opentray-preview-plan-`);
  tempDirs.push(root);
  await mkdir(join(root, ".changeset"), { recursive: true });
  await Bun.write(join(root, ".changeset", fileName), content);
  return root;
}
