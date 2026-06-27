import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem, resolveOpenTrayPackage } from "@opentray/packaging";
import { openTrayEsbuildPlugin } from "@opentray/esbuild-plugin";

describe("esbuild real build", () => {
  it("Scenario: Given a real esbuild build When it completes Then the manifest and artifacts are staged", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-esbuild-build-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    const nativeSource = join(root, "libnative.dylib");
    const entryFile = new URL("./src/main.ts", import.meta.url);
    await writeFile(runtimeSource, "runtime-host-bytes");
    await writeFile(nativeSource, "native-bytes");

    const plugin = openTrayEsbuildPlugin({
      app: { id: "com.example.esbuild.build", name: "esbuild Build" },
      runtimeHost: { source: runtimeSource, executable: true },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });

    const { build } = await import("esbuild");
    await build({
      entryPoints: [pathToFileURL(entryFile.pathname).pathname],
      outdir: outDir,
      bundle: true,
      format: "esm",
      absWorkingDir: root,
      write: true,
      plugins: [plugin as never],
      logLevel: "silent",
    });

    const result = plugin.getLastResult();
    expect(result).toBeDefined();
    expect(result?.manifest.adapter).toEqual({ name: "esbuild", mode: "production" });
    const stem = formatOpenTrayArtifactStem("com.example.esbuild.build");
    expect(result?.manifest.runtimeHost.path).toBe(`${stem}/runtime/${stem}`);

    const manifestPath = join(outDir, result?.manifestPath ?? "");
    await expect(stat(manifestPath)).resolves.toBeTruthy();
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      adapter: { name: string };
      app: { id: string };
    };
    expect(manifest.adapter.name).toBe("esbuild");
    expect(manifest.app.id).toBe("com.example.esbuild.build");

    const resolved = await resolveOpenTrayPackage(manifestPath);
    expect(resolved.runtimeHostPath).toBe(join(outDir, `${stem}/runtime/${stem}`));
    await expect(stat(resolved.runtimeHostPath)).resolves.toBeTruthy();
  });
});
