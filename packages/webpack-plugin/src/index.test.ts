import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { formatOpenTrayArtifactStem } from "@opentray/packaging";

import { openTrayWebpackPlugin, resolveWebpackEntry } from "./index";
import type { WebpackCompilerLike, WebpackOptionsLike } from "./index";

describe("@opentray/webpack-plugin", () => {
  it("Scenario: Given webpack compiler options When afterEmit fires Then the shared manifest shape is emitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-webpack-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "runtime-host");
    const nativeSource = join(root, "native.dylib");
    await writeFile(runtimeSource, "runtime");
    await writeFile(nativeSource, "native");

    const plugin = openTrayWebpackPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: runtimeSource },
      nativeArtifacts: { "darwin-arm64": { source: nativeSource } },
    });

    const compiler = createMockCompiler({
      mode: "production",
      output: { path: outDir },
      entry: { main: "src/main.ts" },
    });
    plugin.apply(compiler);
    await compiler.runAfterEmit();

    const result = plugin.getLastResult();
    expect(result?.manifest.adapter).toEqual({ name: "webpack", mode: "production" });
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
    expect(manifest.adapter.name).toBe("webpack");
    expect(manifest.app.id).toBe("com.example.build");
  });

  it("Scenario: Given missing app metadata When afterEmit fires Then packaging fails explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-webpack-"));
    const outDir = join(root, "dist");
    const runtimeSource = join(root, "runtime-host");
    await writeFile(runtimeSource, "runtime");

    const plugin = openTrayWebpackPlugin({
      app: { id: "", name: "Build" },
      runtimeHost: { source: runtimeSource },
      entry: "src/main.ts",
    });

    const compiler = createMockCompiler({
      mode: "production",
      output: { path: outDir },
    });
    plugin.apply(compiler);
    await expect(compiler.runAfterEmit()).rejects.toThrow(/stable app\.id/);
  });

  it("Scenario: Given a string entry When resolving entry Then the entry string wins", () => {
    expect(resolveWebpackEntry("src/app.ts")).toBe("src/app.ts");
  });

  it("Scenario: Given an array entry When resolving entry Then the first entry wins", () => {
    expect(resolveWebpackEntry(["src/app.ts", "src/worker.ts"])).toBe("src/app.ts");
  });

  it("Scenario: Given a static entry map When resolving entry Then the main entry wins", () => {
    expect(resolveWebpackEntry({ main: "src/app.ts" })).toBe("src/app.ts");
  });
});

const createMockCompiler = (options: WebpackOptionsLike): WebpackCompilerLike & {
  runAfterEmit(): Promise<void>;
} => {
  const taps: Array<(value: unknown, cb: (error?: Error) => void) => void> = [];
  return {
    options,
    hooks: {
      afterEmit: {
        tapAsync(_name, cb) {
          taps.push(async (value, done) => {
            try {
              await cb(value as { options: WebpackOptionsLike }, done);
            } catch (error) {
              done(error as Error);
            }
          });
        },
      },
    },
    async runAfterEmit() {
      await new Promise<void>((resolvePromise, reject) => {
        const run = taps[0];
        if (!run) {
          reject(new Error("no afterEmit tap registered"));
          return;
        }
        run({ options }, (error) => {
          if (error) {
            reject(error);
          } else {
            resolvePromise();
          }
        });
      });
    },
  };
};
