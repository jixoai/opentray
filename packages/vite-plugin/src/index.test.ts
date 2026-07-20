import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem } from "@opentray/packaging";

import {
  generateOpenTrayAppIcon,
  openTrayAppBundlePlugin,
  openTrayVitePlugin,
  resolveViteEntry,
} from "./index";

const execFileAsync = promisify(execFile);

describe("@opentray/vite-plugin", () => {
  it("delegates app bundle generation to the shared Darwin contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-vite-app-bundle-"));
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
    plugin.configResolved({ root, mode: "production", build: { outDir: "dist" } });
    await plugin.writeBundle();
    expect(plugin.getLastResult()?.executablePath).toBe(
      join(root, "dist/Consumer.app/Contents/MacOS/opentray"),
    );
  });
  it("Scenario: Given Vite build metadata When bundle writes Then the shared manifest shape is emitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-vite-"));
    const runtimeSource = join(root, "runtime-host");
    const nativeSource = join(root, "native.dylib");
    await writeFile(runtimeSource, "runtime");
    await writeFile(nativeSource, "native");

    const plugin = openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: runtimeSource },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });
    plugin.configResolved({
      root,
      mode: "production",
      build: { outDir: "dist" },
    });

    await plugin.writeBundle(undefined, {
      "assets/main.js": {
        type: "chunk",
        isEntry: true,
        fileName: "assets/main.js",
        facadeModuleId: "src/main.ts",
      },
    });

    const result = plugin.getLastResult();
    expect(result?.manifest.adapter).toEqual({
      name: "vite",
      mode: "production",
    });
    expect(result?.manifest.entry).toBe("src/main.ts");
    expect(result?.manifest.runtimeHost.path).toBe(
      `${formatOpenTrayArtifactStem(
        "com.example.build",
      )}/runtime/${formatOpenTrayArtifactStem("com.example.build")}`,
    );
    await expect(stat(join(root, "dist", result?.manifestPath ?? ""))).resolves.toBeTruthy();

    const manifest = JSON.parse(
      await readFile(join(root, "dist", result?.manifestPath ?? ""), "utf8"),
    ) as { adapter: { name: string }; app: { id: string } };
    expect(manifest.adapter.name).toBe("vite");
    expect(manifest.app.id).toBe("com.example.build");
  });

  it("Scenario: Given missing app metadata When Vite writes Then packaging fails explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-vite-"));
    const runtimeSource = join(root, "runtime-host");
    await writeFile(runtimeSource, "runtime");

    const plugin = openTrayVitePlugin({
      app: { id: "", name: "Build" },
      runtimeHost: { source: runtimeSource },
      entry: "src/main.ts",
    });
    plugin.configResolved({
      root,
      mode: "production",
      build: { outDir: "dist" },
    });

    await expect(plugin.writeBundle(undefined, {})).rejects.toThrow(/stable app\.id/);
  });

  it("Scenario: Given an entry chunk When resolving entry Then facade module identity wins", () => {
    expect(
      resolveViteEntry({
        "assets/main.js": {
          type: "chunk",
          isEntry: true,
          fileName: "assets/main.js",
          facadeModuleId: "src/app.ts",
        },
      }),
    ).toBe("src/app.ts");
  });

  it("Scenario: Given a source image When generating an app icon Then PNG and ICNS are cached by every input identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-app-icon-"));
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "icons", "app-icon.png");
    const icnsOutputPath = join(root, "icons", "app-icon.icns");
    const cachePath = join(root, ".cache", "app-icon.json");
    const implementationPath = join(root, "dist", "index.mjs");
    const implementationSourcePath = join(root, "src", "app-icon.ts");
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 39, g: 87, b: 255, alpha: 1 },
      },
    })
      .png()
      .toFile(sourcePath);
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(implementationPath, "export const recipe = 1;\n");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(implementationSourcePath, "export const sourceRecipe = 1;\n");

    const first = await generateOpenTrayAppIcon({
      sourcePath,
      outputPath,
      icnsOutputPath,
      cachePath,
      implementationPath,
    });
    const png = await readFile(outputPath);
    const icns = await readFile(icnsOutputPath);
    const ico = await readFile(first.icoOutputPath);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(ico.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect((await sharp(outputPath).metadata()).density).toBe(72);
    expect(readIcnsTags(icns)).toEqual([
      "TOC ",
      "ic12",
      "ic07",
      "ic13",
      "ic08",
      "ic04",
      "ic14",
      "ic09",
      "ic05",
      "ic10",
      "ic11",
    ]);
    if (process.platform === "darwin") {
      const projection = await inspectAppKitIcns(icnsOutputPath);
      expect(projection).toMatchObject({ width: 512, height: 512 });
      expect(projection.representations).toEqual(
        expect.arrayContaining([
          { pixelsWide: 1024, pixelsHigh: 1024, width: 512, height: 512 },
          { pixelsWide: 512, pixelsHigh: 512, width: 512, height: 512 },
          { pixelsWide: 512, pixelsHigh: 512, width: 256, height: 256 },
        ]),
      );
    }
    expect(first.appIcon).toHaveLength(9);
    const manifest = JSON.parse(await readFile(first.manifestOutputPath, "utf8"));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.appIcon.slice(0, 2)).toEqual([
      {
        platform: "darwin",
        format: "icns",
        source: { type: "file", path: "app-icon.icns" },
      },
      {
        platform: "windows",
        format: "ico",
        source: { type: "file", path: "app-icon.ico" },
      },
    ]);
    for (const linux of first.linuxPngOutputPaths) {
      expect((await readFile(linux.path)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect((await sharp(linux.path).metadata()).density).toBe(72);
    }
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toMatchObject({
      implementationSha256: first.implementationSha256,
      sourceImplementationSha256: first.sourceImplementationSha256,
      sourceSha256: first.sourceSha256,
    });

    const second = await generateOpenTrayAppIcon({
      sourcePath,
      outputPath,
      icnsOutputPath,
      cachePath,
      implementationPath,
    });
    expect(second).toEqual(first);
    expect(await readFile(outputPath)).toEqual(png);

    await writeFile(implementationPath, "export const recipe = 2;\n");
    const implementationChanged = await generateOpenTrayAppIcon({
      sourcePath,
      outputPath,
      icnsOutputPath,
      cachePath,
      implementationPath,
    });
    expect(implementationChanged.implementationSha256).not.toBe(first.implementationSha256);

    await writeFile(implementationSourcePath, "export const sourceRecipe = 2;\n");
    const sourceImplementationChanged = await generateOpenTrayAppIcon({
      sourcePath,
      outputPath,
      icnsOutputPath,
      cachePath,
      implementationPath,
    });
    expect(sourceImplementationChanged.sourceImplementationSha256).not.toBe(
      first.sourceImplementationSha256,
    );

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 39, b: 87, alpha: 1 },
      },
    })
      .png()
      .toFile(sourcePath);
    const sourceChanged = await generateOpenTrayAppIcon({
      sourcePath,
      outputPath,
      icnsOutputPath,
      cachePath,
      implementationPath,
    });
    expect(sourceChanged.sourceSha256).not.toBe(first.sourceSha256);

    await rm(outputPath);
    await generateOpenTrayAppIcon({
      sourcePath,
      outputPath,
      icnsOutputPath,
      cachePath,
      implementationPath,
    });
    await expect(stat(outputPath)).resolves.toBeTruthy();
  }, 20_000);
});

