import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveBrokerCommand,
  resolveDevBrokerBinaryPath,
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
  });

  it("prefers the workspace broker build over an installed platform package when running from source", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) =>
        `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBe("/repo");
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
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) =>
        `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBe("/repo");
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
      findWorkspaceRoot: async () => "/repo",
      ensureDevBrokerBinary: async (workspaceRoot) =>
        `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBe("/repo");
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
        findWorkspaceRoot: async () => undefined,
      })
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      packageName: "@opentray/linux-x64",
    });
  });

  it("targets only the workspace debug broker binary for Windows dev rebuild cleanup", () => {
    expect(resolveDevBrokerBinaryPath("E:/repo/opentray", "win32")).toBe(
      join("E:/repo/opentray", "target", "debug", "opentray.exe")
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
