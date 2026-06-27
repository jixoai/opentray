#!/usr/bin/env bun
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
  readonly pendingChangesetFiles: readonly string[];
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

export async function resolveReleaseNativePlan(root = process.cwd()): Promise<ReleaseNativePlan> {
  const pendingChangesetFiles = await listPendingChangesetFiles(root);
  if (pendingChangesetFiles.length === 0) {
    return {
      enabled: false,
      pendingChangesetFiles,
      releasePackages: [],
      components: [],
      jobs: [],
      stageEntries: [],
      validatePackageDirs: [],
      reason: "no pending changesets",
    };
  }

  const releasePackages = new Set<string>();
  for (const relativePath of pendingChangesetFiles) {
    const content = await readOptionalWorkspaceFile(root, relativePath);
    if (content === undefined) {
      continue;
    }
    extractChangesetReleasePackages(content).forEach((pkg) => releasePackages.add(pkg));
  }

  const components = inferNativeBuildComponentsFromReleasePackages([...releasePackages]);
  if (components.length === 0) {
    return {
      enabled: false,
      pendingChangesetFiles,
      releasePackages: [...releasePackages].sort(),
      components,
      jobs: [],
      stageEntries: [],
      validatePackageDirs: [],
      reason: "pending changesets do not publish native package families",
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
    pendingChangesetFiles,
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
