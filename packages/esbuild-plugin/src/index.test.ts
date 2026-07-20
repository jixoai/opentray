import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem } from "@opentray/packaging";

import {
  openTrayAppBundlePlugin,
  openTrayEsbuildPlugin,
  resolveEsbuildEntry,
  type EsbuildBuildLike,
  type EsbuildPlugin,
  type EsbuildInitialOptionsLike,
} from "./index";

describe("@opentray/esbuild-plugin", () => {
  it("delegates app bundle generation to the shared Darwin contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-esbuild-app-bundle-"));
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
    await runSetup(plugin, { outdir: "dist", absWorkingDir: root });
    expect(plugin.getLastResult()?.executablePath).toBe(
      join(root, "dist/Consumer.app/Contents/MacOS/opentray"),
    );
  });
  it("Scenario: Given esbuild initial options When onEnd fires Then the shared manifest shape is emitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-esbuild-"));
    const runtimeSource = join(root, "runtime-host");
    const nativeSource = join(root, "native.dylib");
    await writeFile(runtimeSource, "runtime");
    await writeFile(nativeSource, "native");

    const plugin = openTrayEsbuildPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: runtimeSource },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });

    await runSetup(plugin, {
      outdir: "dist",
      absWorkingDir: root,
      entryPoints: ["src/main.ts"],
    });

    const result = plugin.getLastResult();
    expect(result?.manifest.adapter).toEqual({ name: "esbuild", mode: "production" });
    expect(result?.manifest.entry).toBe("src/main.ts");
    expect(result?.manifest.runtimeHost.path).toBe(
      `${formatOpenTrayArtifactStem("com.example.build")}/runtime/${formatOpenTrayArtifactStem(
        "com.example.build",
      )}`,
    );
    await expect(stat(join(root, "dist", result?.manifestPath ?? ""))).resolves.toBeTruthy();

    const manifest = JSON.parse(
      await readFile(join(root, "dist", result?.manifestPath ?? ""), "utf8"),
    ) as { adapter: { name: string }; app: { id: string } };
    expect(manifest.adapter.name).toBe("esbuild");
    expect(manifest.app.id).toBe("com.example.build");
  });

  it("Scenario: Given missing app metadata When onEnd fires Then packaging fails explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-esbuild-"));
    const runtimeSource = join(root, "runtime-host");
    await writeFile(runtimeSource, "runtime");

    const plugin = openTrayEsbuildPlugin({
      app: { id: "", name: "Build" },
      runtimeHost: { source: runtimeSource },
      entry: "src/main.ts",
    });

    await expect(
      runSetup(plugin, { outdir: "dist", absWorkingDir: root }),
    ).rejects.toThrow(/stable app\.id/);
  });

  it("Scenario: Given a single outfile When resolving outDir Then the outfile directory is used", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-esbuild-"));
    const runtimeSource = join(root, "runtime-host");
    await writeFile(runtimeSource, "runtime");

    const plugin = openTrayEsbuildPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: runtimeSource },
      entry: "src/main.ts",
    });

    await runSetup(plugin, {
      outfile: "build/host.js",
      absWorkingDir: root,
      entryPoints: ["src/main.ts"],
    });

    const result = plugin.getLastResult();
    expect(result).toBeDefined();
    await expect(
      stat(join(root, "build", result?.manifestPath ?? "")),
    ).resolves.toBeTruthy();
  });

  it("Scenario: Given entryPoints as an array When resolving entry Then the first entry point wins", () => {
    expect(resolveEsbuildEntry({ entryPoints: ["src/app.ts", "src/worker.ts"] })).toBe("src/app.ts");
  });

  it("Scenario: Given entryPoints as an object When resolving entry Then the first value wins", () => {
    expect(
      resolveEsbuildEntry({
        entryPoints: { browser: "src/app.ts" },
      }),
    ).toBe("src/app.ts");
  });
});

const appBundleTemplate = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenTray</string></dict></plist>\n`;

const runSetup = async (
  plugin: EsbuildPlugin,
  initialOptions: EsbuildInitialOptionsLike,
): Promise<void> => {
  const callbacks: Array<(result: unknown) => Promise<void> | void> = [];
  const build: EsbuildBuildLike = {
    initialOptions,
    onEnd: (cb) => {
      callbacks.push(cb);
    },
  };
  plugin.setup(build);
  for (const cb of callbacks) {
    await cb({});
  }
};
