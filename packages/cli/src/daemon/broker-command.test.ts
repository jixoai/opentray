import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveBrokerCommand,
  resolveDevBrokerBinaryPath,
  resolveInstalledBrokerBinary,
} from "./broker-command";
import { resolveBrokerNativeTarget } from "./native-target";
import { resolveDaemonPaths } from "./paths";

describe("broker command resolver", () => {
  it("uses OPENTRAY_BROKER_BIN before package and workspace resolution", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: { OPENTRAY_BROKER_BIN: "/custom/opentray" },
      platform: "darwin",
      arch: "arm64",
      findWorkspaceRoot: async () => {
        throw new Error("workspace resolution should not run");
      },
    });

    expect(command.command).toBe("/custom/opentray");
    expect(command.cwd).toBeUndefined();
    expect(command.args).toContain("--app-id");
    expect(command.args).toContain(paths.appId);
    expect(command.args).toContain("--app-name");
    expect(command.args).toContain(paths.appName);
  });

  it("prefers the installed platform package before workspace fallback", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolveInstalledBrokerBinary: async (target) => ({
        binary: `/node_modules/${target.packageName}/bin/opentray`,
        binaryPath: `/node_modules/${target.packageName}/bin/opentray`,
      }),
      findWorkspaceRoot: async () => {
        throw new Error("workspace resolution should not run");
      },
    });

    expect(command.command).toBe(
      "/node_modules/@opentray/darwin-arm64/bin/opentray"
    );
    expect(command.cwd).toBeUndefined();
  });

  it("falls back to the workspace broker build when no installed package exists", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "linux",
      arch: "x64",
      resolveInstalledBrokerBinary: async () => ({}),
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) =>
        `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBeUndefined();
  });

  it("falls back to workspace dev build when a workspace package has not staged its binary yet", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolveInstalledBrokerBinary: async () => ({
        binaryPath: "/repo/packages/darwin-arm64/bin/opentray",
      }),
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) =>
        `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBeUndefined();
  });

  it("fails with a typed missing-platform-binary error outside a workspace", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    await expect(
      resolveBrokerCommand(paths, {
        env: {},
        platform: "linux",
        arch: "x64",
        resolveInstalledBrokerBinary: async () => ({}),
        findWorkspaceRoot: async () => undefined,
      })
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      packageName: "@opentray/linux-x64",
    });
  });

  it("reports the expected binary path when the installed package exists but is not staged", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    await expect(
      resolveBrokerCommand(paths, {
        env: {},
        platform: "darwin",
        arch: "arm64",
        resolveInstalledBrokerBinary: async () => ({
          binaryPath: "/node_modules/@opentray/darwin-arm64/bin/opentray",
        }),
        findWorkspaceRoot: async () => undefined,
      })
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      packageName: "@opentray/darwin-arm64",
      binaryPath: "/node_modules/@opentray/darwin-arm64/bin/opentray",
    });
  });

  it("targets only the workspace debug broker binary for Windows dev rebuild cleanup", () => {
    expect(resolveDevBrokerBinaryPath("E:/repo/opentray", "win32")).toBe(
      join("E:/repo/opentray", "target", "debug", "opentray.exe")
    );
  });
});

describe("installed broker package resolution", () => {
  it("derives the binary path from the resolved package root", async () => {
    const result = await resolveInstalledBrokerBinary(
      {
        packageName: "@opentray/darwin-arm64",
        binaryRelativePath: "bin/opentray",
      },
      {
        platform: "darwin",
        resolvePackageJson: () =>
          "/node_modules/@opentray/darwin-arm64/package.json",
        assertBinaryAccessible: async () => {},
      }
    );

    expect(result).toEqual({
      binary: "/node_modules/@opentray/darwin-arm64/bin/opentray",
      binaryPath: "/node_modules/@opentray/darwin-arm64/bin/opentray",
    });
  });

  it("returns the expected binary path when the package exists but the binary is missing", async () => {
    const result = await resolveInstalledBrokerBinary(
      {
        packageName: "@opentray/darwin-arm64",
        binaryRelativePath: "bin/opentray",
      },
      {
        platform: "darwin",
        resolvePackageJson: () =>
          "/node_modules/@opentray/darwin-arm64/package.json",
        assertBinaryAccessible: async () => {
          throw errno("ENOENT");
        },
      }
    );

    expect(result).toEqual({
      binaryPath: "/node_modules/@opentray/darwin-arm64/bin/opentray",
    });
  });

  it("returns no binary when the platform package is not installed", async () => {
    const result = await resolveInstalledBrokerBinary(
      {
        packageName: "@opentray/darwin-arm64",
        binaryRelativePath: "bin/opentray",
      },
      {
        platform: "darwin",
        resolvePackageJson: () => {
          throw errno("MODULE_NOT_FOUND");
        },
      }
    );

    expect(result).toEqual({});
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

const errno = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code });
