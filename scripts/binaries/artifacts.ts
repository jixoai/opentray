import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PackageOs = "darwin" | "linux" | "windows";
export type NpmOs = "darwin" | "linux" | "win32";
export type NativeArch = "arm64" | "x64";

export interface NativeTarget {
  packageOs: PackageOs;
  npmOs: NpmOs;
  arch: NativeArch;
  daemonPackageName: string;
  daemonPackageDir: string;
  daemonArtifact: string;
  webviewPackageName: string;
  webviewPackageDir: string;
  webviewArtifact: string;
}

const packageTargets = [
  ["darwin", "darwin", "arm64"],
  ["darwin", "darwin", "x64"],
  ["linux", "linux", "arm64"],
  ["linux", "linux", "x64"],
  ["windows", "win32", "arm64"],
  ["windows", "win32", "x64"],
] as const satisfies ReadonlyArray<readonly [PackageOs, NpmOs, NativeArch]>;

export function createNativeTarget(packageOs: PackageOs, npmOs: NpmOs, arch: NativeArch): NativeTarget {
  const daemonPackageDir = `packages/${packageOs}-${arch}`;
  const webviewPackageDir = `packages/ext-webview-${packageOs}-${arch}`;

  return {
    packageOs,
    npmOs,
    arch,
    daemonPackageName: `@opentray/${packageOs}-${arch}`,
    daemonPackageDir,
    daemonArtifact: `${daemonPackageDir}/bin/${packageOs === "windows" ? "opentray.exe" : "opentray"}`,
    webviewPackageName: `@opentray/ext-webview-${packageOs}-${arch}`,
    webviewPackageDir,
    webviewArtifact:
      packageOs === "windows"
        ? `${webviewPackageDir}/bin/opentray_ext_webview.dll`
        : `${webviewPackageDir}/lib/libopentray_ext_webview.${packageOs === "darwin" ? "dylib" : "so"}`,
  };
}

export const nativeTargets: readonly NativeTarget[] = packageTargets.map(([packageOs, npmOs, arch]) =>
  createNativeTarget(packageOs, npmOs, arch),
);

export const resolveNativeTarget = (platform = process.platform, arch = process.arch): NativeTarget => {
  const packageOs = platformToPackageOs(platform);
  const nativeArch = normalizeArch(arch);
  const target = nativeTargets.find((candidate) => candidate.packageOs === packageOs && candidate.arch === nativeArch);
  if (target === undefined) {
    throw new Error(`unsupported OpenTray native target: platform=${platform} arch=${arch}`);
  }
  return target;
};

export const platformToPackageOs = (platform: string): PackageOs => {
  switch (platform) {
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

export const stageArtifact = async (workspaceRoot: string, source: string, destination: string): Promise<void> => {
  const absoluteDestination = join(workspaceRoot, destination);
  await mkdir(dirname(absoluteDestination), { recursive: true });
  await copyFile(source, absoluteDestination);
  if (!destination.endsWith(".dll")) {
    await chmod(absoluteDestination, 0o755);
  }
};
