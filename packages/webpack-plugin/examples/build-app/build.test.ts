import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem, resolveOpenTrayPackage } from "@opentray/packaging";
import { openTrayWebpackPlugin } from "@opentray/webpack-plugin";

describe("webpack real build", () => {
  it("Scenario: Given a real webpack build When it completes Then the manifest and artifacts are staged", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-webpack-build-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    const nativeSource = join(root, "libnative.dylib");
    await writeFile(runtimeSource, "runtime-host-bytes");
    await writeFile(nativeSource, "native-bytes");

    const entryFile = new URL("./src/main.js", import.meta.url);
    const plugin = openTrayWebpackPlugin({
      app: { id: "com.example.webpack.build", name: "webpack Build" },
      runtimeHost: { source: runtimeSource, executable: true },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });

    const webpack = (await import("webpack")).default;
    const config = {
      mode: "production" as const,
      target: "node" as const,
      entry: { main: entryFile.pathname },
      output: { path: outDir, filename: "[name].js" },
      plugins: [plugin as never],
    };

    await new Promise<void>((resolvePromise, reject) => {
      const compiler = webpack(config as never);
      compiler.run((error, stats) => {
        if (error) {
          reject(error);
          return;
        }
        if (stats?.hasErrors()) {
          reject(new Error(stats.toString({ errors: true })));
          return;
        }
        resolvePromise();
      });
    });

    const result = plugin.getLastResult();
    expect(result).toBeDefined();
    expect(result?.manifest.adapter).toEqual({ name: "webpack", mode: "production" });
    const stem = formatOpenTrayArtifactStem("com.example.webpack.build");
    expect(result?.manifest.runtimeHost.path).toBe(`${stem}/runtime/${stem}`);

    const manifestPath = join(outDir, result?.manifestPath ?? "");
    await expect(stat(manifestPath)).resolves.toBeTruthy();
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      adapter: { name: string };
      app: { id: string };
    };
    expect(manifest.adapter.name).toBe("webpack");
    expect(manifest.app.id).toBe("com.example.webpack.build");

    const resolved = await resolveOpenTrayPackage(manifestPath);
    expect(resolved.runtimeHostPath).toBe(join(outDir, `${stem}/runtime/${stem}`));
    await expect(stat(resolved.runtimeHostPath)).resolves.toBeTruthy();

    // Verify the bundler's own primary output exists, is real compiled code,
    // and is loadable at runtime — not just the staged sidecar artifacts.
    const bundleOutput = join(outDir, "main.js");
    await expect(stat(bundleOutput)).resolves.toBeTruthy();
    const compiledCode = await readFile(bundleOutput, "utf8");
    expect(compiledCode).toMatch(/opentray-webpack-build-example/);
    const requireFromTest = createRequire(import.meta.url);
    const imported = requireFromTest(bundleOutput) as { main: () => string };
    expect(imported.main()).toBe("opentray-webpack-build-example");
  });
});
