import {
  executeNativeBuildExecution,
  type NativeArtifactKind,
  type NativeBuildComponent,
  type NativeBuildManifest,
  type NativeBuildTargetName,
  materializeNativeBuildExecutions,
  nativeBuildTargetNames,
  parseNativeBuildTargetName,
  resolveNativeBuildComponent,
  resolveNativeBuildTarget,
} from "./native-build-graph";

export type PreviewBuildFamily =
  | "core-runtime"
  | "ext-webview-native"
  | "ext-lynx-native"
  | "ext-lynx-runtime";

export type PreviewTargetName = NativeBuildTargetName;
export type PreviewArtifactKind = NativeArtifactKind;

export interface PreviewFamilyConfig {
  readonly family: PreviewBuildFamily;
  readonly components: readonly NativeBuildComponent[];
  readonly defaultTargets: readonly PreviewTargetName[];
  readonly allowedTargets: readonly PreviewTargetName[];
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

export interface PreviewBuildManifest extends NativeBuildManifest {
  readonly alias: string;
  readonly family: PreviewBuildFamily;
}

const previewFamilies: Record<PreviewBuildFamily, PreviewFamilyConfig> = {
  "core-runtime": {
    family: "core-runtime",
    components: ["runtime"],
    defaultTargets: ["darwin-arm64"],
    allowedTargets: nativeBuildTargetNames,
    inferredPackagePrefixes: [
      "@opentray/darwin-",
      "@opentray/linux-",
      "@opentray/windows-",
    ],
    inferredPackages: ["opentray"],
  },
  "ext-webview-native": {
    family: "ext-webview-native",
    components: ["runtime", "webview"],
    defaultTargets: ["darwin-arm64"],
    allowedTargets: resolveNativeBuildComponent("webview").allowedTargets,
    inferredPackagePrefixes: ["@opentray/ext-webview-"],
    inferredPackages: ["@opentray/ext-webview"],
  },
  "ext-lynx-native": {
    family: "ext-lynx-native",
    components: ["runtime", "lynx"],
    defaultTargets: ["darwin-arm64"],
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    inferredPackagePrefixes: ["@opentray/ext-lynx-"],
    inferredPackages: ["@opentray/ext-lynx"],
  },
  "ext-lynx-runtime": {
    family: "ext-lynx-runtime",
    components: ["lynx-runtime"],
    defaultTargets: ["darwin-arm64"],
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    inferredPackagePrefixes: [],
    inferredPackages: [],
  },
};

export const previewBuildFamilies = Object.keys(
  previewFamilies
) as PreviewBuildFamily[];
export const previewBuildTargetNames = nativeBuildTargetNames;

export const isPreviewBuildFamily = (
  value: string
): value is PreviewBuildFamily => value in previewFamilies;
export const isPreviewTargetName = (
  value: string
): value is PreviewTargetName =>
  previewBuildTargetNames.includes(value as PreviewTargetName);

export const resolvePreviewFamily = (
  family: PreviewBuildFamily
): PreviewFamilyConfig => {
  const resolved = previewFamilies[family];
  if (resolved === undefined) {
    throw new Error(`unsupported preview build family: ${family}`);
  }
  return resolved;
};

export const resolvePreviewTarget = (target: PreviewTargetName) =>
  resolveNativeBuildTarget(target);

export const inferPreviewFamiliesFromReleasePackages = (
  releasePackages: readonly string[]
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
    if (matchesFamilyReleasePackage("core-runtime", releasePackage)) {
      inferred.add("core-runtime");
    }
  }
  if (inferred.has("ext-webview-native") || inferred.has("ext-lynx-native")) {
    inferred.delete("core-runtime");
  }
  return [...inferred];
};

export const resolvePreviewTargetsForFamilies = (
  families: readonly PreviewBuildFamily[],
  explicitTargets: readonly PreviewTargetName[] | undefined
): PreviewTargetName[] => {
  if (explicitTargets !== undefined && explicitTargets.length > 0) {
    for (const family of families) {
      const config = resolvePreviewFamily(family);
      for (const target of explicitTargets) {
        if (!config.allowedTargets.includes(target)) {
          throw new Error(
            `preview build family ${family} does not support target ${target}`
          );
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
  targets: readonly PreviewTargetName[]
): PreviewBuildJob[] => {
  const jobs: PreviewBuildJob[] = [];
  for (const family of families) {
    const familyConfig = resolvePreviewFamily(family);
    for (const target of targets) {
      if (!familyConfig.allowedTargets.includes(target)) {
        throw new Error(
          `preview build family ${family} does not support target ${target}`
        );
      }
      const execution = materializeNativeBuildExecutions(
        familyConfig.components,
        [target]
      )[0];
      jobs.push({
        alias,
        family,
        target,
        runner: execution.runner,
        jobTimeoutMinutes: execution.previewJobTimeoutMinutes,
        lynxRuntimeTimeoutSeconds: execution.lynxRuntimeTimeoutSeconds,
        buildLynxRuntime: execution.buildsLynxRuntime,
      });
    }
  }
  return jobs;
};

export const executePreviewBuildJob = async (
  workspaceRoot: string,
  job: PreviewBuildJob,
  outputDir: string
): Promise<PreviewBuildManifest> => {
  const family = resolvePreviewFamily(job.family);
  const execution = materializeNativeBuildExecutions(family.components, [
    job.target,
  ])[0];
  const manifest = await executeNativeBuildExecution(
    workspaceRoot,
    execution,
    outputDir
  );
  return {
    ...manifest,
    alias: job.alias,
    family: job.family,
  };
};

const matchesFamilyReleasePackage = (
  family: PreviewBuildFamily,
  releasePackage: string
): boolean => {
  const config = resolvePreviewFamily(family);
  if (config.inferredPackages.includes(releasePackage)) {
    return true;
  }
  return config.inferredPackagePrefixes.some((prefix) =>
    releasePackage.startsWith(prefix)
  );
};

export const parsePreviewTargetName = (value: string): PreviewTargetName =>
  parseNativeBuildTargetName(value);
