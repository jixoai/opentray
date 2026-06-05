import { mkdir, copyFile, chmod, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

import {
  type NativeArch,
  type PackageOs,
  normalizeArch,
  resolveNativePackageTarget,
} from "./artifacts";

export type PreviewBuildFamily =
  | "core-broker"
  | "ext-webview-native"
  | "ext-lynx-native"
  | "ext-lynx-runtime";

export type PreviewTargetName =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "windows-arm64"
  | "windows-x64";

export type PreviewArtifactKind = "daemon" | "webview" | "lynx" | "lynx-runtime";

export interface PreviewTargetConfig {
  readonly id: PreviewTargetName;
  readonly packageOs: PackageOs;
  readonly arch: NativeArch;
  readonly runner: string;
  readonly previewJobTimeoutMinutes: number;
  readonly lynxRuntimeTimeoutSeconds: number;
  readonly lynxRuntimeJobTimeoutMinutes: number;
}

export interface PreviewFamilyConfig {
  readonly family: PreviewBuildFamily;
  readonly defaultTargets: readonly PreviewTargetName[];
  readonly allowedTargets: readonly PreviewTargetName[];
  readonly cargoPackages: readonly string[];
  readonly artifactKinds: readonly PreviewArtifactKind[];
  readonly buildLynxRuntime: boolean;
  readonly inferredPackagePrefixes: readonly string[];
  readonly inferredPackages: readonly string[];
}

export interface PreviewBuildJob {
  readonly alias: string;
  readonly family: PreviewBuildFamily;
  readonly target: PreviewTargetName;
  readonly runner: string;
  readonly jobTimeoutMinutes: number;
  readonly lynxRuntimeTimeoutSeconds: number;
  readonly buildLynxRuntime: boolean;
}

export interface PreviewBuildManifest {
  readonly alias: string;
  readonly family: PreviewBuildFamily;
  readonly target: PreviewTargetName;
  readonly artifactKinds: readonly PreviewArtifactKind[];
  readonly files: readonly string[];
}

const previewTargets: Record<PreviewTargetName, PreviewTargetConfig> = {
  "darwin-arm64": {
    id: "darwin-arm64",
    packageOs: "darwin",
    arch: "arm64",
    runner: "macos-15",
    previewJobTimeoutMinutes: 60,
    lynxRuntimeTimeoutSeconds: 4_500,
    lynxRuntimeJobTimeoutMinutes: 90,
  },
  "darwin-x64": {
    id: "darwin-x64",
    packageOs: "darwin",
    arch: "x64",
    runner: "macos-15-intel",
    previewJobTimeoutMinutes: 75,
    lynxRuntimeTimeoutSeconds: 5_700,
    lynxRuntimeJobTimeoutMinutes: 120,
  },
  "linux-arm64": {
    id: "linux-arm64",
    packageOs: "linux",
    arch: "arm64",
    runner: "ubuntu-24.04-arm",
    previewJobTimeoutMinutes: 45,
    lynxRuntimeTimeoutSeconds: 0,
    lynxRuntimeJobTimeoutMinutes: 45,
  },
  "linux-x64": {
    id: "linux-x64",
    packageOs: "linux",
    arch: "x64",
    runner: "ubuntu-24.04",
    previewJobTimeoutMinutes: 45,
    lynxRuntimeTimeoutSeconds: 0,
    lynxRuntimeJobTimeoutMinutes: 45,
  },
  "windows-arm64": {
    id: "windows-arm64",
    packageOs: "windows",
    arch: "arm64",
    runner: "windows-11-arm",
    previewJobTimeoutMinutes: 45,
    lynxRuntimeTimeoutSeconds: 0,
    lynxRuntimeJobTimeoutMinutes: 45,
  },
  "windows-x64": {
    id: "windows-x64",
    packageOs: "windows",
    arch: "x64",
    runner: "windows-2025",
    previewJobTimeoutMinutes: 45,
    lynxRuntimeTimeoutSeconds: 0,
    lynxRuntimeJobTimeoutMinutes: 45,
  },
};

const previewFamilies: Record<PreviewBuildFamily, PreviewFamilyConfig> = {
  "core-broker": {
    family: "core-broker",
    defaultTargets: ["darwin-arm64"],
    allowedTargets: Object.keys(previewTargets) as PreviewTargetName[],
    cargoPackages: ["opentray-bin"],
    artifactKinds: ["daemon"],
    buildLynxRuntime: false,
    inferredPackagePrefixes: ["@opentray/darwin-", "@opentray/linux-", "@opentray/windows-"],
    inferredPackages: ["opentray"],
  },
  "ext-webview-native": {
    family: "ext-webview-native",
    defaultTargets: ["darwin-arm64"],
    allowedTargets: Object.keys(previewTargets) as PreviewTargetName[],
    cargoPackages: ["opentray-bin", "opentray-ext-webview"],
    artifactKinds: ["daemon", "webview"],
    buildLynxRuntime: false,
    inferredPackagePrefixes: ["@opentray/ext-webview-"],
    inferredPackages: ["@opentray/ext-webview"],
  },
  "ext-lynx-native": {
    family: "ext-lynx-native",
    defaultTargets: ["darwin-arm64"],
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    cargoPackages: ["opentray-bin", "opentray-ext-lynx"],
    artifactKinds: ["daemon", "lynx"],
    buildLynxRuntime: false,
    inferredPackagePrefixes: ["@opentray/ext-lynx-"],
    inferredPackages: ["@opentray/ext-lynx"],
  },
  "ext-lynx-runtime": {
    family: "ext-lynx-runtime",
    defaultTargets: ["darwin-arm64"],
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    cargoPackages: [],
    artifactKinds: ["lynx-runtime"],
    buildLynxRuntime: true,
    inferredPackagePrefixes: [],
    inferredPackages: [],
  },
};

export const previewBuildTargetNames = Object.keys(previewTargets) as PreviewTargetName[];
export const previewBuildFamilies = Object.keys(previewFamilies) as PreviewBuildFamily[];

export const isPreviewBuildFamily = (value: string): value is PreviewBuildFamily =>
  value in previewFamilies;

export const isPreviewTargetName = (value: string): value is PreviewTargetName =>
  value in previewTargets;

export const resolvePreviewTarget = (target: PreviewTargetName): PreviewTargetConfig => {
  const resolved = previewTargets[target];
  if (resolved === undefined) {
    throw new Error(`unsupported preview build target: ${target}`);
  }
  return resolved;
};

export const resolvePreviewFamily = (family: PreviewBuildFamily): PreviewFamilyConfig => {
  const resolved = previewFamilies[family];
  if (resolved === undefined) {
    throw new Error(`unsupported preview build family: ${family}`);
  }
  return resolved;
};

export const inferPreviewFamiliesFromReleasePackages = (
  releasePackages: readonly string[],
): PreviewBuildFamily[] => {
  const inferred = new Set<PreviewBuildFamily>();
  for (const releasePackage of releasePackages) {
    if (matchesFamilyReleasePackage("ext-webview-native", releasePackage)) {
      inferred.add("ext-webview-native");
      continue;
    }
    if (matchesFamilyReleasePackage("ext-lynx-native", releasePackage)) {
      inferred.add("ext-lynx-native");
      inferred.add("ext-lynx-runtime");
      continue;
    }
    if (matchesFamilyReleasePackage("core-broker", releasePackage)) {
      inferred.add("core-broker");
    }
  }
  if (inferred.has("ext-webview-native") || inferred.has("ext-lynx-native")) {
    inferred.delete("core-broker");
  }
  return [...inferred];
};

export const resolvePreviewTargetsForFamilies = (
  families: readonly PreviewBuildFamily[],
  explicitTargets: readonly PreviewTargetName[] | undefined,
): PreviewTargetName[] => {
  if (explicitTargets !== undefined && explicitTargets.length > 0) {
    for (const family of families) {
      const config = resolvePreviewFamily(family);
      for (const target of explicitTargets) {
        if (!config.allowedTargets.includes(target)) {
          throw new Error(`preview build family ${family} does not support target ${target}`);
        }
      }
    }
    return [...new Set(explicitTargets)];
  }

  const inferredTargets = new Set<PreviewTargetName>();
  for (const family of families) {
    for (const target of resolvePreviewFamily(family).defaultTargets) {
      inferredTargets.add(target);
    }
  }
  return [...inferredTargets];
};

export const materializePreviewBuildJobs = (
  alias: string,
  families: readonly PreviewBuildFamily[],
  targets: readonly PreviewTargetName[],
): PreviewBuildJob[] => {
  const jobs: PreviewBuildJob[] = [];
  for (const family of families) {
    const familyConfig = resolvePreviewFamily(family);
    for (const target of targets) {
      if (!familyConfig.allowedTargets.includes(target)) {
        throw new Error(`preview build family ${family} does not support target ${target}`);
      }
      const targetConfig = resolvePreviewTarget(target);
      jobs.push({
        alias,
        family,
        target,
        runner: targetConfig.runner,
        jobTimeoutMinutes: familyConfig.buildLynxRuntime
          ? targetConfig.lynxRuntimeJobTimeoutMinutes
          : targetConfig.previewJobTimeoutMinutes,
        lynxRuntimeTimeoutSeconds: targetConfig.lynxRuntimeTimeoutSeconds,
        buildLynxRuntime: familyConfig.buildLynxRuntime,
      });
    }
  }
  return jobs;
};

export const executePreviewBuildJob = async (
  workspaceRoot: string,
  job: PreviewBuildJob,
  outputDir: string,
): Promise<PreviewBuildManifest> => {
  const family = resolvePreviewFamily(job.family);
  const target = resolvePreviewTarget(job.target);
  const nativeTarget = resolveNativePackageTarget(target.packageOs, target.arch);

  if (family.cargoPackages.length > 0) {
    await runCommand(
      "cargo",
      ["build", "--release", ...family.cargoPackages.flatMap((pkg) => ["-p", pkg])],
      workspaceRoot,
    );
  }

  await mkdir(outputDir, { recursive: true });
  const copiedFiles: string[] = [];

  for (const kind of family.artifactKinds) {
    if (kind === "lynx-runtime") {
      const runtimeOutput = join(outputDir, runtimeOutputName());
      await runCommand(
        "bash",
        ["scripts/release/build-lynx-runtime.sh", runtimeOutput],
        workspaceRoot,
      );
      copiedFiles.push(runtimeOutput);
      continue;
    }

    const source = join(workspaceRoot, "target", "release", releaseArtifactName(kind, nativeTarget.packageOs));
    const destination = join(outputDir, basename(source));
    await copyFile(source, destination);
    if (!destination.endsWith(".dll") && !destination.endsWith(".zip")) {
      await chmod(destination, 0o755);
    }
    copiedFiles.push(destination);
  }

  const manifest: PreviewBuildManifest = {
    alias: job.alias,
    family: job.family,
    target: job.target,
    artifactKinds: family.artifactKinds,
    files: copiedFiles,
  };
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
};

const matchesFamilyReleasePackage = (
  family: PreviewBuildFamily,
  releasePackage: string,
): boolean => {
  const config = resolvePreviewFamily(family);
  if (config.inferredPackages.includes(releasePackage)) {
    return true;
  }
  return config.inferredPackagePrefixes.some((prefix) => releasePackage.startsWith(prefix));
};

const releaseArtifactName = (
  kind: Exclude<PreviewArtifactKind, "lynx-runtime">,
  packageOs: PackageOs,
): string => {
  switch (kind) {
    case "daemon":
      return packageOs === "windows" ? "opentray.exe" : "opentray";
    case "webview":
      if (packageOs === "windows") {
        return "opentray_ext_webview.dll";
      }
      return `libopentray_ext_webview.${packageOs === "darwin" ? "dylib" : "so"}`;
    case "lynx":
      return "libopentray_ext_lynx.dylib";
  }
};

const runtimeOutputName = (): string => "LynxExplorer.app.zip";

const runCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "unknown"}`));
    });
  });

export const parsePreviewTargetName = (value: string): PreviewTargetName => {
  if (isPreviewTargetName(value)) {
    return value;
  }
  const [packageOs, arch] = value.split("-");
  const normalizedArch = normalizeArch(arch);
  const combined = `${packageOs}-${normalizedArch}`;
  if (isPreviewTargetName(combined)) {
    return combined;
  }
  throw new Error(`unsupported preview build target: ${value}`);
};