const appBundleTemplate = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenTray</string></dict></plist>\n`;

const readIcnsTags = (icon: Buffer): string[] => {
  const tags: string[] = [];
  let offset = 8;
  while (offset < icon.length) {
    const length = icon.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > icon.length) {
      throw new Error(`invalid ICNS chunk at byte ${offset}`);
    }
    tags.push(icon.subarray(offset, offset + 4).toString("ascii"));
    offset += length;
  }
  return tags;
};

interface AppKitIconProjection {
  width: number;
  height: number;
  representations: Array<{
    pixelsWide: number;
    pixelsHigh: number;
    width: number;
    height: number;
  }>;
}

const inspectAppKitIcns = async (iconPath: string): Promise<AppKitIconProjection> => {
  const script = String.raw`
ObjC.import("AppKit");
function run(argv) {
  const image = $.NSImage.alloc.initWithContentsOfFile($(argv[0]));
  if (!image) throw new Error("AppKit rejected generated ICNS");
  const size = image.size;
  const reps = image.representations;
  const representations = [];
  for (let index = 0; index < Number(reps.count); index += 1) {
    const rep = reps.objectAtIndex(index);
    const repSize = rep.size;
    representations.push({
      pixelsWide: Number(rep.pixelsWide),
      pixelsHigh: Number(rep.pixelsHigh),
      width: Number(repSize.width),
      height: Number(repSize.height),
    });
  }
  return JSON.stringify({
    width: Number(size.width),
    height: Number(size.height),
    representations,
  });
}`;
  const { stdout } = await execFileAsync("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    script,
    "--",
    iconPath,
  ]);
  return JSON.parse(stdout) as AppKitIconProjection;
};
