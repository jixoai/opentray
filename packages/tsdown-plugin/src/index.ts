import { join, resolve } from "node:path";

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

export interface OpenTrayTsdownPluginOptions {
  readonly app: OpenTrayPackagingApp;
  readonly runtimeHost: OpenTrayArtifactInput;
  readonly nativeArtifacts?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly companionAssets?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly entry?: string;
  readonly manifestPath?: string;
  /**
   * Explicit outDir override. When omitted, resolved from the writeBundle
   * output options (`options.dir`) or defaults to `dist`.
   */
  readonly outDir?: string;
  /**
   * Explicit mode override. Defaults to `production`.
   */
  readonly mode?: string;
}

/**
 * Structural view of the Rolldown output options the adapter consumes. Only the
 * staging-relevant fields are declared, so tsdown never has to be imported.
 */
export interface TsdownOutputOptionsLike {
  readonly dir?: string;
  readonly file?: string;
}

export interface TsdownOutputChunkLike {
  readonly type?: string;
  readonly isEntry?: boolean;
  readonly fileName?: string;
  readonly facadeModuleId?: string | null;
  readonly name?: string;
}

export type TsdownBundleLike = Readonly<Record<string, unknown>>;

export interface OpenTrayTsdownPlugin {
  readonly name: "opentray-packaging";
  writeBundle(options: TsdownOutputOptionsLike, bundle: TsdownBundleLike): Promise<void>;
  readonly getLastResult: () => OpenTrayPackageResult | undefined;
}

export interface OpenTrayTsdownAppBundlePluginOptions
  extends Omit<DarwinAppBundleOptions, "bundlePath" | "reinitialize"> {
  readonly bundlePath?: string;
}

export interface OpenTrayTsdownAppBundlePlugin {
  readonly name: "opentray-app-bundle";
  writeBundle(options: TsdownOutputOptionsLike): Promise<void>;
  readonly getLastResult: () => OpenTrayDarwinAppBundleResult | undefined;
}

/** tsdown lifecycle adapter for the shared Darwin app bundle contract. */
export const openTrayAppBundlePlugin = (
  options: OpenTrayTsdownAppBundlePluginOptions,
): OpenTrayTsdownAppBundlePlugin => {
  let lastResult: OpenTrayDarwinAppBundleResult | undefined;
  return {
    name: "opentray-app-bundle",
    async writeBundle(outputOptions) {
      const outDir = resolveTsdownBundleOutputDir(outputOptions);
      const bundlePath =
        options.bundlePath === undefined
          ? join(outDir, `${options.appName}.app`)
          : resolve(options.bundlePath);
      lastResult = await buildDarwinAppBundle({ ...options, bundlePath });
    },
    getLastResult: () => lastResult,
  };
};

const resolveTsdownBundleOutputDir = (
  outputOptions: TsdownOutputOptionsLike,
): string => {
  if (outputOptions.dir !== undefined && outputOptions.dir.length > 0) {
    return outputOptions.dir;
  }
  if (outputOptions.file !== undefined && outputOptions.file.length > 0) {
    return resolve(outputOptions.file, "..");
  }
  return resolve(process.cwd(), "dist");
};

export const openTrayTsdownPlugin = (
  options: OpenTrayTsdownPluginOptions,
): OpenTrayTsdownPlugin => {
  let lastResult: OpenTrayPackageResult | undefined;

  return {
    name: "opentray-packaging",
    async writeBundle(outputOptions, bundle) {
      lastResult = await stageOpenTrayPackage({
        app: options.app,
        outDir: resolveOutDir(options, outputOptions),
        entry: options.entry ?? resolveTsdownEntry(bundle),
        adapter: { name: "tsdown", mode: options.mode ?? "production" },
        runtimeHost: options.runtimeHost,
        ...(options.nativeArtifacts === undefined
          ? {}
          : { nativeArtifacts: options.nativeArtifacts }),
        ...(options.companionAssets === undefined
          ? {}
          : { companionAssets: options.companionAssets }),
        ...(options.manifestPath === undefined ? {} : { manifestPath: options.manifestPath }),
      });
    },
    getLastResult: () => lastResult,
  };
};

const resolveOutDir = (
  options: OpenTrayTsdownPluginOptions,
  outputOptions: TsdownOutputOptionsLike,
): string => {
  if (options.outDir !== undefined) {
    return resolve(options.outDir);
  }
  if (outputOptions.dir !== undefined && outputOptions.dir.length > 0) {
    return outputOptions.dir;
  }
  if (outputOptions.file !== undefined && outputOptions.file.length > 0) {
    return resolve(outputOptions.file, "..");
  }
  return resolve(process.cwd(), "dist");
};

export const resolveTsdownEntry = (bundle: TsdownBundleLike): string => {
  const entry = Object.values(bundle)
    .map(asOutputChunk)
    .find((chunk): chunk is TsdownOutputChunkLike => chunk?.isEntry === true);
  const identity = entry?.facadeModuleId ?? entry?.fileName ?? entry?.name;
  if (identity === undefined || identity.length === 0) {
    throw new Error(
      "OpenTray tsdown packaging requires a bundle entry chunk or explicit entry option",
    );
  }
  return identity;
};

const asOutputChunk = (value: unknown): TsdownOutputChunkLike | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    ...(record.type === "chunk" ? { type: "chunk" } : {}),
    ...(typeof record.isEntry === "boolean" ? { isEntry: record.isEntry } : {}),
    ...(typeof record.fileName === "string" ? { fileName: record.fileName } : {}),
    ...(typeof record.facadeModuleId === "string" || record.facadeModuleId === null
      ? { facadeModuleId: record.facadeModuleId }
      : {}),
    ...(typeof record.name === "string" ? { name: record.name } : {}),
  };
};

export type { OpenTrayPackageManifest, OpenTrayPackageResult };
