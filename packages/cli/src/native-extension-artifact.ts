// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Describe package-owned and exact-file native extension artifacts without importing binaries.
// 2. Resolve platform packages from the declaring facade's dependency closure.
// 3. Reject missing targets, invalid package metadata, and inaccessible native libraries precisely.

import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type NativeExtensionArch = "arm64" | "x64";
export type NativeExtensionTarget = `${NodeJS.Platform}-${NativeExtensionArch}`;

export interface NativeExtensionPackageTarget {
  packageName: string;
  libraryPath: string;
}

export interface NativeExtensionPackageArtifact {
  kind: "package";
  packageJsonUrl: string;
  contractManifestUrl: string;
  targets: Partial<Record<NativeExtensionTarget, NativeExtensionPackageTarget>>;
}

export interface NativeExtensionFileArtifact {
  kind: "file";
  path: string;
}

export type NativeExtensionArtifact =
  | NativeExtensionPackageArtifact
  | NativeExtensionFileArtifact;

export interface NativeExtensionExpectedIdentity {
  extensionName: string;
  artifactSetVersion: string;
  contractFingerprint: string;
  target: NativeExtensionTarget;
}

export interface ResolvedNativeExtensionArtifact {
  path: string;
  packageName?: string;
  packageVersion?: string;
  expectedIdentity?: NativeExtensionExpectedIdentity;
  target: NativeExtensionTarget;
}

export class NativeExtensionArtifactResolutionError extends Error {
  readonly code = "OPENTRAY_NATIVE_EXTENSION_ARTIFACT_RESOLUTION_FAILED";
  readonly packageName?: string;
  readonly facadePackageJsonUrl?: string;

  constructor(
    message: string,
    readonly target: NativeExtensionTarget,
    options: ErrorOptions & {
      packageName?: string;
      facadePackageJsonUrl?: string;
    } = {}
  ) {
    super(message, options);
    this.name = "NativeExtensionArtifactResolutionError";
    if (options.packageName !== undefined) {
      this.packageName = options.packageName;
    }
    if (options.facadePackageJsonUrl !== undefined) {
      this.facadePackageJsonUrl = options.facadePackageJsonUrl;
    }
  }
}

/** Resolve one exact native library from the dependency closure that owns the facade. */
export const resolveNativeExtensionArtifact = async (
  artifact: NativeExtensionArtifact,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<ResolvedNativeExtensionArtifact> => {
  const target = nativeExtensionTarget(platform, arch);
  if (artifact.kind === "file") {
    return {
      path: await resolveAccessibleLibrary(artifact.path, target),
      target,
    };
  }

  const packageTarget = artifact.targets[target];
  if (packageTarget === undefined) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension does not support target ${target}`,
      target
    );
  }

  const [facadeManifest, contractManifest] = await Promise.all([
    readFacadePackageManifest(artifact.packageJsonUrl, target),
    readExtensionContractManifest(artifact.contractManifestUrl, target),
  ]);

  const resolveFromFacade = createRequire(artifact.packageJsonUrl);
  let platformPackageJsonPath: string;
  try {
    platformPackageJsonPath = resolveFromFacade.resolve(
      `${packageTarget.packageName}/package.json`
    );
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `unable to resolve native extension package "${packageTarget.packageName}" for ${target} from ${artifact.packageJsonUrl}`,
      target,
      {
        cause,
        packageName: packageTarget.packageName,
        facadePackageJsonUrl: artifact.packageJsonUrl,
      }
    );
  }

  const manifest = await readPlatformPackageManifest(
    platformPackageJsonPath,
    target,
    packageTarget.packageName
  );
  const libraryPath = join(dirname(platformPackageJsonPath), packageTarget.libraryPath);
  return {
    path: await resolveAccessibleLibrary(libraryPath, target, packageTarget.packageName),
    packageName: packageTarget.packageName,
    packageVersion: manifest.version,
    expectedIdentity: {
      extensionName: contractManifest.extensionName,
      artifactSetVersion: facadeManifest.version,
      contractFingerprint: contractManifest.contractFingerprint,
      target,
    },
    target,
  };
};

const nativeExtensionTarget = (
  platform: NodeJS.Platform,
  arch: string
): NativeExtensionTarget => {
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`unsupported native extension architecture: ${arch}`);
  }
  return `${platform}-${arch}`;
};

interface PlatformPackageManifest {
  name: string;
  version: string;
  os?: string[];
  cpu?: string[];
}

interface FacadePackageManifest {
  name: string;
  version: string;
}

interface ExtensionContractManifest {
  extensionName: string;
  contractFingerprint: string;
}

const readFacadePackageManifest = async (
  packageJsonUrl: string,
  target: NativeExtensionTarget
): Promise<FacadePackageManifest> => {
  const parsed = await readJsonUrl(packageJsonUrl, target, "facade package manifest");
  if (!isFacadePackageManifest(parsed)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension facade manifest is invalid at ${packageJsonUrl}`,
      target,
      { facadePackageJsonUrl: packageJsonUrl }
    );
  }
  return parsed;
};

