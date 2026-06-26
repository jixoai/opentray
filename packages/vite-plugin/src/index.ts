import { resolve } from "node:path";

import {
  stageOpenTrayPackage,
  type OpenTrayArtifactInput,
  type OpenTrayPackagingApp,
  type OpenTrayPackageManifest,
  type OpenTrayPackageResult,
} from "@opentray/packaging";

export interface OpenTrayVitePluginOptions {
  readonly app: OpenTrayPackagingApp;
  readonly runtimeHost: OpenTrayArtifactInput;
  readonly nativeArtifacts?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly companionAssets?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly entry?: string;
  readonly manifestPath?: string;
}

export interface ViteResolvedConfigLike {
  readonly root: string;
  readonly mode: string;
  readonly build: {
    readonly outDir: string;
  };
}

export interface ViteOutputChunkLike {
  readonly type?: string;
  readonly isEntry?: boolean;
  readonly fileName?: string;
  readonly facadeModuleId?: string | null;
  readonly name?: string;
}

export type ViteBundleLike = Readonly<Record<string, unknown>>;

export interface OpenTrayVitePlugin {
  readonly name: "opentray-packaging";
  readonly apply: "build";
  configResolved(config: ViteResolvedConfigLike): void;
  writeBundle(options: unknown, bundle: ViteBundleLike): Promise<void>;
  readonly getLastResult: () => OpenTrayPackageResult | undefined;
}

export const openTrayVitePlugin = (
  options: OpenTrayVitePluginOptions,
): OpenTrayVitePlugin => {
  let config: ViteResolvedConfigLike | undefined;
  let lastResult: OpenTrayPackageResult | undefined;

  return {
    name: "opentray-packaging",
    apply: "build",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async writeBundle(_options, bundle) {
      const resolvedConfig = config ?? {
        root: process.cwd(),
        mode: "production",
        build: { outDir: "dist" },
      };
      lastResult = await stageOpenTrayPackage({
        app: options.app,
        outDir: resolve(resolvedConfig.root, resolvedConfig.build.outDir),
        entry: options.entry ?? resolveViteEntry(bundle),
        adapter: { name: "vite", mode: resolvedConfig.mode },
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

export const resolveViteEntry = (bundle: ViteBundleLike): string => {
  const entry = Object.values(bundle)
    .map(asOutputChunk)
    .find((chunk): chunk is ViteOutputChunkLike => chunk?.isEntry === true);
  const identity = entry?.facadeModuleId ?? entry?.fileName ?? entry?.name;
  if (identity === undefined || identity.length === 0) {
    throw new Error("OpenTray Vite packaging requires a Vite entry chunk or explicit entry option");
  }
  return identity;
};

const asOutputChunk = (value: unknown): ViteOutputChunkLike | undefined => {
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
