import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  type NativeArch,
  type NativeStageKind,
  type PackageOs,
  badgeDockHelperArtifactName,
  normalizeArch,
  resolveNativePackageTarget,
} from "./artifacts";

export type NativeBuildTargetName =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "windows-arm64"
  | "windows-x64";

export type NativeBuildComponent = "daemon" | "webview" | "badge" | "lynx" | "lynx-runtime";
export type NativeArtifactKind = NativeStageKind;
export const lynxRuntimeArtifactName = "OpenTrayLynxRuntime.app.zip";

export interface NativeBuildTargetConfig {
  readonly id: NativeBuildTargetName;
  readonly packageOs: PackageOs;
  readonly arch: NativeArch;
  readonly runner: string;
  readonly previewJobTimeoutMinutes: number;
  readonly previewLynxRuntimeJobTimeoutMinutes: number;
  readonly releaseJobTimeoutMinutes: number;
  readonly releaseLynxRuntimeJobTimeoutMinutes: number;
  readonly lynxRuntimeTimeoutSeconds: number;
}

export interface NativeBuildComponentConfig {
  readonly component: NativeBuildComponent;
  readonly allowedTargets: readonly NativeBuildTargetName[];
  readonly defaultReleaseTargets: readonly NativeBuildTargetName[];
  readonly cargoPackages: readonly string[];
  readonly artifactKinds: readonly NativeArtifactKind[];
  readonly inferredPackages: readonly string[];
  readonly inferredPackagePrefixes: readonly string[];
}

export interface NativeBuildExecution {
  readonly target: NativeBuildTargetName;
  readonly components: readonly NativeBuildComponent[];
  readonly cargoPackages: readonly string[];
  readonly artifactKinds: readonly NativeArtifactKind[];
  readonly runner: string;
  readonly previewJobTimeoutMinutes: number;
  readonly releaseJobTimeoutMinutes: number;
  readonly lynxRuntimeTimeoutSeconds: number;
  readonly buildsLynxRuntime: boolean;
}

export interface NativeBuildManifest {
  readonly target: NativeBuildTargetName;
  readonly components: readonly NativeBuildComponent[];
  readonly artifactKinds: readonly NativeArtifactKind[];
  readonly files: readonly string[];
}

export interface ReleaseStageEntry {
  readonly target: NativeBuildTargetName;
  readonly artifactKinds: readonly NativeArtifactKind[];
}

const nativeBuildTargets: Record<NativeBuildTargetName, NativeBuildTargetConfig> = {
  "darwin-arm64": {
    id: "darwin-arm64",
    packageOs: "darwin",
    arch: "arm64",
    runner: "macos-15",
    previewJobTimeoutMinutes: 60,
    previewLynxRuntimeJobTimeoutMinutes: 90,
    releaseJobTimeoutMinutes: 90,
    releaseLynxRuntimeJobTimeoutMinutes: 90,
    lynxRuntimeTimeoutSeconds: 4_500,
  },
  "darwin-x64": {
    id: "darwin-x64",
    packageOs: "darwin",
    arch: "x64",
    runner: "macos-15-intel",
    previewJobTimeoutMinutes: 75,
    previewLynxRuntimeJobTimeoutMinutes: 120,
    releaseJobTimeoutMinutes: 120,
    releaseLynxRuntimeJobTimeoutMinutes: 120,
    lynxRuntimeTimeoutSeconds: 5_700,
  },
  "linux-arm64": {
    id: "linux-arm64",
    packageOs: "linux",
    arch: "arm64",
    runner: "ubuntu-24.04-arm",
    previewJobTimeoutMinutes: 45,
    previewLynxRuntimeJobTimeoutMinutes: 45,
    releaseJobTimeoutMinutes: 90,
    releaseLynxRuntimeJobTimeoutMinutes: 90,
    lynxRuntimeTimeoutSeconds: 0,
  },
  "linux-x64": {
    id: "linux-x64",
    packageOs: "linux",
    arch: "x64",
    runner: "ubuntu-24.04",
    previewJobTimeoutMinutes: 45,
    previewLynxRuntimeJobTimeoutMinutes: 45,
    releaseJobTimeoutMinutes: 90,
    releaseLynxRuntimeJobTimeoutMinutes: 90,
    lynxRuntimeTimeoutSeconds: 0,
  },
  "windows-arm64": {
    id: "windows-arm64",
    packageOs: "windows",
    arch: "arm64",
    runner: "windows-11-arm",
    previewJobTimeoutMinutes: 45,
    previewLynxRuntimeJobTimeoutMinutes: 45,
    releaseJobTimeoutMinutes: 90,
    releaseLynxRuntimeJobTimeoutMinutes: 90,
    lynxRuntimeTimeoutSeconds: 0,
  },
  "windows-x64": {
    id: "windows-x64",
    packageOs: "windows",
    arch: "x64",
    runner: "windows-2025",
    previewJobTimeoutMinutes: 45,
    previewLynxRuntimeJobTimeoutMinutes: 45,
    releaseJobTimeoutMinutes: 90,
    releaseLynxRuntimeJobTimeoutMinutes: 90,
    lynxRuntimeTimeoutSeconds: 0,
  },
};

