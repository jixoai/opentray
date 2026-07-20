// Orthogonal intents (2026-07-20; original user request: package-derived paths
// must be stable and explicit paths must resolve from the caller package root):
// 1. Prove scoped npm names use the documented `@scope+name` encoding.
// 2. Prove nearest package discovery does not depend on OpenTray's own module URL.

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

  it("surfaces malformed nearest package manifests instead of treating them as missing", async () => {
    const root = await mkdtemp("/tmp/opentray-package-identity-");
    roots.push(root);
    const nested = join(root, "src");
    const scriptPath = join(nested, "main.mjs");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "package.json"), "{\"name\":");
    await writeFile(scriptPath, "export {};");

    await expect(resolveOpenTrayPackageIdentity({ scriptPath })).rejects.toMatchObject({
      code: "invalid_package_manifest",
    });
  });
});
