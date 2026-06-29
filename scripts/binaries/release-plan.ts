#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  extractChangesetReleasePackages,
  listPendingChangesetFiles,
  readOptionalWorkspaceFile,
} from "./changeset-files";
import {
  describeReleaseStagePlan,
  inferNativeBuildComponentsFromReleasePackages,
  materializeIndependentNativeBuildExecutions,
  resolveReleaseTargetsForComponents,
  type NativeBuildComponent,
  type NativeBuildExecution,
} from "./native-build-graph";

export interface ReleaseNativePlan {
  readonly enabled: boolean;
  readonly publishEnabled: boolean;
  readonly pendingChangesetFiles: readonly string[];
  readonly unpublishedWorkspacePackages: readonly string[];
  readonly releasePackages: readonly string[];
  readonly components: readonly NativeBuildComponent[];
  readonly jobs: readonly ReleaseNativeJob[];
  readonly stageEntries: readonly {
    readonly target: string;
    readonly artifactKinds: readonly string[];
    readonly artifactName: string;
  }[];
  readonly validatePackageDirs: readonly string[];
  readonly reason?: string;
}

export interface WorkspacePackageManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
}

export interface PackageVersionRegistry {
  versionExists(name: string, version: string): Promise<boolean>;
}

export interface ReleaseNativeJob
  extends Pick<
    NativeBuildExecution,
    "target" | "runner" | "lynxRuntimeTimeoutSeconds" | "buildsLynxRuntime"
  > {
  readonly jobTimeoutMinutes: number;
  readonly components: readonly NativeBuildComponent[];
  readonly componentsCsv: string;
  readonly artifactKinds: readonly string[];
  readonly artifactName: string;
}

export async function resolveReleaseNativePlan(
  root = process.cwd(),
  registry: PackageVersionRegistry = npmRegistry
): Promise<ReleaseNativePlan> {
  const pendingChangesetFiles = await listPendingChangesetFiles(root);

  const releasePackages = new Set<string>();
  for (const relativePath of pendingChangesetFiles) {
    const content = await readOptionalWorkspaceFile(root, relativePath);
    if (content === undefined) {
      continue;
    }
    extractChangesetReleasePackages(content).forEach((pkg) => releasePackages.add(pkg));
  }

  const unpublishedWorkspacePackages = await resolveUnpublishedWorkspacePackages(
    root,
    registry
  );
  unpublishedWorkspacePackages.forEach((pkg) => releasePackages.add(pkg));

  if (pendingChangesetFiles.length === 0 && unpublishedWorkspacePackages.length === 0) {
    return {
      enabled: false,
      publishEnabled: false,
      pendingChangesetFiles,
      unpublishedWorkspacePackages,
      releasePackages: [],
      components: [],
      jobs: [],
      stageEntries: [],
      validatePackageDirs: [],
      reason: "no pending changesets or unpublished workspace versions",
    };
  }

  const components = inferNativeBuildComponentsFromReleasePackages([...releasePackages]);
  if (components.length === 0) {
    return {
      enabled: false,
      publishEnabled: true,
      pendingChangesetFiles,
      unpublishedWorkspacePackages,
      releasePackages: [...releasePackages].sort(),
      components,
      jobs: [],
      stageEntries: [],
      validatePackageDirs: [],
      reason: "release packages do not publish native package families",
    };
  }

  const targets = resolveReleaseTargetsForComponents(components);
  const executions = materializeIndependentNativeBuildExecutions(
    components,
    targets
  );
  const stagePlan = describeReleaseStagePlan(executions);

  return {
    enabled: true,
    publishEnabled: true,
    pendingChangesetFiles,
    unpublishedWorkspacePackages,
    releasePackages: [...releasePackages].sort(),
    components,
    jobs: executions.map((execution) => ({
      target: execution.target,
      runner: execution.runner,
      jobTimeoutMinutes: execution.releaseJobTimeoutMinutes,
      lynxRuntimeTimeoutSeconds: execution.lynxRuntimeTimeoutSeconds,
      buildsLynxRuntime: execution.buildsLynxRuntime,
      components: execution.components,
      componentsCsv: execution.components.join(","),
      artifactKinds: execution.artifactKinds,
      artifactName: execution.artifactName,
    })),
    stageEntries: stagePlan.stageEntries,
    validatePackageDirs: stagePlan.validatePackageDirs,
  };
}

export async function listPublicWorkspacePackages(
  root: string
): Promise<WorkspacePackageManifest[]> {
  const packagesRoot = join(root, "packages");
  let entries: string[];
  try {
    entries = await readdir(packagesRoot);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const manifests: WorkspacePackageManifest[] = [];
  for (const entry of entries.sort()) {
    const manifestPath = join(packagesRoot, entry, "package.json");
    let content: string;
    try {
      content = await readFile(manifestPath, "utf8");
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) {
        continue;
      }
      throw error;
    }

    const manifest = parseWorkspacePackageManifest(content, manifestPath);
    if (manifest.private) {
      continue;
    }
    manifests.push(manifest);
  }
  return manifests.sort((left, right) => left.name.localeCompare(right.name));
}

export async function resolveUnpublishedWorkspacePackages(
  root: string,
  registry: PackageVersionRegistry
): Promise<string[]> {
  const workspacePackages = await listPublicWorkspacePackages(root);
  const unpublished = await Promise.all(
    workspacePackages.map(async (pkg) => ({
      name: pkg.name,
      exists: await registry.versionExists(pkg.name, pkg.version),
    }))
  );
  return unpublished
    .filter((pkg) => !pkg.exists)
    .map((pkg) => pkg.name)
    .sort((left, right) => left.localeCompare(right));
}

const npmRegistry: PackageVersionRegistry = {
  async versionExists(name: string, version: string): Promise<boolean> {
    const response = await fetch(
      `https://registry.npmjs.org/${encodePackageNameForRegistry(name)}`
    );
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(
        `failed to read npm registry metadata for ${name}: HTTP ${response.status}`
      );
    }

    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.versions)) {
      throw new Error(`invalid npm registry metadata for ${name}`);
    }
    return Object.hasOwn(body.versions, version);
  },
};

const encodePackageNameForRegistry = (name: string): string =>
  encodeURIComponent(name).replace(/^%40/u, "@");

const parseWorkspacePackageManifest = (
  content: string,
  path: string
): WorkspacePackageManifest => {
  const parsed: unknown = JSON.parse(content);
  if (
    !isRecord(parsed) ||
    typeof parsed.name !== "string" ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`invalid workspace package manifest: ${path}`);
  }
  return {
    name: parsed.name,
    version: parsed.version,
    private: typeof parsed.private === "boolean" ? parsed.private : undefined,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isErrnoException = (
  value: unknown,
  code: string
): value is NodeJS.ErrnoException =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  value.code === code;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: {
      type: "string",
      default: process.cwd(),
    },
  },
});

if (import.meta.main) {
  const plan = await resolveReleaseNativePlan(values.root ?? process.cwd());
  console.log(JSON.stringify(plan, null, 2));
}