const allNativeBuildTargets = Object.keys(nativeBuildTargets) as NativeBuildTargetName[];
const webviewNativeBuildTargets: readonly NativeBuildTargetName[] = [
  "darwin-arm64",
  "darwin-x64",
  "windows-arm64",
  "windows-x64",
];
const nativeBuildComponentOrder: readonly NativeBuildComponent[] = [
  "daemon",
  "webview",
  "badge",
  "lynx",
  "lynx-runtime",
];

const nativeBuildComponents: Record<NativeBuildComponent, NativeBuildComponentConfig> = {
  daemon: {
    component: "daemon",
    allowedTargets: allNativeBuildTargets,
    defaultReleaseTargets: allNativeBuildTargets,
    cargoPackages: ["opentray-bin"],
    artifactKinds: ["daemon"],
    inferredPackages: ["opentray"],
    inferredPackagePrefixes: ["@opentray/darwin-", "@opentray/linux-", "@opentray/windows-"],
  },
  webview: {
    component: "webview",
    allowedTargets: webviewNativeBuildTargets,
    defaultReleaseTargets: webviewNativeBuildTargets,
    cargoPackages: ["opentray-ext-webview"],
    artifactKinds: ["webview"],
    inferredPackages: ["@opentray/ext-webview"],
    inferredPackagePrefixes: ["@opentray/ext-webview-"],
  },
  badge: {
    component: "badge",
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    defaultReleaseTargets: ["darwin-arm64", "darwin-x64"],
    cargoPackages: [],
    artifactKinds: ["badge"],
    inferredPackages: ["@opentray/ext-badge"],
    inferredPackagePrefixes: ["@opentray/ext-badge-darwin-"],
  },
  lynx: {
    component: "lynx",
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    defaultReleaseTargets: ["darwin-arm64", "darwin-x64"],
    cargoPackages: ["opentray-ext-lynx"],
    artifactKinds: ["lynx"],
    inferredPackages: ["@opentray/ext-lynx"],
    inferredPackagePrefixes: ["@opentray/ext-lynx-"],
  },
  "lynx-runtime": {
    component: "lynx-runtime",
    allowedTargets: ["darwin-arm64", "darwin-x64"],
    defaultReleaseTargets: ["darwin-arm64", "darwin-x64"],
    cargoPackages: [],
    artifactKinds: ["lynx-runtime"],
    inferredPackages: [],
    inferredPackagePrefixes: [],
  },
};

export const nativeBuildTargetNames = allNativeBuildTargets;
export const isNativeBuildTargetName = (value: string): value is NativeBuildTargetName =>
  value in nativeBuildTargets;
export const isNativeBuildComponent = (value: string): value is NativeBuildComponent =>
  value in nativeBuildComponents;

export const resolveNativeBuildTarget = (target: NativeBuildTargetName): NativeBuildTargetConfig => {
  const resolved = nativeBuildTargets[target];
  if (resolved === undefined) {
    throw new Error(`unsupported native build target: ${target}`);
  }
  return resolved;
};

