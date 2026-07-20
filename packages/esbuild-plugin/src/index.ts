import { dirname, join, resolve } from "node:path";

import {
  buildDarwinAppBundle,
  stageOpenTrayPackage,
  type DarwinAppBundleOptions,
  type OpenTrayArtifactInput,
  type OpenTrayPackagingApp,
  type OpenTrayPackageManifest,
  type OpenTrayPackageResult,
  type OpenTrayDarwinAppBundleResult,
} from "@opentray/packaging";

export interface OpenTrayEsbuildPluginOptions {
  readonly app: OpenTrayPackagingApp;
  readonly runtimeHost: OpenTrayArtifactInput;
  readonly nativeArtifacts?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly companionAssets?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly entry?: string;
  readonly manifestPath?: string;
  /**
   * Explicit outDir override. When omitted, resolved from the esbuild
   * `outdir`/`outfile` option or defaults to `dist`.
   */
  readonly outDir?: string;
  /**
   * Explicit mode override. Defaults to `production`.
   */
  readonly mode?: string;
}

/**
 * Structural view of the esbuild initial options the adapter consumes. Only the
 * staging-relevant fields are declared, so esbuild never has to be imported.
 */
export interface EsbuildInitialOptionsLike {
  readonly outdir?: string;
  readonly outfile?: string;
  readonly entryPoints?: readonly string[] | Readonly<Record<string, string>>;
  readonly absWorkingDir?: string;
}

export interface EsbuildBuildLike {
  readonly initialOptions: EsbuildInitialOptionsLike;
  onEnd(callback: (result: unknown) => Promise<void> | void): void;
}

export interface EsbuildPlugin {
  readonly name: string;
  readonly setup: (build: EsbuildBuildLike) => void;
}

export interface OpenTrayEsbuildPlugin extends EsbuildPlugin {
  readonly name: "opentray-packaging";
  /** Returns the last staging result. Only populated after `onEnd` runs. */
  readonly getLastResult: () => OpenTrayPackageResult | undefined;
}

export interface OpenTrayEsbuildAppBundlePluginOptions
  extends Omit<DarwinAppBundleOptions, "bundlePath" | "reinitialize"> {
  readonly bundlePath?: string;
}

export interface OpenTrayEsbuildAppBundlePlugin extends EsbuildPlugin {
  readonly name: "opentray-app-bundle";
  readonly getLastResult: () => OpenTrayDarwinAppBundleResult | undefined;
}

/** esbuild lifecycle adapter for the shared Darwin app bundle contract. */
export const openTrayAppBundlePlugin = (
  options: OpenTrayEsbuildAppBundlePluginOptions,
): OpenTrayEsbuildAppBundlePlugin => {
  let lastResult: OpenTrayDarwinAppBundleResult | undefined;
  return {
    name: "opentray-app-bundle",
    setup(build) {
      build.onEnd(async () => {
        const cwd = build.initialOptions.absWorkingDir ?? process.cwd();
        const bundlePath =
          options.bundlePath === undefined
            ? join(resolveEsbuildBundleOutputDir(build.initialOptions, cwd), `${options.appName}.app`)
            : resolve(cwd, options.bundlePath);
        lastResult = await buildDarwinAppBundle({ ...options, bundlePath });
      });
    },
    getLastResult: () => lastResult,
  };
};

export const openTrayEsbuildPlugin = (
  options: OpenTrayEsbuildPluginOptions,
): OpenTrayEsbuildPlugin => {
  let lastResult: OpenTrayPackageResult | undefined;

  // esbuild validates the enumerable own keys of a plugin object and rejects
  // anything beyond { name, setup }. Keep `getLastResult` non-enumerable so the
  // adapter can still expose the staging result to programmatic callers without
  // tripping esbuild's plugin validation.
  const plugin: OpenTrayEsbuildPlugin = {
    name: "opentray-packaging",
    setup(build) {
      build.onEnd(async () => {
        lastResult = await stageOpenTrayPackage({
          app: options.app,
          outDir: resolveEsbuildOutDir(options, build.initialOptions),
          entry: options.entry ?? resolveEsbuildEntry(build.initialOptions),
          adapter: { name: "esbuild", mode: options.mode ?? "production" },
          runtimeHost: options.runtimeHost,
          ...(options.nativeArtifacts === undefined
            ? {}
            : { nativeArtifacts: options.nativeArtifacts }),
          ...(options.companionAssets === undefined
            ? {}
            : { companionAssets: options.companionAssets }),
          ...(options.manifestPath === undefined ? {} : { manifestPath: options.manifestPath }),
        });
      });
    },
    getLastResult: () => lastResult,
  };
  Object.defineProperty(plugin, "getLastResult", { enumerable: false });
  return plugin;
};

const resolveEsbuildOutDir = (
  options: OpenTrayEsbuildPluginOptions,
  initialOptions: EsbuildInitialOptionsLike,
): string => {
  const cwd = initialOptions.absWorkingDir ?? process.cwd();
  if (options.outDir !== undefined) {
    return resolve(cwd, options.outDir);
  }
  if (initialOptions.outdir !== undefined && initialOptions.outdir.length > 0) {
    return resolve(cwd, initialOptions.outdir);
  }
  if (initialOptions.outfile !== undefined && initialOptions.outfile.length > 0) {
    return resolve(cwd, dirname(initialOptions.outfile));
  }
  return resolve(process.cwd(), "dist");
};

const resolveEsbuildBundleOutputDir = (
  initialOptions: EsbuildInitialOptionsLike,
  cwd: string,
): string => {
  if (initialOptions.outdir !== undefined && initialOptions.outdir.length > 0) {
    return resolve(cwd, initialOptions.outdir);
  }
  if (initialOptions.outfile !== undefined && initialOptions.outfile.length > 0) {
    return resolve(cwd, dirname(initialOptions.outfile));
  }
  return resolve(cwd, "dist");
};

export const resolveEsbuildEntry = (initialOptions: EsbuildInitialOptionsLike): string => {
  const entryPoints = initialOptions.entryPoints;
  if (entryPoints === undefined) {
    throw new Error(
      "OpenTray esbuild packaging requires esbuild entryPoints or an explicit entry option",
    );
  }
  if (Array.isArray(entryPoints)) {
    if (entryPoints.length === 0) {
      throw new Error(
        "OpenTray esbuild packaging requires esbuild entryPoints or an explicit entry option",
      );
    }
    return entryPoints[0] as string;
  }
  const first = Object.values(entryPoints)[0];
  if (first === undefined) {
    throw new Error(
      "OpenTray esbuild packaging requires esbuild entryPoints or an explicit entry option",
    );
  }
  return first;
};

export type { OpenTrayPackageManifest, OpenTrayPackageResult };
