import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem, resolveOpenTrayPackage } from "@opentray/packaging";
import { openTrayTsdownPlugin } from "@opentray/tsdown-plugin";

describe("tsdown real build", () => {
  it("Scenario: Given a real tsdown build When it completes Then the manifest and artifacts are staged", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-tsdown-build-"));
    const entryFile = new URL("./src/main.ts", import.meta.url);
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    const nativeSource = join(root, "libnative.dylib");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(runtimeSource, "runtime-host-bytes");
    await writeFile(nativeSource, "native-bytes");

    const plugin = openTrayTsdownPlugin({
      app: { id: "com.example.tsdown.build", name: "TSdown Build" },
      runtimeHost: { source: runtimeSource, executable: true },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });

    const { build } = await import("tsdown");
    // The adapter is a structural Rolldown plugin (name/configResolved/writeBundle).
    // tsdown accepts Rolldown plugins natively; cast only to bridge the local Like types.
    await build({
      entry: [pathToFileURL(entryFile.pathname).pathname],
      outDir,
      format: "esm",
      plugins: [plugin as never],
    });

    const result = plugin.getLastResult();
    expect(result).toBeDefined();
    expect(result?.manifest.adapter).toEqual({ name: "tsdown", mode: "production" });
    const stem = formatOpenTrayArtifactStem("com.example.tsdown.build");
    expect(result?.manifest.runtimeHost.path).toBe(`${stem}/runtime/${stem}`);

    const manifestPath = join(outDir, result?.manifestPath ?? "");
    await expect(stat(manifestPath)).resolves.toBeTruthy();
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      adapter: { name: string };
      app: { id: string };
    };
    expect(manifest.adapter.name).toBe("tsdown");
    expect(manifest.app.id).toBe("com.example.tsdown.build");

    const resolved = await resolveOpenTrayPackage(manifestPath);
    expect(resolved.runtimeHostPath).toBe(join(outDir, `${stem}/runtime/${stem}`));
    await expect(stat(resolved.runtimeHostPath)).resolves.toBeTruthy();
  });
});