export const resolveNativeBuildComponent = (
  component: NativeBuildComponent,
): NativeBuildComponentConfig => {
  const resolved = nativeBuildComponents[component];
  if (resolved === undefined) {
    throw new Error(`unsupported native build component: ${component}`);
  }
  return resolved;
};

export const inferNativeBuildComponentsFromReleasePackages = (
  releasePackages: readonly string[],
): NativeBuildComponent[] => {
  const inferred = new Set<NativeBuildComponent>();
  for (const releasePackage of releasePackages) {
    if (matchesReleasePackage("webview", releasePackage)) {
      inferred.add("webview");
      continue;
    }
    if (matchesReleasePackage("badge", releasePackage)) {
      inferred.add("badge");
      continue;
    }
    if (matchesReleasePackage("lynx", releasePackage)) {
      inferred.add("lynx");
      inferred.add("lynx-runtime");
      continue;
    }
    if (matchesReleasePackage("daemon", releasePackage)) {
      inferred.add("daemon");
    }
  }
  return nativeBuildComponentOrder.filter((component) => inferred.has(component));
};

export const resolveReleaseTargetsForComponents = (
  components: readonly NativeBuildComponent[],
): NativeBuildTargetName[] => {
  const targets = new Set<NativeBuildTargetName>();
  for (const component of components) {
    for (const target of resolveNativeBuildComponent(component).defaultReleaseTargets) {
      targets.add(target);
    }
  }
  return allNativeBuildTargets.filter((target) => targets.has(target));
};

export const materializeNativeBuildExecutions = (
  components: readonly NativeBuildComponent[],
  targets: readonly NativeBuildTargetName[],
): NativeBuildExecution[] => {
  const dedupedComponents = [...new Set(components)];
  return targets.map((target) => {
    const targetConfig = resolveNativeBuildTarget(target);
    const selectedComponents = dedupedComponents.filter((component) =>
      resolveNativeBuildComponent(component).allowedTargets.includes(target),
    );
    if (selectedComponents.length === 0) {
      throw new Error(`no native build components support target ${target}`);
    }

    const cargoPackages = new Set<string>();
    const artifactKinds = new Set<NativeArtifactKind>();
    let buildsLynxRuntime = false;

    for (const component of selectedComponents) {
      const config = resolveNativeBuildComponent(component);
      config.cargoPackages.forEach((pkg) => cargoPackages.add(pkg));
      config.artifactKinds.forEach((kind) => artifactKinds.add(kind));
      buildsLynxRuntime ||= config.artifactKinds.includes("lynx-runtime");
    }

    return {
      target,
      components: selectedComponents,
      cargoPackages: [...cargoPackages],
      artifactKinds: [...artifactKinds],
      runner: targetConfig.runner,
      previewJobTimeoutMinutes: buildsLynxRuntime
        ? targetConfig.previewLynxRuntimeJobTimeoutMinutes
        : targetConfig.previewJobTimeoutMinutes,
      releaseJobTimeoutMinutes: buildsLynxRuntime
        ? targetConfig.releaseLynxRuntimeJobTimeoutMinutes
        : targetConfig.releaseJobTimeoutMinutes,
      lynxRuntimeTimeoutSeconds: targetConfig.lynxRuntimeTimeoutSeconds,
      buildsLynxRuntime,
    };
  });
};

export const describeReleaseStagePlan = (
  executions: readonly NativeBuildExecution[],
): {
  readonly stageEntries: readonly ReleaseStageEntry[];
  readonly validatePackageDirs: readonly string[];
} => {
  const packageDirs = new Set<string>();
  const stageEntries = executions.map((execution) => {
    const target = resolveNativeBuildTarget(execution.target);
    for (const component of execution.components) {
      packageDirs.add(resolvePackageDirForComponent(component, target.packageOs, target.arch));
    }
    return {
      target: execution.target,
      artifactKinds: execution.artifactKinds,
    };
  });
  return {
    stageEntries,
    validatePackageDirs: [...packageDirs].sort(),
  };
};

