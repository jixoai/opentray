import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveBrokerArtifact,
  resolveBrokerCommand,
  resolveDevBrokerBinaryPath,
  resolveInstalledBrokerBinary,
} from "./broker-command";
import { resolveBrokerNativeTarget } from "./native-target";
import { resolveDaemonPaths } from "./paths";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

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

  it("wraps an explicit Darwin broker in the caller app bundle when appBundle is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-broker-explicit-darwin-"));
    tempDirs.push(root);
    const brokerPath = join(root, "target/debug/opentray");
    const templatePath = join(root, "packages/darwin-app-carrier/Info.plist");
    await mkdir(dirname(brokerPath), { recursive: true });
    await mkdir(dirname(templatePath), { recursive: true });
    await writeFile(brokerPath, "source-broker", "utf8");
    await writeFile(templatePath, template(), "utf8");
    const paths = resolveDaemonPaths({
      homeDir: join(root, "home"),
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: { OPENTRAY_BROKER_BIN: brokerPath },
      platform: "darwin",
      arch: "arm64",
      findWorkspaceRoot: async () => root,
      ensureDevDarwinCarrierTemplate: async () => templatePath,
      appBundle: { path: join(root, "home/.opentray/apps/opentray/Test.app") },
    });

    // mkdtemp returns the /var symlink form while parts of the resolver
    // canonicalize through realpath on macOS (/private/var) — compare both
    // sides canonically.
    const expected = join(
      root,
      "home/.opentray/apps/opentray/Test.app/Contents/MacOS/opentray",
    );
    expect(await realpath(command.command)).toBe(await realpath(expected));
    expect(await readFile(command.command, "utf8")).toBe("source-broker");
  }, 120_000);

  it("hashes one exact resolved broker executable into its launch identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-broker-artifact-"));
    tempDirs.push(root);
    const executablePath = join(root, "opentray");
    await writeFile(executablePath, "current-broker", "utf8");
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const broker = await resolveBrokerArtifact(paths, {
      env: { OPENTRAY_BROKER_BIN: executablePath },
      platform: "darwin",
      arch: "arm64",
    });

    const hash = createHash("sha256").update("current-broker").digest("hex");
    expect(broker.executablePath).toBe(await realpath(executablePath));
    expect(broker.artifactIdentity).toEqual({
      packageVersion: "0.1.0",
      target: { os: "darwin", arch: "arm64" },
      executableHash: hash,
      buildIdentity: `sha256:${hash.slice(0, 16)}`,
    });
    expect(broker.args).toContain("--broker-artifact-identity");
  });

  it("prefers the installed platform package before workspace fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-broker-installed-"));
    tempDirs.push(root);
    const brokerPath = join(root, "bin/opentray");
    const templatePath = join(root, "app/Info.plist");
    await mkdir(dirname(brokerPath), { recursive: true });
    await mkdir(dirname(templatePath), { recursive: true });
    await writeFile(brokerPath, "broker", "utf8");
    await writeFile(templatePath, template(), "utf8");
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolveInstalledBrokerBinary: async (target) => ({
        binary: brokerPath,
        binaryPath: brokerPath,
        carrierTemplate: templatePath,
        carrierTemplatePath: templatePath,
      }),
      appBundle: { path: join(root, "Skill Creator.app") },
      findWorkspaceRoot: async () => {
        throw new Error("workspace resolution should not run");
      },
    });

    expect(command.command).toBe(join(root, "Skill Creator.app/Contents/MacOS/opentray"));
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
      ensureDevBrokerBinary: async (workspaceRoot) => `${workspaceRoot}/target/debug/opentray`,
    });

    expect(command.command).toBe("/repo/target/debug/opentray");
    expect(command.cwd).toBeUndefined();
  });

  it("falls back to workspace dev build when a workspace package has not staged its binary yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-broker-source-"));
    tempDirs.push(root);
    const brokerPath = join(root, "target/debug/opentray");
    const templatePath = join(root, "packages/darwin-app-carrier/Info.plist");
    await mkdir(dirname(brokerPath), { recursive: true });
    await mkdir(dirname(templatePath), { recursive: true });
    await writeFile(brokerPath, "broker", "utf8");
    await writeFile(templatePath, template(), "utf8");
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    const command = await resolveBrokerCommand(paths, {
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolveInstalledBrokerBinary: async () => ({
        binaryPath: brokerPath,
      }),
      findWorkspaceRoot: async () => root,
      ensureDevBrokerBinary: async () => brokerPath,
      ensureDevDarwinCarrierTemplate: async () => templatePath,
      appBundle: { path: join(root, "Skill Creator.app") },
    });

    expect(command.command).toBe(join(root, "Skill Creator.app/Contents/MacOS/opentray"));
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
      }),
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      packageName: "@opentray/linux-x64",
    });
  });

  it("rejects an installed Darwin broker whose carrier template is missing", async () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-test",
      packageVersion: "0.1.0",
    });

    await expect(
      resolveBrokerCommand(paths, {
        env: {},
        platform: "darwin",
        arch: "x64",
        resolveInstalledBrokerBinary: async () => ({
          binary: "/node_modules/@opentray/darwin-x64/bin/opentray",
          binaryPath: "/node_modules/@opentray/darwin-x64/bin/opentray",
          carrierTemplatePath: "/node_modules/@opentray/darwin-x64/app/Info.plist",
        }),
        appBundle: { path: "/runtime/OpenTray.app" },
      }),
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      platform: "darwin",
      arch: "x64",
      packageName: "@opentray/darwin-x64",
      binaryPath: "/node_modules/@opentray/darwin-x64/app/Info.plist",
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
      }),
    ).rejects.toMatchObject({
      code: "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY",
      packageName: "@opentray/darwin-arm64",
      binaryPath: "/node_modules/@opentray/darwin-arm64/bin/opentray",
    });
  });

  it("uses caller-scoped Windows target directories without terminating sibling brokers", () => {
    expect(resolveDevBrokerBinaryPath("E:/repo/opentray", "win32", "caller-a")).toBe(
      join("E:/repo/opentray", "target", "opentray-source", "caller-a", "debug", "opentray.exe"),
    );
  });
});

