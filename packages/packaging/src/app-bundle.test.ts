// Orthogonal intents (updated 2026-07-21; original user requests: stable managed
// and plugin-generated bundles share one contract and stale same-AppId paths converge):
// 1. Prove managed generation writes the expected identity and hashes.
// 2. Prove prebuilt validation is read-only and rejects drift.
// 3. Prove mutable launch state does not modify validated prebuilt assets.
// 4. Prove identity convergence removes only dead OpenTray-owned bundles.

import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse as parsePlist } from "plist";

import {
  convergeDarwinAppBundleIdentity,
  ensureDarwinAppBundle,
  DarwinAppBundleError,
  writeDarwinAppBundleOwner,
} from "./app-bundle";
import { readDarwinAppLaunchDescriptor, updateDarwinAppLaunchDescriptor } from "./app-launch";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Darwin app bundle", () => {
  it("materializes one stable bundle with the broker and default ICNS", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const templatePath = join(root, "Info.plist");
    const brokerPath = join(root, "broker");
    const bundlePath = join(root, "Skill Creator.app");
    await writeFile(templatePath, template());
    await writeFile(brokerPath, "broker-v1");

    const executable = await ensureDarwinAppBundle({
      bundlePath,
      packageName: "@jixoai/skill-creator",
      appId: "com.jixoai.skill-creator",
      appName: "Skill Creator",
      target: { os: "darwin", arch: "arm64" },
      brokerPath,
      templatePath,
      appIcon: [
        {
          platform: "darwin",
          format: "icns",
          source: { type: "encoded", data: [0x69, 0x63, 0x6e, 0x73] },
        },
      ],
    });

    expect(executable).toBe(join(bundlePath, "Contents/MacOS/opentray"));
    expect(await readFile(executable, "utf8")).toBe("broker-v1");
    expect(await readFile(join(bundlePath, "Contents/Resources/AppIcon.icns"))).toEqual(
      Buffer.from("icns"),
    );
    const plist = parsePlist(await readFile(join(bundlePath, "Contents/Info.plist"), "utf8"));
    expect(plist).toMatchObject({
      CFBundleIdentifier: "com.jixoai.skill-creator",
      CFBundleName: "Skill Creator",
      CFBundleDisplayName: "Skill Creator",
      CFBundleExecutable: "opentray",
      CFBundleIconFile: "AppIcon.icns",
    });
    const manifest = JSON.parse(
      await readFile(join(bundlePath, "Contents/Resources/opentray-app-bundle.json"), "utf8"),
    ) as { broker: { hash: string }; icon: { hash: string } };
    expect(manifest.broker.hash).toBe(hash("broker-v1"));
    expect(manifest.icon.hash).toBe(hash("icns"));
  });

  it("converges wrong-package and legacy same-AppId bundles after the current path is valid", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const appsRoot = join(root, ".opentray/apps");
    const current = join(appsRoot, "skill-creator/Skill Creator.app");
    const wrongPackage = join(appsRoot, "webui/Skill Creator.app");
    const legacy = join(root, ".opentray/2.0.0/skill-creator/runtime/darwin-carrier/OpenTray.app");
    await Promise.all([
      writeOwnedBundle(current, "com.skill-creator", "skill-creator"),
      writeOwnedBundle(wrongPackage, "com.skill-creator", "webui"),
      writeLegacyBundle(legacy, "com.skill-creator"),
    ]);
    const unregistered: string[] = [];

    const result = await convergeDarwinAppBundleIdentity({
      currentBundlePath: current,
      appId: "com.skill-creator",
      managedAppsRoot: appsRoot,
      legacyBundlePaths: [legacy],
      unregisterBundle: async (path) => {
        unregistered.push(path);
      },
    });

    expect(result.removed).toEqual([legacy, wrongPackage].sort());
    expect(unregistered.sort()).toEqual([legacy, wrongPackage].sort());
    await expect(access(current)).resolves.toBeUndefined();
    await expect(access(wrongPackage)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(legacy)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("converges legacy carriers from older runtime versions", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const appsRoot = join(root, ".opentray/apps");
    const current = join(appsRoot, "skill-creator/Skill Creator.app");
    const oldVersionCarrier = join(
      root,
      ".opentray/2.0.0/skill-creator/runtime/darwin-carrier/OpenTray.app",
    );
    await Promise.all([
      writeOwnedBundle(current, "com.skill-creator", "skill-creator"),
      writeLegacyBundle(oldVersionCarrier, "com.skill-creator"),
    ]);

    const result = await convergeDarwinAppBundleIdentity({
      currentBundlePath: current,
      appId: "com.skill-creator",
      managedAppsRoot: appsRoot,
      legacyRuntimeRoot: join(root, ".opentray"),
      unregisterBundle: async () => {},
    });

    expect(result.removed).toEqual([oldVersionCarrier]);
    await expect(access(oldVersionCarrier)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a same-AppId bundle whose owner is still alive", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const appsRoot = join(root, ".opentray/apps");
    const current = join(appsRoot, "skill-creator/Skill Creator.app");
    const live = join(appsRoot, "webui/Skill Creator.app");
    await Promise.all([
      writeOwnedBundle(current, "com.skill-creator", "skill-creator"),
      writeOwnedBundle(live, "com.skill-creator", "webui"),
    ]);
    await writeFile(
      `${live}.opentray-owner.json`,
      JSON.stringify({ pid: 4242, brokerHash: "hash" }),
    );

    const result = await convergeDarwinAppBundleIdentity({
      currentBundlePath: current,
      appId: "com.skill-creator",
      managedAppsRoot: appsRoot,
      isProcessAlive: (pid) => pid === 4242,
      unregisterBundle: async () => {
        throw new Error("live bundle must not be unregistered");
      },
    });

    expect(result.removed).toEqual([]);
    expect(result.skippedLiveOwner).toEqual([{ bundlePath: live, pid: 4242 }]);
    await expect(access(live)).resolves.toBeUndefined();
  });

  it("creates missing parent directories before acquiring the stable-path lock", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const templatePath = join(root, "Info.plist");
    const brokerPath = join(root, "broker");
    const bundlePath = join(root, "nested", "Skill Creator.app");
    await writeFile(templatePath, template());
    await writeFile(brokerPath, "broker-v1");

    await expect(
      ensureDarwinAppBundle({
        bundlePath,
        packageName: "@jixoai/skill-creator",
        appId: "com.jixoai.skill-creator",
        appName: "Skill Creator",
        target: { os: "darwin", arch: "arm64" },
        brokerPath,
        templatePath,
      }),
    ).resolves.toBe(join(bundlePath, "Contents/MacOS/opentray"));
  });

  it("validates a prebuilt bundle without mutating it", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const templatePath = join(root, "Info.plist");
    const brokerPath = join(root, "broker");
    const bundlePath = join(root, "Skill Creator.app");
    await writeFile(templatePath, template());
    await writeFile(brokerPath, "broker-v1");
    await ensureDarwinAppBundle({
      bundlePath,
      packageName: "@jixoai/skill-creator",
      appId: "com.jixoai.skill-creator",
      appName: "Skill Creator",
      target: { os: "darwin", arch: "arm64" },
      brokerPath,
      templatePath,
      reinitialize: true,
    });
    const manifestPath = join(bundlePath, "Contents/Resources/opentray-app-bundle.json");
    const before = await readFile(manifestPath, "utf8");
    await ensureDarwinAppBundle({
      bundlePath,
      packageName: "@jixoai/skill-creator",
      appId: "com.jixoai.skill-creator",
      appName: "Skill Creator",
      target: { os: "darwin", arch: "arm64" },
      brokerPath,
      templatePath,
      reinitialize: false,
    });
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    await writeFile(brokerPath, "broker-v2");
    await expect(
      ensureDarwinAppBundle({
        bundlePath,
        packageName: "@jixoai/skill-creator",
        appId: "com.jixoai.skill-creator",
        appName: "Skill Creator",
        target: { os: "darwin", arch: "arm64" },
        brokerPath,
        templatePath,
        reinitialize: false,
      }),
    ).rejects.toMatchObject({ code: "incompatible_bundle" } satisfies Pick<
      DarwinAppBundleError,
      "code"
    >);
  });

  it("updates only runtime launch state after validating a prebuilt bundle", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const templatePath = join(root, "Info.plist");
    const brokerPath = join(root, "broker");
    const bundlePath = join(root, "Skill Creator.app");
    await writeFile(templatePath, template());
    await writeFile(brokerPath, "broker-v1");
    const bundleOptions = {
      bundlePath,
      packageName: "@jixoai/skill-creator",
      appId: "com.jixoai.skill-creator",
      appName: "Skill Creator",
      target: { os: "darwin" as const, arch: "arm64" as const },
      brokerPath,
      templatePath,
    };
    await ensureDarwinAppBundle(bundleOptions);
    await updateDarwinAppLaunchDescriptor(bundlePath, {
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: ["first.mjs"],
      cwd: "/tmp/first",
    });
    const manifestPath = join(bundlePath, "Contents/Resources/opentray-app-bundle.json");
    const plistPath = join(bundlePath, "Contents/Info.plist");
    const executablePath = join(bundlePath, "Contents/MacOS/opentray");
    const immutableBefore = await Promise.all([
      readFile(manifestPath),
      readFile(plistPath),
      readFile(executablePath),
    ]);

    await ensureDarwinAppBundle({ ...bundleOptions, reinitialize: false });
    await updateDarwinAppLaunchDescriptor(bundlePath, {
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: ["second.mjs"],
      cwd: "/tmp/second",
    });

    expect(await readDarwinAppLaunchDescriptor(bundlePath)).toEqual({
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: ["second.mjs"],
      cwd: "/tmp/second",
    });
    expect(
      await Promise.all([readFile(manifestPath), readFile(plistPath), readFile(executablePath)]),
    ).toEqual(immutableBefore);
  });

  it("rejects an incompatible managed rewrite while a live owner is marked", async () => {
    const root = await mkdtemp("/tmp/opentray-app-bundle-");
    roots.push(root);
    const templatePath = join(root, "Info.plist");
    const brokerPath = join(root, "broker");
    const bundlePath = join(root, "Skill Creator.app");
    await writeFile(templatePath, template());
    await writeFile(brokerPath, "broker-v1");
    await ensureDarwinAppBundle({
      bundlePath,
      packageName: "@jixoai/skill-creator",
      appId: "com.jixoai.skill-creator",
      appName: "Skill Creator",
      target: { os: "darwin", arch: "arm64" },
      brokerPath,
      templatePath,
    });
    await writeDarwinAppBundleOwner(bundlePath, process.pid, hash("broker-v1"));
    await writeFile(brokerPath, "broker-v2");
    await expect(
      ensureDarwinAppBundle({
        bundlePath,
        packageName: "@jixoai/skill-creator",
        appId: "com.jixoai.skill-creator",
        appName: "Skill Creator",
        target: { os: "darwin", arch: "arm64" },
        brokerPath,
        templatePath,
      }),
    ).rejects.toMatchObject({ code: "bundle_in_use" } satisfies Pick<DarwinAppBundleError, "code">);
  });
});

const template = (appId = "com.example.template"): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>opentray</string><key>CFBundleIdentifier</key><string>${appId}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const writeOwnedBundle = async (
  bundlePath: string,
  appId: string,
  packageName: string,
): Promise<void> => {
  await writeLegacyBundle(bundlePath, appId);
  await writeFile(
    join(bundlePath, "Contents/Resources/opentray-app-bundle.json"),
    `${JSON.stringify({ schemaVersion: 1, packageName, appId })}\n`,
  );
};

const writeLegacyBundle = async (bundlePath: string, appId: string): Promise<void> => {
  await mkdir(join(bundlePath, "Contents/Resources"), { recursive: true });
  await mkdir(join(bundlePath, "Contents/MacOS"), { recursive: true });
  await writeFile(join(bundlePath, "Contents/MacOS/opentray"), "broker");
  await writeFile(join(bundlePath, "Contents/Info.plist"), template(appId));
};
