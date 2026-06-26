import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  MissingPlatformRuntimeBindingError,
  loadOpenTrayRuntimeBinding,
  resolveInstalledRuntimeBindingPath,
  resolveRuntimeNativeTarget,
} from "./native-runtime";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("Feature: host-process native runtime binding resolution", () => {
  it("Scenario: Given an installed platform package When resolving the runtime binding Then the .node artifact path is returned", async () => {
    const packageJson = await createInstalledPackage("darwin", "arm64");

    await expect(
      resolveInstalledRuntimeBindingPath({
        platform: "darwin",
        arch: "arm64",
        resolvePackageJson: () => packageJson,
      })
    ).resolves.toBe(
      join(packageJson, "..", "runtime", "opentray_runtime.node")
    );
  });

  it("Scenario: Given no platform package When resolving the runtime binding Then a typed package error is raised", async () => {
    await expect(
      resolveInstalledRuntimeBindingPath({
        platform: "linux",
        arch: "x64",
        resolvePackageJson: () => undefined,
      })
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_RUNTIME_BINDING",
      packageName: "@opentray/linux-x64",
    });
  });

  it("Scenario: Given a package without a staged binding When resolving Then missing artifact is explicit", async () => {
    const dir = await makeTempDir();
    const packageJson = join(dir, "package.json");
    await writeFile(packageJson, "{}\n", "utf8");

    await expect(
      resolveInstalledRuntimeBindingPath({
        platform: "win32",
        arch: "x64",
        resolvePackageJson: () => packageJson,
      })
    ).rejects.toBeInstanceOf(MissingPlatformRuntimeBindingError);
  });

  it("Scenario: Given a malformed native module When loading Then the runtime contract fails closed", async () => {
    const packageJson = await createInstalledPackage("darwin", "arm64");

    await expect(
      loadOpenTrayRuntimeBinding({
        platform: "darwin",
        arch: "arm64",
        resolvePackageJson: () => packageJson,
        nativeLoader: () => ({}),
      })
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_RUNTIME_BINDING",
    });
  });

  it("Scenario: Given Node platform values When target is resolved Then package and binding paths are stable", () => {
    expect(resolveRuntimeNativeTarget("win32", "arm64")).toEqual({
      packageName: "@opentray/windows-arm64",
      bindingRelativePath: "runtime/opentray_runtime.node",
    });
  });
});

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/opentray-runtime-binding-test-`);
  tempDirs.push(dir);
  return dir;
};

const createInstalledPackage = async (
  platform: NodeJS.Platform,
  arch: string
): Promise<string> => {
  const target = resolveRuntimeNativeTarget(platform, arch);
  const dir = await makeTempDir();
  const binding = join(dir, target.bindingRelativePath);
  await mkdir(join(binding, ".."), { recursive: true });
  await writeFile(binding, "", "utf8");
  const packageJson = join(dir, "package.json");
  await writeFile(packageJson, "{}\n", "utf8");
  return packageJson;
};