const readExtensionContractManifest = async (
  contractManifestUrl: string,
  target: NativeExtensionTarget
): Promise<ExtensionContractManifest> => {
  const parsed = await readJsonUrl(
    contractManifestUrl,
    target,
    "extension contract manifest"
  );
  if (!isExtensionContractManifest(parsed)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension contract manifest is invalid at ${contractManifestUrl}`,
      target
    );
  }
  return parsed;
};

const readJsonUrl = async (
  url: string,
  target: NativeExtensionTarget,
  label: string
): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(new URL(url), "utf8"));
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `unable to read ${label} at ${url}`,
      target,
      { cause }
    );
  }
};

const readPlatformPackageManifest = async (
  packageJsonPath: string,
  target: NativeExtensionTarget,
  packageName: string
): Promise<PlatformPackageManifest> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `unable to read native extension package manifest at ${packageJsonPath}`,
      target,
      { cause, packageName }
    );
  }
  if (!isPlatformPackageManifest(parsed) || parsed.name !== packageName) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension package manifest at ${packageJsonPath} does not identify ${packageName}`,
      target,
      { packageName }
    );
  }
  const [platform, arch] = splitTarget(target);
  if (parsed.os !== undefined && !parsed.os.includes(platform)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension package ${packageName} does not support os ${platform}`,
      target,
      { packageName }
    );
  }
  if (parsed.cpu !== undefined && !parsed.cpu.includes(arch)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension package ${packageName} does not support cpu ${arch}`,
      target,
      { packageName }
    );
  }
  return parsed;
};

const isPlatformPackageManifest = (
  value: unknown
): value is PlatformPackageManifest =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "version" in value &&
  typeof value.version === "string" &&
  (!("os" in value) ||
    (Array.isArray(value.os) && value.os.every((item) => typeof item === "string"))) &&
  (!("cpu" in value) ||
    (Array.isArray(value.cpu) && value.cpu.every((item) => typeof item === "string")));

const isFacadePackageManifest = (value: unknown): value is FacadePackageManifest =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "version" in value &&
  typeof value.version === "string";

const isExtensionContractManifest = (
  value: unknown
): value is ExtensionContractManifest =>
  typeof value === "object" &&
  value !== null &&
  "extensionName" in value &&
  typeof value.extensionName === "string" &&
  "contractFingerprint" in value &&
  typeof value.contractFingerprint === "string";

const splitTarget = (
  target: NativeExtensionTarget
): [NodeJS.Platform, NativeExtensionArch] => {
  const separator = target.lastIndexOf("-");
  return [
    target.slice(0, separator) as NodeJS.Platform,
    target.slice(separator + 1) as NativeExtensionArch,
  ];
};

const resolveAccessibleLibrary = async (
  path: string,
  target: NativeExtensionTarget,
  packageName?: string
): Promise<string> => {
  try {
    return await realpath(path);
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension library is not accessible at ${path}`,
      target,
      {
        cause,
        ...(packageName === undefined ? {} : { packageName }),
      }
    );
  }
};
