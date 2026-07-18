#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import {
  resolveNativePackageTarget,
  resolveStageDestination,
  resolveStageDestinationForArtifactFile,
  stageArtifact,
} from "./artifacts";
import {
  isExtensionArtifactKind,
  verifyExtensionPlatformPackageTarget,
  verifyRecordedExtensionArtifact,
  type EmbeddedExtensionManifest,
  type ExtensionArtifactEvidence,
  type ExtensionArtifactKind,
} from "./extension-manifest";
import { parseNativeBuildTargetName, resolveNativeBuildTarget } from "./native-build-graph";

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
  const artifactDirectory = join(
    values["artifact-root"].trim(),
    entry.artifactName ?? `native-${targetName}`,
  );

  const manifest = await readNativeBuildManifest(artifactDirectory);
  if (manifest.target !== entry.target) {
    throw new Error(
      `artifact manifest target mismatch: expected ${entry.target}, received ${manifest.target}`,
    );
  }
  const extensionKinds = entry.artifactKinds.filter(isExtensionArtifactKind);
  verifyExtensionEvidenceShape(extensionKinds, manifest.extensionArtifacts);
  for (const evidence of manifest.extensionArtifacts) {
    const expectedFile = basename(resolveStageDestination(packageTarget, evidence.kind));
    if (evidence.file !== expectedFile || !manifest.files.includes(evidence.file)) {
      throw new Error(
        `native extension evidence is not bound to the staged artifact: kind=${evidence.kind} expected=${expectedFile} evidence=${evidence.file}`,
      );
    }
    const source = join(artifactDirectory, evidence.file);
    await verifyRecordedExtensionArtifact(
      values.root ?? process.cwd(),
      source,
      { os: packageTarget.npmOs, arch: packageTarget.arch },
      evidence,
    );
    await verifyExtensionPlatformPackageTarget(
      values.root ?? process.cwd(),
      resolveExtensionPlatformPackageDir(packageTarget, evidence.kind),
      { os: packageTarget.npmOs, arch: packageTarget.arch },
    );
  }
  for (const fileName of manifest.files) {
    const source = join(artifactDirectory, fileName);
    const destination = resolveStageDestinationForArtifactFile(packageTarget, fileName);
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
      ("artifactName" in entry && typeof entry.artifactName !== "string")
    ) {
      throw new Error(
        "--stage-plan-json entries must contain string target, artifactKinds[], and optional artifactName",
      );
    }
    return {
      target: entry.target,
      artifactKinds: entry.artifactKinds,
      ...(typeof entry.artifactName === "string" ? { artifactName: entry.artifactName } : {}),
    };
  });
}

interface NativeBuildManifest {
  readonly target: string;
  readonly files: readonly string[];
  readonly extensionArtifacts: readonly ExtensionArtifactEvidence[];
}

async function readNativeBuildManifest(artifactDirectory: string): Promise<NativeBuildManifest> {
  const manifestPath = join(artifactDirectory, "manifest.json");
  const content = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("target" in parsed) ||
    !("files" in parsed) ||
    !("extensionArtifacts" in parsed) ||
    typeof parsed.target !== "string" ||
    !Array.isArray(parsed.files) ||
    parsed.files.some((file) => typeof file !== "string") ||
    !Array.isArray(parsed.extensionArtifacts) ||
    parsed.extensionArtifacts.some((evidence) => !isExtensionArtifactEvidence(evidence))
  ) {
    throw new Error(`invalid native build manifest: ${manifestPath}`);
  }
  return {
    target: parsed.target,
    files: parsed.files,
    extensionArtifacts: parsed.extensionArtifacts,
  };
}

function verifyExtensionEvidenceShape(
  expectedKinds: readonly ExtensionArtifactKind[],
  evidence: readonly ExtensionArtifactEvidence[],
): void {
  const actualKinds = evidence.map((entry) => entry.kind);
  if (
    expectedKinds.length !== actualKinds.length ||
    expectedKinds.some((kind) => !actualKinds.includes(kind)) ||
    new Set(actualKinds).size !== actualKinds.length
  ) {
    throw new Error(
      `native build manifest extension evidence mismatch: expected=${JSON.stringify(expectedKinds)} actual=${JSON.stringify(actualKinds)}`,
    );
  }
}

function resolveExtensionPlatformPackageDir(
  target: ReturnType<typeof resolveNativePackageTarget>,
  kind: ExtensionArtifactKind,
): string {
  const directory =
    kind === "webview"
      ? target.webviewPackageDir
      : kind === "badge"
        ? target.badgePackageDir
        : target.lynxPackageDir;
  if (directory === undefined) {
    throw new Error(`target ${target.packageOs}-${target.arch} does not publish ${kind}`);
  }
  return directory;
}

function isExtensionArtifactEvidence(value: unknown): value is ExtensionArtifactEvidence {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    isExtensionArtifactKind(value.kind) &&
    typeof value.file === "string" &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    isEmbeddedExtensionManifest(value.manifest)
  );
}

function isEmbeddedExtensionManifest(value: unknown): value is EmbeddedExtensionManifest {
  return (
    isRecord(value) &&
    typeof value.extensionName === "string" &&
    typeof value.abiVersion === "number" &&
    typeof value.artifactSetVersion === "string" &&
    typeof value.contractFingerprint === "string" &&
    isRecord(value.target) &&
    typeof value.target.os === "string" &&
    typeof value.target.arch === "string" &&
    typeof value.buildIdentity === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
