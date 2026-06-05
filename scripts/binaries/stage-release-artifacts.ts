#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  resolveNativePackageTarget,
  resolveStageDestination,
  stageArtifact,
} from "./artifacts";
import {
  parseNativeBuildTargetName,
  releaseArtifactName,
  resolveNativeBuildTarget,
  type NativeArtifactKind,
} from "./native-build-graph";

interface StagePlanEntry {
  readonly target: string;
  readonly artifactKinds: readonly string[];
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: {
      type: "string",
      default: process.cwd(),
    },
    "artifact-root": {
      type: "string",
    },
    "stage-plan-json": {
      type: "string",
    },
  },
});

if (values["artifact-root"] === undefined || values["artifact-root"].trim().length === 0) {
  throw new Error("--artifact-root is required");
}
if (values["stage-plan-json"] === undefined || values["stage-plan-json"].trim().length === 0) {
  throw new Error("--stage-plan-json is required");
}

const stagePlan = parseStagePlan(values["stage-plan-json"]);
for (const entry of stagePlan) {
  const targetName = parseNativeBuildTargetName(entry.target);
  const target = resolveNativeBuildTarget(targetName);
  const packageTarget = resolveNativePackageTarget(target.packageOs, target.arch);
  const artifactDirectory = join(values["artifact-root"].trim(), `native-${targetName}`);

  for (const rawKind of entry.artifactKinds) {
    const kind = parseArtifactKind(rawKind);
    const fileName =
      kind === "lynx-runtime" ? "LynxExplorer.app.zip" : releaseArtifactName(kind, target.packageOs);
    const source = join(artifactDirectory, fileName);
    const destination = resolveStageDestination(packageTarget, kind);
    await stageArtifact(values.root ?? process.cwd(), source, destination);
  }
}

function parseStagePlan(value: string): StagePlanEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--stage-plan-json must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--stage-plan-json must be an array");
  }
  return parsed.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("target" in entry) ||
      !("artifactKinds" in entry) ||
      typeof entry.target !== "string" ||
      !Array.isArray(entry.artifactKinds) ||
      entry.artifactKinds.some((kind) => typeof kind !== "string")
    ) {
      throw new Error("--stage-plan-json entries must contain string target and artifactKinds[]");
    }
    return {
      target: entry.target,
      artifactKinds: entry.artifactKinds,
    };
  });
}

function parseArtifactKind(value: string): NativeArtifactKind {
  if (value === "daemon" || value === "webview" || value === "lynx" || value === "lynx-runtime") {
    return value;
  }
  throw new Error(`unsupported native artifact kind: ${value}`);
}
