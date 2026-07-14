import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  formatOpenTrayArtifactStem,
  OpenTrayPackagingError,
  resolveOpenTrayPackage,
  stageOpenTrayPackage,
} from "./index";

describe("@opentray/packaging", () => {
  it("Scenario: Given app identity When packaging stages artifacts Then paths and manifest are app-derived", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-packaging-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    const sidecarSource = join(root, "native.dylib");
    await writeFile(runtimeSource, "runtime");
    await writeFile(sidecarSource, "native");

    const result = await stageOpenTrayPackage({
      app: { id: "com.example.Build", name: "Example Build" },
      outDir,
      entry: "src/main.ts",
      adapter: { name: "test-adapter", mode: "production" },
      runtimeHost: { source: runtimeSource },
      nativeArtifacts: {
        "darwin-arm64": { source: sidecarSource },
      },
    });

    const stem = formatOpenTrayArtifactStem("com.example.Build");
    expect(result.manifest.artifactStem).toBe(stem);
    expect(result.manifest.runtimeHost.path).toBe(`${stem}/runtime/${stem}`);
    expect(result.manifest.nativeArtifacts["darwin-arm64"]?.path).toBe(
      `${stem}/native/darwin-arm64.dylib`,
    );
    expect(result.manifest.app).toEqual({
      id: "com.example.Build",
      name: "Example Build",
    });
    await expect(stat(join(outDir, result.manifest.runtimeHost.path))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });

    const manifest = JSON.parse(await readFile(join(outDir, result.manifestPath), "utf8")) as {
      app: { id: string; name: string };
      adapter: { name: string; mode: string };
      entry: string;
    };
    expect(manifest).toMatchObject({
      app: { id: "com.example.Build", name: "Example Build" },
      adapter: { name: "test-adapter", mode: "production" },
      entry: "src/main.ts",
    });
  });

  it("Scenario: Given missing app identity When packaging validates Then it fails before inventing a fallback", async () => {
    await expect(
      stageOpenTrayPackage({
        app: { id: " ", name: "Missing Identity" },
        outDir: "/tmp/opentray-unused",
        entry: "src/main.ts",
        adapter: { name: "test", mode: "production" },
        runtimeHost: { source: "/tmp/opentray-runtime" },
      }),
    ).rejects.toMatchObject({
      code: "missing_app_id",
      name: "OpenTrayPackagingError",
    } satisfies Partial<OpenTrayPackagingError>);
  });

  it("Scenario: Given similar ids When artifact stems are derived Then the hash prevents name collapse", () => {
    expect(formatOpenTrayArtifactStem("com.example-build")).not.toBe(
      formatOpenTrayArtifactStem("com.example.build"),
    );
  });

  it("Scenario: Given duplicate staged paths When packaging validates Then collision is explicit", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-packaging-"));
    const source = join(root, "host");
    await writeFile(source, "runtime");

    await expect(
      stageOpenTrayPackage({
        app: { id: "com.example.build", name: "Example Build" },
        outDir: join(root, "dist"),
        entry: "src/main.ts",
        adapter: { name: "test", mode: "production" },
        runtimeHost: { source, path: "same/path" },
        nativeArtifacts: { duplicate: { source, path: "same/path" } },
      }),
    ).rejects.toMatchObject({
      code: "duplicate_artifact_path",
      name: "OpenTrayPackagingError",
    } satisfies Partial<OpenTrayPackagingError>);
  });

  it("Scenario: Given emitted manifest When runtime resolves package Then staged artifacts come from manifest paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-packaging-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    const sidecarSource = join(root, "native.dylib");
    await writeFile(runtimeSource, "runtime");
    await writeFile(sidecarSource, "native");
    const staged = await stageOpenTrayPackage({
      app: { id: "com.example.runtime", name: "Runtime" },
      outDir,
      entry: "src/main.ts",
      adapter: { name: "test-adapter", mode: "production" },
      runtimeHost: { source: runtimeSource },
      nativeArtifacts: {
        "darwin-arm64": { source: sidecarSource },
      },
    });

    const resolved = await resolveOpenTrayPackage(join(outDir, staged.manifestPath));

    expect(resolved.runtimeHostPath).toBe(join(outDir, staged.manifest.runtimeHost.path));
    expect(resolved.nativeArtifactPaths["darwin-arm64"]).toBe(
      join(outDir, staged.manifest.nativeArtifacts["darwin-arm64"]?.path ?? ""),
    );
  });

  it("Scenario: Given custom manifest path When runtime resolves package Then artifact root remains explicit", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-packaging-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    await writeFile(runtimeSource, "runtime");
    const staged = await stageOpenTrayPackage({
      app: { id: "com.example.custom", name: "Custom" },
      outDir,
      entry: "src/main.ts",
      adapter: { name: "test-adapter", mode: "production" },
      runtimeHost: { source: runtimeSource },
      manifestPath: "metadata/opentray-app-manifest.json",
    });

    const resolved = await resolveOpenTrayPackage(join(outDir, staged.manifestPath), {
      artifactRoot: outDir,
    });

    expect(resolved.runtimeHostPath).toBe(join(outDir, staged.manifest.runtimeHost.path));
  });

  it("Scenario: Given executable runtime host When packaging stages artifacts Then it is executable on POSIX and present on Windows", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-packaging-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "host-bin");
    await writeFile(runtimeSource, "runtime");

    const staged = await stageOpenTrayPackage({
      app: { id: "com.example.executable", name: "Executable" },
      outDir,
      entry: "src/main.ts",
      adapter: { name: "test-adapter", mode: "production" },
      runtimeHost: { source: runtimeSource, executable: true },
    });

    const stagedHostPath = join(outDir, staged.manifest.runtimeHost.path);
    const mode = (await stat(stagedHostPath)).mode;
    expect(mode).toBeGreaterThan(0);
    if (process.platform === "win32") {
      return;
    }
    expect(mode & 0o111).toBe(0o111);
  });
});