export const executeNativeBuildExecution = async (
  workspaceRoot: string,
  execution: NativeBuildExecution,
  outputDir: string,
): Promise<NativeBuildManifest> => {
  const target = resolveNativeBuildTarget(execution.target);
  const nativeTarget = resolveNativePackageTarget(target.packageOs, target.arch);

  if (execution.cargoPackages.length > 0) {
    await runCommand(
      "cargo",
      ["build", "--release", ...execution.cargoPackages.flatMap((pkg) => ["-p", pkg])],
      workspaceRoot,
    );
  }

  await mkdir(outputDir, { recursive: true });
  const copiedFiles: string[] = [];

  for (const kind of execution.artifactKinds) {
    if (kind === "lynx-runtime") {
      const runtimeOutput = join(outputDir, lynxRuntimeArtifactName);
      await runCommand("bash", ["scripts/release/build-lynx-runtime.sh", runtimeOutput], workspaceRoot);
      copiedFiles.push(runtimeOutput);
      continue;
    }

    if (kind === "badge") {
      const badgeOutput = join(outputDir, badgeDockHelperArtifactName);
      await runCommand("bash", ["scripts/release/build-badge-dock-helper.sh", badgeOutput], workspaceRoot);
      copiedFiles.push(badgeOutput);
      continue;
    }

    const source = join(workspaceRoot, "target", "release", releaseArtifactName(kind, nativeTarget.packageOs));
    const destination = join(outputDir, basename(source));
    await copyFile(source, destination);
    if (!destination.endsWith(".dll")) {
      await chmod(destination, 0o755);
    }
    copiedFiles.push(destination);
  }

  const manifest: NativeBuildManifest = {
    target: execution.target,
    components: execution.components,
    artifactKinds: execution.artifactKinds,
    files: copiedFiles,
  };
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
};

export const parseNativeBuildTargetName = (value: string): NativeBuildTargetName => {
  if (isNativeBuildTargetName(value)) {
    return value;
  }
  const [packageOs, arch] = value.split("-");
  const normalizedArch = normalizeArch(arch);
  const combined = `${packageOs}-${normalizedArch}`;
  if (isNativeBuildTargetName(combined)) {
    return combined;
  }
  throw new Error(`unsupported native build target: ${value}`);
};

export const releaseArtifactName = (
  kind: Exclude<NativeArtifactKind, "lynx-runtime">,
  packageOs: PackageOs,
): string => {
  switch (kind) {
    case "daemon":
      return packageOs === "windows" ? "opentray.exe" : "opentray";
    case "webview":
      if (packageOs === "linux") {
        throw new Error("webview native artifacts are not published for linux targets");
      }
      if (packageOs === "windows") {
        return "opentray_ext_webview.dll";
      }
      return "libopentray_ext_webview.dylib";
    case "badge":
      if (packageOs !== "darwin") {
        throw new Error("badge dock helper artifacts are only published for darwin targets");
      }
      return badgeDockHelperArtifactName;
    case "lynx":
      return "libopentray_ext_lynx.dylib";
  }
};

const matchesReleasePackage = (component: NativeBuildComponent, releasePackage: string): boolean => {
  const config = resolveNativeBuildComponent(component);
  if (config.inferredPackages.includes(releasePackage)) {
    return true;
  }
  return config.inferredPackagePrefixes.some((prefix) => releasePackage.startsWith(prefix));
};

const resolvePackageDirForComponent = (
  component: NativeBuildComponent,
  packageOs: PackageOs,
  arch: NativeArch,
): string => {
  const target = resolveNativePackageTarget(packageOs, arch);
  switch (component) {
    case "daemon":
      return target.daemonPackageDir;
    case "webview":
      if (target.webviewPackageDir === undefined) {
        throw new Error(`target ${packageOs}-${arch} does not publish webview package directories`);
      }
      return target.webviewPackageDir;
    case "badge":
      if (target.badgePackageDir === undefined) {
        throw new Error(`target ${packageOs}-${arch} does not publish badge package directories`);
      }
      return target.badgePackageDir;
    case "lynx":
    case "lynx-runtime":
      if (target.lynxPackageDir === undefined) {
        throw new Error(`target ${packageOs}-${arch} does not publish lynx package directories`);
      }
      return target.lynxPackageDir;
  }
};

const runCommand = (command: string, args: readonly string[], cwd: string): Promise<void> =>
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
