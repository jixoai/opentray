#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  resolveNativePackageTarget,
  resolveStageDestinationForArtifactFile,
  stageArtifact,
} from "./artifacts";
import {
  parseNativeBuildTargetName,
  resolveNativeBuildTarget,
} from "./native-build-graph";

interface StagePlanEntry {
  readonly target: string;
  readonly artifactKinds: readonly string[];
  readonly artifactName?: string;
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

if (
  values["artifact-root"] === undefined ||
  values["artifact-root"].trim().length === 0
) {
  throw new Error("--artifact-root is required");
}
if (
  values["stage-plan-json"] === undefined ||
  values["stage-plan-json"].trim().length === 0
) {
  throw new Error("--stage-plan-json is required");
}

const stagePlan = parseStagePlan(values["stage-plan-json"]);
for (const entry of stagePlan) {
  const targetName = parseNativeBuildTargetName(entry.target);
  const target = resolveNativeBuildTarget(targetName);
  const packageTarget = resolveNativePackageTarget(
    target.packageOs,
    target.arch
  );
  const artifactDirectory = join(
    values["artifact-root"].trim(),
    entry.artifactName ?? `native-${targetName}`
  );

  const manifest = await readNativeBuildManifest(artifactDirectory);
  if (manifest.target !== entry.target) {
    throw new Error(
      `artifact manifest target mismatch: expected ${entry.target}, received ${manifest.target}`
    );
  }
  for (const fileName of manifest.files) {
    const source = join(artifactDirectory, fileName);
    const destination = resolveStageDestinationForArtifactFile(
      packageTarget,
      fileName
    );
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
  return parsed.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("target" in entry) ||
      !("artifactKinds" in entry) ||
      typeof entry.target !== "string" ||
      !Array.isArray(entry.artifactKinds) ||
      entry.artifactKinds.some((kind) => typeof kind !== "string") ||
      ("artifactName" in entry &&
        typeof entry.artifactName !== "string")
    ) {
      throw new Error(
        "--stage-plan-json entries must contain string target, artifactKinds[], and optional artifactName"
      );
    }
    return {
      target: entry.target,
      artifactKinds: entry.artifactKinds,
      ...(typeof entry.artifactName === "string"
        ? { artifactName: entry.artifactName }
        : {}),
    };
  });
}

interface NativeBuildManifest {
  readonly target: string;
  readonly files: readonly string[];
}

async function readNativeBuildManifest(
  artifactDirectory: string
): Promise<NativeBuildManifest> {
  const manifestPath = join(artifactDirectory, "manifest.json");
  const content = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("target" in parsed) ||
    !("files" in parsed) ||
    typeof parsed.target !== "string" ||
    !Array.isArray(parsed.files) ||
    parsed.files.some((file) => typeof file !== "string")
  ) {
    throw new Error(`invalid native build manifest: ${manifestPath}`);
  }
  return {
    target: parsed.target,
    files: parsed.files,
  };
}
