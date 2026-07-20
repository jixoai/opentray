import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem } from "@opentray/packaging";

import { openTrayAppBundlePlugin, openTrayTsdownPlugin, resolveTsdownEntry } from "./index";

describe("@opentray/tsdown-plugin", () => {
  it("delegates app bundle generation to the shared Darwin contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-tsdown-app-bundle-"));
    const outDir = join(root, "dist");
    const brokerPath = join(root, "broker");
    const templatePath = join(root, "Info.plist");
    await writeFile(brokerPath, "broker");
    await writeFile(templatePath, appBundleTemplate());
    const plugin = openTrayAppBundlePlugin({
      packageName: "@jixoai/consumer",
      appId: "com.example.consumer",
      appName: "Consumer",
      target: { os: "darwin", arch: "arm64" },
      brokerPath,
      templatePath,
    });
    await plugin.writeBundle({ dir: outDir });
    expect(plugin.getLastResult()?.executablePath).toBe(
      join(outDir, "Consumer.app/Contents/MacOS/opentray"),
    );
  });
  it("Scenario: Given tsdown writeBundle output When it fires Then the shared manifest shape is emitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-tsdown-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "runtime-host");
    const nativeSource = join(root, "native.dylib");
    await writeFile(runtimeSource, "runtime");
    await writeFile(nativeSource, "native");

    const plugin = openTrayTsdownPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: runtimeSource },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });

    await plugin.writeBundle(
      { dir: outDir },
      {
        "assets/main.js": {
          type: "chunk",
          isEntry: true,
          fileName: "assets/main.js",
          facadeModuleId: "src/main.ts",
        },
      },
    );

    const result = plugin.getLastResult();
    expect(result?.manifest.adapter).toEqual({ name: "tsdown", mode: "production" });
    expect(result?.manifest.entry).toBe("src/main.ts");
    expect(result?.manifest.runtimeHost.path).toBe(
      `${formatOpenTrayArtifactStem("com.example.build")}/runtime/${formatOpenTrayArtifactStem(
        "com.example.build",
      )}`,
    );
    await expect(stat(join(outDir, result?.manifestPath ?? ""))).resolves.toBeTruthy();

    const manifest = JSON.parse(
      await readFile(join(outDir, result?.manifestPath ?? ""), "utf8"),
    ) as { adapter: { name: string }; app: { id: string } };
    expect(manifest.adapter.name).toBe("tsdown");
    expect(manifest.app.id).toBe("com.example.build");
  });

  it("Scenario: Given missing app metadata When writeBundle fires Then packaging fails explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-tsdown-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "runtime-host");
    await writeFile(runtimeSource, "runtime");

    const plugin = openTrayTsdownPlugin({
      app: { id: "", name: "Build" },
      runtimeHost: { source: runtimeSource },
      entry: "src/main.ts",
    });

    await expect(plugin.writeBundle({ dir: outDir }, {})).rejects.toThrow(/stable app\.id/);
  });

  it("Scenario: Given an entry chunk When resolving entry Then facade module identity wins", () => {
    expect(
      resolveTsdownEntry({
        "assets/main.js": {
          type: "chunk",
          isEntry: true,
          fileName: "assets/main.js",
          facadeModuleId: "src/app.ts",
        },
      }),
    ).toBe("src/app.ts");
  });

  it("Scenario: Given an explicit outDir override When writeBundle fires Then staging targets the override", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-tsdown-"));
    const runtimeSource = join(root, "runtime-host");
    await writeFile(runtimeSource, "runtime");

    const plugin = openTrayTsdownPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: runtimeSource },
      entry: "src/main.ts",
      outDir: join(root, "staged-output"),
    });

    await plugin.writeBundle({}, {});

    const result = plugin.getLastResult();
    expect(result).toBeDefined();
    await expect(
      stat(join(root, "staged-output", result?.manifestPath ?? "")),
    ).resolves.toBeTruthy();
  });
});

const appBundleTemplate = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenTray</string></dict></plist>\n`;
