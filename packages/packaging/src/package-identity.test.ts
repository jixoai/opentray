// Orthogonal intents (updated 2026-07-21; original user request: package-derived
// paths must be stable and nested workspace commands must not replace the caller):
// 1. Prove scoped npm names use the documented `@scope+name` encoding.
// 2. Prove nearest package discovery does not depend on OpenTray's own module URL.
// 3. Prove the running script beats ambient nested-workspace package metadata.

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  encodeOpenTrayPackageName,
  resolveDefaultDarwinAppBundlePath,
  resolveOpenTrayPackageIdentity,
} from "./package-identity";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("OpenTray package identity", () => {
  it("encodes scoped names and keeps the app label as a sibling path component", () => {
    expect(encodeOpenTrayPackageName("@jixoai/skill-creator")).toBe("@jixoai+skill-creator");
    expect(
      resolveDefaultDarwinAppBundlePath({
        homeDir: "/Users/example",
        packageName: "@jixoai/skill-creator",
        appName: "Skill Creator",
      }),
    ).toBe("/Users/example/.opentray/apps/@jixoai+skill-creator/Skill Creator.app");
  });

  it("discovers the nearest consumer package manifest from the caller script", async () => {
    const root = await mkdtemp("/tmp/opentray-package-identity-");
    roots.push(root);
    const nested = join(root, "src/daemon");
    const scriptPath = join(nested, "main.mjs");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@jixoai/consumer" }));
    await writeFile(scriptPath, "export {};");

    const identity = await resolveOpenTrayPackageIdentity({ scriptPath });
    expect(identity).toEqual({
      name: "@jixoai/consumer",
      root,
      manifestPath: join(root, "package.json"),
    });
    await expect(readFile(identity.manifestPath, "utf8")).resolves.toContain("@jixoai/consumer");
  });

  it("prefers the default running script over nested workspace package-manager metadata", async () => {
    const root = await mkdtemp("/tmp/opentray-package-identity-");
    roots.push(root);
    const scriptPath = join(root, "src/daemon/main.ts");
    const workspaceManifest = join(root, "webui/package.json");
    await mkdir(join(root, "src/daemon"), { recursive: true });
    await mkdir(join(root, "webui"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "skill-creator" }));
    await writeFile(workspaceManifest, JSON.stringify({ name: "webui" }));
    await writeFile(scriptPath, "export {};");
    const previousScriptPath = process.argv[1];
    process.argv[1] = scriptPath;

    try {
      const identity = await resolveOpenTrayPackageIdentity({
        env: { npm_package_json: workspaceManifest },
      });
      expect(identity.name).toBe("skill-creator");
      expect(identity.manifestPath).toBe(join(root, "package.json"));
    } finally {
      if (previousScriptPath === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = previousScriptPath;
      }
    }
  });

  it("surfaces malformed nearest package manifests instead of treating them as missing", async () => {
    const root = await mkdtemp("/tmp/opentray-package-identity-");
    roots.push(root);
    const nested = join(root, "src");
    const scriptPath = join(nested, "main.mjs");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":');
    await writeFile(scriptPath, "export {};");

    await expect(resolveOpenTrayPackageIdentity({ scriptPath })).rejects.toMatchObject({
      code: "invalid_package_manifest",
    });
  });
});
