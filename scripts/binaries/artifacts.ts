import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PackageOs = "darwin" | "linux" | "windows";
export type NpmOs = "darwin" | "linux" | "win32";
export type NativeArch = "arm64" | "x64";
export type NativeStageKind = "daemon" | "webview" | "lynx" | "lynx-runtime";

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
  lynxPackageName?: string;
  lynxPackageDir?: string;
  lynxArtifact?: string;
  lynxRuntimeArtifact?: string;
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
  const lynxPackageDir = packageOs === "darwin" ? `packages/ext-lynx-${packageOs}-${arch}` : undefined;

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
    lynxPackageName: lynxPackageDir === undefined ? undefined : `@opentray/ext-lynx-${packageOs}-${arch}`,
    lynxPackageDir,
    lynxArtifact:
      lynxPackageDir === undefined ? undefined : `${lynxPackageDir}/lib/libopentray_ext_lynx.dylib`,
    lynxRuntimeArtifact:
      lynxPackageDir === undefined ? undefined : `${lynxPackageDir}/runtime/LynxExplorer.app.zip`,
  };
}

export const nativeTargets: readonly NativeTarget[] = packageTargets.map(([packageOs, npmOs, arch]) =>
  createNativeTarget(packageOs, npmOs, arch),
);

export const resolveNativeTarget = (platform = process.platform, arch = process.arch): NativeTarget => {
  const packageOs = platformToPackageOs(platform);
  const nativeArch = normalizeArch(arch);
  return resolveNativePackageTarget(packageOs, nativeArch);
};

export const resolveNativePackageTarget = (packageOs: PackageOs, arch: NativeArch): NativeTarget => {
  const target = nativeTargets.find((candidate) => candidate.packageOs === packageOs && candidate.arch === arch);
  if (target === undefined) {
    throw new Error(`unsupported OpenTray native target: packageOs=${packageOs} arch=${arch}`);
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
  kind: NativeStageKind,
): string => {
  switch (kind) {
    case "daemon":
      return target.daemonArtifact;
    case "webview":
      return target.webviewArtifact;
    case "lynx":
      if (target.lynxArtifact === undefined) {
        throw new Error(`target ${target.packageOs}-${target.arch} does not publish a lynx dylib`);
      }
      return target.lynxArtifact;
    case "lynx-runtime":
      if (target.lynxRuntimeArtifact === undefined) {
        throw new Error(`target ${target.packageOs}-${target.arch} does not publish a lynx runtime`);
      }
      return target.lynxRuntimeArtifact;
  }
};

export const stageArtifact = async (workspaceRoot: string, source: string, destination: string): Promise<void> => {
  const absoluteDestination = join(workspaceRoot, destination);
  await mkdir(dirname(absoluteDestination), { recursive: true });
  // Source control stays binary-free; local and CI staging populate package artifacts just before smoke/publish.
  await copyFile(source, absoluteDestination);
  if (!destination.endsWith(".dll")) {
    await chmod(absoluteDestination, 0o755);
  }
};
