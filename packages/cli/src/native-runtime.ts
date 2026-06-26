import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const requireFromSource = createRequire(import.meta.url);

export interface OpenTrayRuntimeBindingInfo {
  readonly kind: string;
  readonly protocolVersion: number;
}

export interface OpenTrayRuntimeBinding {
  runtimeBindingInfo(): OpenTrayRuntimeBindingInfo;
  createHeadlessRuntime?(packageVersion?: string): OpenTrayHeadlessRuntime;
}

export interface OpenTrayHeadlessRuntime {
  request(frameJson: string): string[] | Promise<string[]>;
  close(): string[] | Promise<string[]>;
}

export interface RuntimeNativeTarget {
  readonly packageName: string;
  readonly bindingRelativePath: string;
}

export interface ResolveRuntimeBindingOptions {
  readonly platform?: string;
  readonly arch?: string;
  readonly resolvePackageJson?: (packageName: string) => string | undefined;
  readonly nativeLoader?: (bindingPath: string) => unknown;
}

export const runtimeBindingRelativePath = "runtime/opentray_runtime.node";

export const resolveRuntimeNativeTarget = (
  platform: string = process.platform,
  arch: string = process.arch
): RuntimeNativeTarget => {
  const packageOs = platformToPackageOs(platform);
  const nativeArch = normalizeArch(arch);
  return {
    packageName: `@opentray/${packageOs}-${nativeArch}`,
    bindingRelativePath: runtimeBindingRelativePath,
  };
};

export const resolveInstalledRuntimeBindingPath = async ({
  platform = process.platform,
  arch = process.arch,
  resolvePackageJson = resolvePackageJsonFromSource,
}: ResolveRuntimeBindingOptions = {}): Promise<string> => {
  const target = resolveRuntimeNativeTarget(platform, arch);
  const packageJsonPath = resolvePackageJson(target.packageName);
  if (packageJsonPath === undefined) {
    throw new MissingPlatformRuntimeBindingError(
      `unable to resolve OpenTray runtime binding for ${platform}/${arch}; install ${target.packageName}`,
      platform,
      arch,
      { packageName: target.packageName }
    );
  }

  const bindingPath = join(
    dirname(packageJsonPath),
    target.bindingRelativePath
  );
  if (!(await exists(bindingPath))) {
    throw new MissingPlatformRuntimeBindingError(
      `OpenTray runtime package ${target.packageName} is installed but missing ${target.bindingRelativePath}`,
      platform,
      arch,
      {
        packageName: target.packageName,
        bindingPath,
      }
    );
  }
  return bindingPath;
};

export const loadOpenTrayRuntimeBinding = async (
  options: ResolveRuntimeBindingOptions = {}
): Promise<OpenTrayRuntimeBinding> => {
  const bindingPath = await resolveInstalledRuntimeBindingPath(options);
  const loaded = (options.nativeLoader ?? loadNativeModule)(bindingPath);
  if (!isRuntimeBinding(loaded)) {
    throw new MissingPlatformRuntimeBindingError(
      `OpenTray runtime binding ${bindingPath} does not expose runtimeBindingInfo()`,
      options.platform ?? process.platform,
      options.arch ?? process.arch,
      { bindingPath }
    );
  }
  return loaded;
};

const loadNativeModule = (bindingPath: string): unknown =>
  requireFromSource(bindingPath);

const isRuntimeBinding = (value: unknown): value is OpenTrayRuntimeBinding => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("runtimeBindingInfo" in value)
  ) {
    return false;
  }
  const binding = value as { runtimeBindingInfo?: unknown };
  return typeof binding.runtimeBindingInfo === "function";
};

const platformToPackageOs = (
  platform: string
): "darwin" | "linux" | "windows" => {
  switch (platform) {
    case "darwin":
    case "linux":
      return platform;
    case "win32":
      return "windows";
    default:
      throw new MissingPlatformRuntimeBindingError(
        `unsupported OpenTray runtime platform: ${platform}`,
        platform,
        process.arch
      );
  }
};

const normalizeArch = (arch: string): "arm64" | "x64" => {
  switch (arch) {
    case "arm64":
    case "x64":
      return arch;
    default:
      throw new MissingPlatformRuntimeBindingError(
        `unsupported OpenTray runtime architecture: ${arch}`,
        process.platform,
        arch
      );
  }
};

const resolvePackageJsonFromSource = (
  packageName: string
): string | undefined => {
  try {
    return requireFromSource.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (isNodeError(error) && error.code === "MODULE_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

export class MissingPlatformRuntimeBindingError extends Error {
  readonly code = "OPENTRAY_MISSING_PLATFORM_RUNTIME_BINDING";
  readonly platform: string;
  readonly arch: string;
  readonly packageName: string | undefined;
  readonly bindingPath: string | undefined;

  constructor(
    message: string,
    platform: string,
    arch: string,
    options: {
      readonly packageName?: string;
      readonly bindingPath?: string;
      readonly cause?: unknown;
    } = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "MissingPlatformRuntimeBindingError";
    this.platform = platform;
    this.arch = arch;
    this.packageName = options.packageName;
    this.bindingPath = options.bindingPath;
  }
}
