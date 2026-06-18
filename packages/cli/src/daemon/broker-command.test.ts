import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { resolveBrokerCommand, resolveDevBrokerBinaryPath, resolveInstalledBrokerBinary } from "./broker-command";
import { MissingPlatformBrokerBinaryError, resolveBrokerNativeTarget } from "./native-target";
import { resolveDaemonPaths } from "./paths";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("broker command resolver", () => {
  it("uses OPENTRAY_BROKER_BIN before package and workspace resolution", async () => {
    const paths = resolveDaemonPaths({ homeDir: "/tmp/opentray-test", packageVersion: "0.1.0" });

    const command = await resolveBrokerCommand(paths, {
      env: { OPENTRAY_BROKER_BIN: "/custom/opentray" },
      platform: "darwin",
      arch: "arm64",
      resolvePackageJson: () => {
        throw new Error("package resolution should not run");
      },
      findWorkspaceRoot: async () => {
        throw new Error("workspace resolution should not run");
      },
    });

    expect(command.command).toBe("/custom/opentray");
    expect(command.cwd).toBeUndefined();
  });

  it("prefers the workspace broker build over an installed platform package when running from source", async () => {
    const packageJson = await createInstalledPackage("darwin", "arm64");
    const paths = resolveDaemonPaths({ homeDir: "/tmp/opentray-test", packageVersion: "0.1.0" });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolvePackageJson: () => packageJson,
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) => `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBe("/repo");
  });

  it("falls back to the workspace broker build when no installed package exists", async () => {
    const paths = resolveDaemonPaths({ homeDir: "/tmp/opentray-test", packageVersion: "0.1.0" });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "linux",
      arch: "x64",
      resolvePackageJson: () => undefined,
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) => `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBe("/repo");
  });

  it("falls back to the installed platform package outside a workspace", async () => {
    const packageJson = await createInstalledPackage("darwin", "arm64");
    const paths = resolveDaemonPaths({ homeDir: "/tmp/opentray-test", packageVersion: "0.1.0" });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolvePackageJson: () => packageJson,
      findWorkspaceRoot: async () => undefined,
    });

    const binary = join(packageJson, "..", "bin", "opentray");
    expect(command.command).toBe(binary);
    expect(command.cwd).toBeUndefined();
    if (process.platform !== "win32") {
      expect((await stat(binary)).mode & 0o777).toBe(0o755);
    }
  });

  it("falls back to workspace dev build when a workspace package has not staged its binary yet", async () => {
    const dir = await makeTempDir();
    const packageJson = join(dir, "package.json");
    await writeFile(packageJson, "{}\n", "utf8");
    const paths = resolveDaemonPaths({ homeDir: "/tmp/opentray-test", packageVersion: "0.1.0" });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolvePackageJson: () => packageJson,
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) => `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBe("/repo");
  });

  it("fails with a typed missing-platform-binary error outside a workspace", async () => {
    const paths = resolveDaemonPaths({ homeDir: "/tmp/opentray-test", packageVersion: "0.1.0" });

    await expect(
      resolveBrokerCommand(paths, {
        env: {},
        platform: "linux",
        arch: "x64",
        resolvePackageJson: () => undefined,
        findWorkspaceRoot: async () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      packageName: "@opentray/linux-x64",
    });
  });

  it("reports an installed package with a missing staged binary as a platform package error", async () => {
    const dir = await makeTempDir();
    const packageJson = join(dir, "package.json");
    await writeFile(packageJson, "{}\n", "utf8");

    await expect(
      resolveInstalledBrokerBinary({
        platform: "win32",
        arch: "x64",
        resolvePackageJson: () => packageJson,
      }),
    ).rejects.toBeInstanceOf(MissingPlatformBrokerBinaryError);
  });

  it("targets only the workspace debug broker binary for Windows dev rebuild cleanup", () => {
    expect(resolveDevBrokerBinaryPath("E:/repo/opentray", "win32")).toBe(
      join("E:/repo/opentray", "target", "debug", "opentray.exe"),
    );
  });
});

describe("broker native target", () => {
  it("maps node platform and arch values to optional package atoms", () => {
    expect(resolveBrokerNativeTarget("win32", "arm64")).toEqual({
      packageName: "@opentray/windows-arm64",
      binaryRelativePath: "bin/opentray.exe",
    });
  });
});

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/opentray-broker-command-test-`);
  tempDirs.push(dir);
  return dir;
};

const createInstalledPackage = async (platform: NodeJS.Platform, arch: string): Promise<string> => {
  const target = resolveBrokerNativeTarget(platform, arch);
  const dir = await makeTempDir();
  const binary = join(dir, target.binaryRelativePath);
  await mkdir(join(binary, ".."), { recursive: true });
  await writeFile(binary, "#!/bin/sh\n", "utf8");
  const packageJson = join(dir, "package.json");
  await writeFile(packageJson, "{}\n", "utf8");
  return packageJson;
};
