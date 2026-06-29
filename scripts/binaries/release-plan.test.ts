import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type PackageVersionRegistry,
  resolveReleaseNativePlan,
} from "./release-plan";

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

describe("Feature: selective native release planner", () => {
  test("Scenario: Given no pending changesets and no unpublished workspace versions When the planner runs Then native work is skipped", async () => {
    const root = await createTempWorkspace();
    const plan = await resolveReleaseNativePlan(root, publishedRegistry());

    expect(plan.enabled).toBe(false);
    expect(plan.publishEnabled).toBe(false);
    expect(plan.reason).toBe(
      "no pending changesets or unpublished workspace versions"
    );
    expect(plan.jobs).toEqual([]);
  });

  test("Scenario: Given WebView pending changesets When the planner runs Then Lynx work is excluded", async () => {
    const root = await createTempChangeset(
      "webview.md",
      `---
"@opentray/ext-webview": patch
---
`
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.publishEnabled).toBe(true);
    expect(plan.components).toEqual(["webview"]);
    expect(plan.jobs).toHaveLength(4);
    expect(plan.jobs.every((job) => job.componentsCsv === "webview")).toBe(
      true
    );
    expect(plan.jobs.map((job) => job.artifactName)).toContain(
      "native-darwin-arm64-webview"
    );
    const artifactKinds = plan.stageEntries.flatMap(
      (entry) => entry.artifactKinds
    );
    expect(artifactKinds).not.toContain("lynx");
    expect(artifactKinds).not.toContain("lynx-runtime");
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-webview-darwin-arm64",
      "packages/ext-webview-darwin-x64",
      "packages/ext-webview-windows-arm64",
      "packages/ext-webview-windows-x64",
    ]);
  });

  test("Scenario: Given no pending changesets but missing published package versions When the planner runs Then native recovery work is selected", async () => {
    const root = await createTempWorkspace();
    await writeManifest(root, "cli", {
      name: "opentray",
      version: "1.2.3",
    });
    await writeManifest(root, "ext-webview-darwin-arm64", {
      name: "@opentray/ext-webview-darwin-arm64",
      version: "1.2.3",
    });
    await writeManifest(root, "packaging", {
      name: "@opentray/packaging",
      version: "1.2.3",
    });

    const plan = await resolveReleaseNativePlan(
      root,
      publishedRegistry(new Set(["@opentray/packaging@1.2.3"]))
    );

    expect(plan.pendingChangesetFiles).toEqual([]);
    expect(plan.unpublishedWorkspacePackages).toEqual([
      "@opentray/ext-webview-darwin-arm64",
      "opentray",
    ]);
    expect(plan.publishEnabled).toBe(true);
    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual(["runtime", "webview"]);
    expect(plan.validatePackageDirs).toEqual([
      "packages/darwin-arm64",
      "packages/darwin-x64",
      "packages/ext-webview-darwin-arm64",
      "packages/ext-webview-darwin-x64",
      "packages/ext-webview-windows-arm64",
      "packages/ext-webview-windows-x64",
      "packages/linux-arm64",
      "packages/linux-x64",
      "packages/windows-arm64",
      "packages/windows-x64",
    ]);
  });

  test("Scenario: Given core runtime pending changesets When the planner runs Then Node runtime bindings are selected", async () => {
    const root = await createTempChangeset(
      "runtime.md",
      `---
"opentray": patch
---
`
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual(["runtime"]);
    expect(plan.jobs).toHaveLength(6);
    expect(plan.jobs.every((job) => job.componentsCsv === "runtime")).toBe(
      true
    );
    expect(
      plan.stageEntries.every((entry) =>
        entry.artifactKinds.includes("runtime")
      )
    ).toBe(true);
    expect(plan.validatePackageDirs).toEqual([
      "packages/darwin-arm64",
      "packages/darwin-x64",
      "packages/linux-arm64",
      "packages/linux-x64",
      "packages/windows-arm64",
      "packages/windows-x64",
    ]);
  });

  test("Scenario: Given Lynx pending changesets When the planner runs Then only darwin native and runtime jobs remain", async () => {
    const root = await createTempChangeset(
      "lynx.md",
      `---
"@opentray/ext-lynx": patch
---
`
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual(["lynx", "lynx-runtime"]);
    expect(plan.jobs.map((job) => job.artifactName)).toEqual([
      "native-darwin-arm64-lynx",
      "native-darwin-x64-lynx",
      "native-darwin-arm64-lynx-runtime",
      "native-darwin-x64-lynx-runtime",
    ]);
    expect(
      plan.jobs
        .filter((job) => job.componentsCsv === "lynx")
        .every((job) => job.buildsLynxRuntime)
    ).toBe(false);
    expect(
      plan.jobs
        .filter((job) => job.componentsCsv === "lynx-runtime")
        .every((job) => job.buildsLynxRuntime)
    ).toBe(true);
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-lynx-darwin-arm64",
      "packages/ext-lynx-darwin-x64",
    ]);
  });

  test("Scenario: Given badge pending changesets When the planner runs Then macOS and Windows badge package dirs are validated", async () => {
    const root = await createTempChangeset(
      "badge.md",
      `---
"@opentray/ext-badge": patch
---
`
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual(["badge"]);
    expect(plan.jobs.map((job) => job.artifactName)).toEqual([
      "native-darwin-arm64-badge",
      "native-darwin-x64-badge",
      "native-windows-arm64-badge",
      "native-windows-x64-badge",
    ]);
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-badge-darwin-arm64",
      "packages/ext-badge-darwin-x64",
      "packages/ext-badge-windows-arm64",
      "packages/ext-badge-windows-x64",
    ]);
  });

  test("Scenario: Given line-wide native changesets When the planner runs Then sibling extensions compile in separate jobs", async () => {
    const root = await createTempChangeset(
      "line.md",
      `---
"opentray": minor
"@opentray/ext-webview": minor
"@opentray/ext-badge": minor
"@opentray/ext-lynx": minor
---
`
    );

    const plan = await resolveReleaseNativePlan(root);

    expect(plan.enabled).toBe(true);
    expect(plan.components).toEqual([
      "runtime",
      "webview",
      "badge",
      "lynx",
      "lynx-runtime",
    ]);
    expect(plan.jobs.every((job) => job.components.length === 1)).toBe(true);
    expect(
      plan.jobs.some(
        (job) =>
          job.components.includes("webview") && job.components.includes("lynx")
      )
    ).toBe(false);
    expect(new Set(plan.jobs.map((job) => job.artifactName)).size).toBe(
      plan.jobs.length
    );
    expect(
      plan.stageEntries.every((entry) => entry.artifactName.startsWith("native-"))
    ).toBe(true);
  });
});

interface TestManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
}

function publishedRegistry(
  publishedVersions: ReadonlySet<string> = new Set()
): PackageVersionRegistry {
  return {
    versionExists: async (name, version) =>
      publishedVersions.size === 0 || publishedVersions.has(`${name}@${version}`),
  };
}

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/opentray-release-plan-`);
  tempDirs.push(root);
  await mkdir(join(root, ".changeset"), { recursive: true });
  await mkdir(join(root, "packages"), { recursive: true });
  return root;
}

async function createTempChangeset(
  fileName: string,
  content: string
): Promise<string> {
  const root = await createTempWorkspace();
  await writeFile(join(root, ".changeset", fileName), content, "utf8");
  return root;
}

async function writeManifest(
  root: string,
  dirName: string,
  manifest: TestManifest
): Promise<void> {
  const dir = join(root, "packages", dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}
