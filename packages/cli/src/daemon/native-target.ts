import type { BrokerArtifactTarget } from "@opentray/spec";

export type BrokerPackageOs = "darwin" | "linux" | "windows";
export type BrokerArch = "arm64" | "x64";

export interface BrokerNativeTarget {
  packageName: string;
  binaryRelativePath: string;
  carrierArchiveRelativePath?: string;
}

export const resolveBrokerNativeTarget = (
  platform: string = process.platform,
  arch: string = process.arch,
): BrokerNativeTarget => {
  const packageOs = platformToPackageOs(platform);
  const nativeArch = normalizeArch(arch);
  return {
    packageName: `@opentray/${packageOs}-${nativeArch}`,
    binaryRelativePath: `bin/${packageOs === "windows" ? "opentray.exe" : "opentray"}`,
    ...(packageOs === "darwin"
      ? { carrierArchiveRelativePath: "app/OpenTray.app.zip" }
      : {}),
  };
};

export const resolveBrokerArtifactTarget = (
  platform: string = process.platform,
  arch: string = process.arch,
): BrokerArtifactTarget => {
  const packageOs = platformToPackageOs(platform);
  return {
    os: packageOs === "windows" ? "win32" : packageOs,
    arch: normalizeArch(arch),
  };
};

const platformToPackageOs = (platform: string): BrokerPackageOs => {
  switch (platform) {
    case "darwin":
    case "linux":
      return platform;
    case "win32":
      return "windows";
    default:
      throw new MissingPlatformBrokerBinaryError(
        `unsupported OpenTray broker platform: ${platform}`,
        platform,
        process.arch,
      );
  }
};

const normalizeArch = (arch: string): BrokerArch => {
  switch (arch) {
    case "arm64":
    case "x64":
      return arch;
    default:
      throw new MissingPlatformBrokerBinaryError(
        `unsupported OpenTray broker architecture: ${arch}`,
        process.platform,
        arch,
      );
  }
};

export class MissingPlatformBrokerBinaryError extends Error {
  readonly code = "OPENTRAY_MISSING_PLATFORM_BROKER_BINARY";
  readonly platform: string;
  readonly arch: string;
  readonly packageName: string | undefined;
  readonly binaryPath: string | undefined;

  constructor(
    message: string,
    platform: string,
    arch: string,
    options: {
      packageName?: string;
      binaryPath?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MissingPlatformBrokerBinaryError";
    this.platform = platform;
    this.arch = arch;
    this.packageName = options.packageName;
    this.binaryPath = options.binaryPath;
  }
}
