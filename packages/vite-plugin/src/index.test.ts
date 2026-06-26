import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem } from "@opentray/packaging";

import { openTrayVitePlugin, resolveViteEntry } from "./index";

describe("@opentray/vite-plugin", () => {
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
    expect(result?.manifest.adapter).toEqual({ name: "vite", mode: "production" });
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
});
