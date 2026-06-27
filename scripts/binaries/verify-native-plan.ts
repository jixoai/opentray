#!/usr/bin/env bun
import {
  describeReleaseStagePlan,
  materializeIndependentNativeBuildExecutions,
  resolveReleaseTargetsForComponents,
  type NativeBuildComponent,
  type NativeBuildExecution,
} from "./native-build-graph";

const verifyNativeComponents: readonly NativeBuildComponent[] = [
  "runtime",
  "webview",
  "badge",
  "lynx",
  "lynx-runtime",
];

export interface VerifyNativePlan {
  readonly components: readonly NativeBuildComponent[];
  readonly jobs: readonly VerifyNativeJob[];
  readonly stageEntries: readonly {
    readonly target: string;
    readonly artifactKinds: readonly string[];
    readonly artifactName: string;
  }[];
  readonly validatePackageDirs: readonly string[];
}

export interface VerifyNativeJob
  extends Pick<
    NativeBuildExecution,
    | "target"
    | "runner"
    | "lynxRuntimeTimeoutSeconds"
    | "buildsLynxRuntime"
    | "artifactName"
  > {
  readonly jobTimeoutMinutes: number;
  readonly components: readonly NativeBuildComponent[];
  readonly componentsCsv: string;
  readonly artifactKinds: readonly string[];
}

export function resolveVerifyNativePlan(): VerifyNativePlan {
  const targets = resolveReleaseTargetsForComponents(verifyNativeComponents);
  const executions = materializeIndependentNativeBuildExecutions(
    verifyNativeComponents,
    targets
  );
  const stagePlan = describeReleaseStagePlan(executions);

  return {
    components: verifyNativeComponents,
    jobs: executions.map((execution) => ({
      target: execution.target,
      runner: execution.runner,
      jobTimeoutMinutes: execution.releaseJobTimeoutMinutes,
      lynxRuntimeTimeoutSeconds: execution.lynxRuntimeTimeoutSeconds,
      buildsLynxRuntime: execution.buildsLynxRuntime,
      artifactName: execution.artifactName,
      components: execution.components,
      componentsCsv: execution.components.join(","),
      artifactKinds: execution.artifactKinds,
    })),
    stageEntries: stagePlan.stageEntries,
    validatePackageDirs: stagePlan.validatePackageDirs,
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(resolveVerifyNativePlan(), null, 2));
}
