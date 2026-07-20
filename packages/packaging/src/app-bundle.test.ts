// Orthogonal intents (2026-07-20; original user request: stable managed and
// plugin-generated bundles must share one contract):
// 1. Prove managed generation writes the expected identity and hashes.
// 2. Prove prebuilt validation is read-only and rejects drift.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse as parsePlist } from "plist";

import {
  ensureDarwinAppBundle,
  DarwinAppBundleError,
  writeDarwinAppBundleOwner,
} from "./app-bundle";

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
    ).rejects.toMatchObject({ code: "incompatible_bundle" } satisfies Pick<DarwinAppBundleError, "code">);
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

const template = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenTray</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
