import {
  stageOpenTrayPackage,
  type OpenTrayArtifactInput,
  type OpenTrayPackagingApp,
  type OpenTrayPackageManifest,
  type OpenTrayPackageResult,
} from "@opentray/packaging";

export interface OpenTrayWebpackPluginOptions {
  readonly app: OpenTrayPackagingApp;
  readonly runtimeHost: OpenTrayArtifactInput;
  readonly nativeArtifacts?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly companionAssets?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly entry?: string;
  readonly manifestPath?: string;
  /**
   * Explicit outDir override. When omitted, resolved from
   * `compiler.options.output.path`.
   */
  readonly outDir?: string;
  /**
   * Explicit mode override. When omitted, resolved from
   * `compiler.options.mode` or defaults to `production`.
   */
  readonly mode?: string;
}

/**
 * Structural view of the webpack compiler options the adapter consumes. Only the
 * staging-relevant fields are declared, so webpack never has to be imported.
 */
export interface WebpackOutputLike {
  readonly path?: string;
}

export interface WebpackEntryStaticLike {
  readonly main?: string | readonly string[];
}

export type WebpackEntryLike = string | readonly string[] | Readonly<Record<string, unknown>>;

export interface WebpackOptionsLike {
  readonly mode?: string;
  readonly output?: WebpackOutputLike;
  readonly entry?: WebpackEntryLike | WebpackEntryStaticLike;
}

export interface WebpackCompilationLike {
  readonly options: WebpackOptionsLike;
}

export interface WebpackTapableHook<T> {
  tapAsync(
    name: string,
    callback: (value: T, callback: (error?: Error) => void) => void,
  ): void;
}

export interface WebpackCompilerLike {
  readonly options: WebpackOptionsLike;
  readonly hooks: {
    readonly afterEmit: WebpackTapableHook<WebpackCompilationLike>;
  };
}

export interface OpenTrayWebpackPlugin {
  readonly name: "OpenTrayWebpackPlugin";
  apply(compiler: WebpackCompilerLike): void;
  /** Returns the last staging result. Only populated after `afterEmit` runs. */
  readonly getLastResult: () => OpenTrayPackageResult | undefined;
}

export const openTrayWebpackPlugin = (
  options: OpenTrayWebpackPluginOptions,
): OpenTrayWebpackPlugin => {
  let lastResult: OpenTrayPackageResult | undefined;

  return {
    name: "OpenTrayWebpackPlugin",
    apply(compiler) {
      compiler.hooks.afterEmit.tapAsync("OpenTrayWebpackPlugin", async (_compilation, cb) => {
        try {
          lastResult = await stageOpenTrayPackage({
            app: options.app,
            outDir: resolveWebpackOutDir(options, compiler.options),
            entry: options.entry ?? resolveWebpackEntry(compiler.options.entry),
            adapter: { name: "webpack", mode: resolveWebpackMode(options, compiler.options) },
            runtimeHost: options.runtimeHost,
            ...(options.nativeArtifacts === undefined
              ? {}
              : { nativeArtifacts: options.nativeArtifacts }),
            ...(options.companionAssets === undefined
              ? {}
              : { companionAssets: options.companionAssets }),
            ...(options.manifestPath === undefined
              ? {}
              : { manifestPath: options.manifestPath }),
          });
          cb();
        } catch (error) {
          cb(error as Error);
        }
      });
    },
    getLastResult: () => lastResult,
  };
};

const resolveWebpackOutDir = (
  options: OpenTrayWebpackPluginOptions,
  compilerOptions: WebpackOptionsLike,
): string => {
  if (options.outDir !== undefined) {
    return options.outDir;
  }
  const outputDir = compilerOptions.output?.path;
  if (outputDir !== undefined && outputDir.length > 0) {
    return outputDir;
  }
  return process.cwd();
};

const resolveWebpackMode = (
  options: OpenTrayWebpackPluginOptions,
  compilerOptions: WebpackOptionsLike,
): string => options.mode ?? compilerOptions.mode ?? "production";

export const resolveWebpackEntry = (
  entry: WebpackEntryLike | WebpackEntryStaticLike | undefined,
): string => {
  const missing = () =>
    new Error(
      "OpenTray webpack packaging requires a webpack entry or an explicit entry option",
    );
  if (entry === undefined) {
    throw missing();
  }
  const fromValue = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return value.length > 0 ? value : undefined;
    }
    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first === "string" && first.length > 0 ? first : undefined;
    }
    if (value !== null && typeof value === "object") {
      const record = value as Readonly<Record<string, unknown>>;
      const importValue = record.import;
      const fromImport = fromValue(importValue);
      if (fromImport !== undefined) {
        return fromImport;
      }
    }
    return undefined;
  };
  if (typeof entry === "string") {
    if (entry.length === 0) {
      throw missing();
    }
    return entry;
  }
  if (Array.isArray(entry)) {
    const first = fromValue(entry);
    if (first === undefined) {
      throw missing();
    }
    return first;
  }
  if (typeof entry === "object") {
    const record = entry as Readonly<Record<string, unknown>>;
    const mainValue = record.main;
    const fromMain = fromValue(mainValue);
    if (fromMain !== undefined) {
      return fromMain;
    }
    const firstValue = Object.values(record)[0];
    const fromFirst = fromValue(firstValue);
    if (fromFirst !== undefined) {
      return fromFirst;
    }
  }
  throw missing();
};

export type { OpenTrayPackageManifest, OpenTrayPackageResult };