describe("installed broker package resolution", () => {
  it("derives the binary path from the resolved package root", async () => {
    const packageJsonPath = "/node_modules/@opentray/darwin-arm64/package.json";
    const binaryPath = join(dirname(packageJsonPath), "bin/opentray");
    const result = await resolveInstalledBrokerBinary(
      {
        packageName: "@opentray/darwin-arm64",
        binaryRelativePath: "bin/opentray",
        carrierTemplateRelativePath: "app/Info.plist",
      },
      {
        platform: "darwin",
        resolvePackageJson: () => packageJsonPath,
        assertBinaryAccessible: async () => {},
        assertCarrierAccessible: async () => {},
      },
    );

    expect(result).toEqual({
      binary: binaryPath,
      binaryPath,
      carrierTemplate: join(dirname(packageJsonPath), "app/Info.plist"),
      carrierTemplatePath: join(dirname(packageJsonPath), "app/Info.plist"),
    });
  });

  it("returns the expected binary path when the package exists but the binary is missing", async () => {
    const packageJsonPath = "/node_modules/@opentray/darwin-arm64/package.json";
    const binaryPath = join(dirname(packageJsonPath), "bin/opentray");
    const result = await resolveInstalledBrokerBinary(
      {
        packageName: "@opentray/darwin-arm64",
        binaryRelativePath: "bin/opentray",
        carrierTemplateRelativePath: "app/Info.plist",
      },
      {
        platform: "darwin",
        resolvePackageJson: () => packageJsonPath,
        assertBinaryAccessible: async () => {
          throw errno("ENOENT");
        },
        assertCarrierAccessible: async () => {},
      },
    );

    expect(result).toEqual({
      binaryPath,
      carrierTemplate: join(dirname(packageJsonPath), "app/Info.plist"),
      carrierTemplatePath: join(dirname(packageJsonPath), "app/Info.plist"),
    });
  });

  it("returns no binary when the platform package is not installed", async () => {
    const result = await resolveInstalledBrokerBinary(
      {
        packageName: "@opentray/darwin-arm64",
        binaryRelativePath: "bin/opentray",
        carrierTemplateRelativePath: "app/Info.plist",
      },
      {
        platform: "darwin",
        resolvePackageJson: () => {
          throw errno("MODULE_NOT_FOUND");
        },
      },
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
    expect(resolveBrokerNativeTarget("darwin", "arm64")).toEqual({
      packageName: "@opentray/darwin-arm64",
      binaryRelativePath: "bin/opentray",
      carrierTemplateRelativePath: "app/Info.plist",
    });
  });
});

describe("darwin bundle default app icon", () => {
  const materialize = async (root: string, options: {
    appName?: string;
    appIcon?: import("@opentray/spec").AppIcon;
    appBundle?: import("@opentray/packaging").OpenTrayAppBundleOptions;
  } = {}) => {
    const brokerPath = join(root, "target/debug/opentray");
    const templatePath = join(root, "packages/darwin-app-carrier/Info.plist");
    await mkdir(dirname(brokerPath), { recursive: true });
    await mkdir(dirname(templatePath), { recursive: true });
    await writeFile(brokerPath, "source-broker", "utf8");
    await writeFile(templatePath, template(), "utf8");
    const paths = resolveDaemonPaths({
      homeDir: join(root, "home"),
      packageVersion: "0.1.0",
      ...(options.appName === undefined ? {} : { appName: options.appName }),
    });
    const command = await resolveBrokerCommand(paths, {
      env: { OPENTRAY_BROKER_BIN: brokerPath },
      platform: "darwin",
      arch: "arm64",
      findWorkspaceRoot: async () => root,
      ensureDevDarwinCarrierTemplate: async () => templatePath,
      appBundle: {
        path: join(root, "home/.opentray/apps/opentray/Notes.app"),
        ...(options.appBundle ?? {}),
      },
      ...(options.appIcon === undefined ? {} : { appIcon: options.appIcon }),
    });
    return { command, paths };
  };

  const icnsMagicOf = async (path: string): Promise<string> => {
    const bytes = await readFile(path);
    return String.fromCharCode(...bytes.subarray(0, 4));
  };

  it("synthesizes the glyph default icon when appIcon is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-default-icon-"));
    tempDirs.push(root);
    const { command } = await materialize(root, { appName: "Notes App" });
    const bundle = join(root, "home/.opentray/apps/opentray/Notes.app");
    const iconPath = join(bundle, "Contents/Resources/AppIcon.icns");
    expect(await icnsMagicOf(iconPath)).toBe("icns");
    const plist = await readFile(join(bundle, "Contents/Info.plist"), "utf8");
    expect(plist).toContain("AppIcon.icns");
    expect(plist).toContain("Notes App");
    const manifest = JSON.parse(
      await readFile(join(bundle, "Contents/Resources/opentray-app-bundle.json"), "utf8"),
    );
    expect(manifest.icon).toBeDefined();
    expect(command.command).toContain("Notes.app");
  }, 120_000);

  it("reuses the cached default icon across repeated materializations", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-default-icon-cache-"));
    tempDirs.push(root);
    const { paths } = await materialize(root, { appName: "Cached App" });
    // Bundle files are rewritten on every managed materialization; the kernel
    // cache under runtimeDir is the authority for "generation did not rerun".
    const cacheIcon = join(paths.runtimeDir, "app-icon", "default-app-icon.icns");
    const before = await stat(cacheIcon);
    await materialize(root, { appName: "Cached App" });
    const after = await stat(cacheIcon);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  }, 120_000);

  it("restores the iconless behavior under defaultAppIcon: false", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-default-icon-off-"));
    tempDirs.push(root);
    await materialize(root, {
      appName: "Off App",
      appBundle: { defaultAppIcon: false },
    });
    const bundle = join(root, "home/.opentray/apps/opentray/Notes.app");
    await expect(readFile(join(bundle, "Contents/Resources/AppIcon.icns"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const plist = await readFile(join(bundle, "Contents/Info.plist"), "utf8");
    expect(plist).not.toContain("CFBundleIconFile");
  }, 120_000);

  it("never injects a default into a read-only reinitialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-default-icon-readonly-"));
    tempDirs.push(root);
    // First materialization without any icon: the prebuilt bundle has none.
    await materialize(root, {
      appName: "Readonly App",
      appBundle: { defaultAppIcon: false },
    });
    const bundle = join(root, "home/.opentray/apps/opentray/Notes.app");
    // Read-only validation must pass without injecting the synthesized icon.
    await materialize(root, {
      appName: "Readonly App",
      appBundle: { reinitialize: false },
    });
    await expect(readFile(join(bundle, "Contents/Resources/AppIcon.icns"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);

  it("a declared appIcon wins over glyph synthesis", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-default-icon-declared-"));
    tempDirs.push(root);
    const declaredBytes = new Uint8Array([0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 8]); // "icns" + len
    await materialize(root, {
      appName: "Declared App",
      appIcon: [
        {
          platform: "darwin",
          format: "icns",
          source: { type: "encoded", data: declaredBytes },
        },
      ],
    });
    const iconPath = join(
      root,
      "home/.opentray/apps/opentray/Notes.app/Contents/Resources/AppIcon.icns",
    );
    expect(new Uint8Array(await readFile(iconPath))).toEqual(declaredBytes);
  }, 120_000);
});

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

const template = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenTray</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`;
