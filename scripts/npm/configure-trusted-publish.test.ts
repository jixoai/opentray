import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverPackages } from "./configure-trusted-publish";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("Feature: trusted publisher package discovery", () => {
  test("Scenario: Given package directories without manifests When packages are discovered Then only public workspace packages are configured", async () => {
    const root = await createWorkspace();
    await writeManifest(root, "cli", { name: "opentray" });
    await writeManifest(root, "ext-webview", { name: "@opentray/ext-webview" });
    await writeManifest(root, "internal", {
      name: "@opentray/internal",
      private: true,
    });
    await mkdir(join(root, "packages", "ext-webview-linux-x64"), {
      recursive: true,
    });

    await expect(discoverPackages(root)).resolves.toEqual([
      "@opentray/ext-webview",
      "opentray",
    ]);
  });
});

interface TestManifest {
  readonly name: string;
  readonly private?: boolean;
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/opentray-trusted-publish-`);
  tempDirs.push(root);
  await mkdir(join(root, "packages"), { recursive: true });
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
