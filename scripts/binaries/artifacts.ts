import { chmod, copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type PackageOs = "darwin" | "linux" | "windows";
export type NpmOs = "darwin" | "linux" | "win32";
export type NativeArch = "arm64" | "x64";
export type NativeStageKind =
  | "runtime"
  | "webview"
  | "badge";
// Darwin runtime packages publish only the bundle template. The runtime owns
// materializing the caller-specific .app directory around the broker.
export const darwinRuntimeCarrierArtifactName = "Info.plist";
export const badgeDockHelperArtifactName = "OpenTrayBadgeHelper.app.zip";
export const runtimeExecutableArtifactName = "opentray";

export interface NativeTarget {
  packageOs: PackageOs;
  npmOs: NpmOs;
  arch: NativeArch;
  runtimePackageName: string;
  runtimePackageDir: string;
  runtimeArtifact: string;
  runtimeCarrierArtifact?: string;
  webviewPackageName?: string;
  webviewPackageDir?: string;
  webviewArtifact?: string;
  badgePackageName?: string;
  badgePackageDir?: string;
  badgeArtifact?: string;
  badgeHelperArtifact?: string;
}

const packageTargets = [
  ["darwin", "darwin", "arm64"],
  ["darwin", "darwin", "x64"],
  ["linux", "linux", "arm64"],
  ["linux", "linux", "x64"],
  ["windows", "win32", "arm64"],
  ["windows", "win32", "x64"],
] as const satisfies ReadonlyArray<readonly [PackageOs, NpmOs, NativeArch]>;

export function createNativeTarget(
  packageOs: PackageOs,
  npmOs: NpmOs,
  arch: NativeArch
): NativeTarget {
  const runtimePackageDir = `packages/${packageOs}-${arch}`;
  const runtimeCarrierArtifact =
    packageOs === "darwin"
      ? `${runtimePackageDir}/app/${darwinRuntimeCarrierArtifactName}`
      : undefined;
  const webviewPackageDir =
    packageOs === "linux"
      ? undefined
      : `packages/ext-webview-${packageOs}-${arch}`;
  const badgePackageDir =
    packageOs === "linux"
      ? undefined
      : `packages/ext-badge-${packageOs}-${arch}`;
  const badgeArtifact =
    badgePackageDir === undefined
      ? undefined
      : packageOs === "windows"
      ? `${badgePackageDir}/bin/opentray_ext_badge.dll`
      : `${badgePackageDir}/lib/libopentray_ext_badge.dylib`;
  const badgeHelperArtifact =
    badgePackageDir === undefined || packageOs !== "darwin"
      ? undefined
      : `${badgePackageDir}/app/${badgeDockHelperArtifactName}`;
  const badgePackageName =
    badgePackageDir === undefined
      ? undefined
      : `@opentray/ext-badge-${packageOs}-${arch}`;
  return {
    packageOs,
    npmOs,
    arch,
    runtimePackageName: `@opentray/${packageOs}-${arch}`,
    runtimePackageDir,
    runtimeArtifact: `${runtimePackageDir}/bin/${
      packageOs === "windows" ? "opentray.exe" : runtimeExecutableArtifactName
    }`,
    runtimeCarrierArtifact,
    webviewPackageName:
      webviewPackageDir === undefined
        ? undefined
        : `@opentray/ext-webview-${packageOs}-${arch}`,
    webviewPackageDir,
    webviewArtifact:
      webviewPackageDir === undefined
        ? undefined
        : packageOs === "windows"
        ? `${webviewPackageDir}/bin/opentray_ext_webview.dll`
        : `${webviewPackageDir}/lib/libopentray_ext_webview.dylib`,
    badgePackageName,
    badgePackageDir,
    badgeArtifact,
    badgeHelperArtifact,
  };
}

export const nativeTargets: readonly NativeTarget[] = packageTargets.map(
  ([packageOs, npmOs, arch]) => createNativeTarget(packageOs, npmOs, arch)
);

export const resolveNativeTarget = (
  platform = process.platform,
  arch = process.arch
): NativeTarget => {
  const packageOs = platformToPackageOs(platform);
  const nativeArch = normalizeArch(arch);
  return resolveNativePackageTarget(packageOs, nativeArch);
};

export const resolveNativePackageTarget = (
  packageOs: PackageOs,
  arch: NativeArch
): NativeTarget => {
  const target = nativeTargets.find(
    (candidate) => candidate.packageOs === packageOs && candidate.arch === arch
  );
  if (target === undefined) {
    throw new Error(
      `unsupported OpenTray native target: packageOs=${packageOs} arch=${arch}`
    );
  }
  return target;
};

export const platformToPackageOs = (platform: string): PackageOs => {
  switch (platform) {
    case "windows":
      return "windows";
    case "darwin":
    case "linux":
      return platform;
    case "win32":
      return "windows";
    default:
      throw new Error(`unsupported OpenTray platform: ${platform}`);
  }
};

export const normalizeArch = (arch: string): NativeArch => {
  switch (arch) {
    case "arm64":
    case "x64":
      return arch;
    default:
      throw new Error(`unsupported OpenTray architecture: ${arch}`);
  }
};

export const resolveStageDestination = (
  target: NativeTarget,
  kind: NativeStageKind
): string => {
  switch (kind) {
    case "runtime":
      return target.runtimeArtifact;
    case "webview":
      if (target.webviewArtifact === undefined) {
        throw new Error(
          `target ${target.packageOs}-${target.arch} does not publish a webview native extension`
        );
      }
      return target.webviewArtifact;
    case "badge":
      if (target.badgeArtifact === undefined) {
        throw new Error(
          `target ${target.packageOs}-${target.arch} does not publish a badge native artifact`
        );
      }
      return target.badgeArtifact;
  }
};

export const stageArtifact = async (
  workspaceRoot: string,
  source: string,
  destination: string
): Promise<void> => {
  const absoluteDestination = join(workspaceRoot, destination);
  await mkdir(dirname(absoluteDestination), { recursive: true });
  // Source control stays binary-free; local and CI staging populate package artifacts just before smoke/publish.
  await copyFile(source, absoluteDestination);
  if (
    !destination.endsWith(".dll") &&
    !destination.endsWith(".zip") &&
    !destination.endsWith(".plist")
  ) {
    await chmod(absoluteDestination, 0o755);
  }
};

export const resolveStageDestinationForArtifactFile = (
  target: NativeTarget,
  fileName: string
): string => {
  const candidates = [
    target.runtimeArtifact,
    target.runtimeCarrierArtifact,
    target.webviewArtifact,
    target.badgeArtifact,
    target.badgeHelperArtifact,
  ].filter((candidate): candidate is string => candidate !== undefined);

  const destination = candidates.find(
    (candidate) => basename(candidate) === fileName
  );
  if (destination === undefined) {
    throw new Error(
      `target ${target.packageOs}-${target.arch} does not publish an artifact named ${fileName}`
    );
  }
  return destination;
};
