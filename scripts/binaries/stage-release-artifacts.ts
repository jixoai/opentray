#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  resolveNativePackageTarget,
  resolveStageDestination,
  resolveStageDestinationForArtifactFile,
  stageArtifact,
} from "./artifacts";
import {
  isEmbeddedExtensionArtifactKind,
  isExtensionArtifactKind,
  sha256File,
  verifyExtensionPlatformPackageTarget,
  verifyRecordedExtensionArtifact,
  type EmbeddedExtensionManifest,
  type ExtensionArtifactEvidence,
  type ExtensionArtifactKind,
} from "./extension-manifest";
import {
  buildEmbeddedStagingManifest,
  type EmbeddedStagingTargetEvidence,
} from "./embedded-staging-manifest";
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

const embeddedDialogFacadeDir = "packages/ext-dialog";

const stagePlan = parseStagePlan(values["stage-plan-json"]);
const embeddedDialogTargets = new Map<string, EmbeddedStagingTargetEvidence>();
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
    // Embedded kinds (dialog) have no split per-platform package.json to
    // cross-check; the facade identity chain above is the full check
    // (add-ext-dialog section 6.4).
    if (!isEmbeddedExtensionArtifactKind(evidence.kind)) {
      await verifyExtensionPlatformPackageTarget(
        values.root ?? process.cwd(),
        resolveExtensionPlatformPackageDir(packageTarget, evidence.kind),
        { os: packageTarget.npmOs, arch: packageTarget.arch },
      );
    }
  }
  for (const fileName of manifest.files) {
    const source = join(artifactDirectory, fileName);
    const destination = resolveStageDestinationForArtifactFile(packageTarget, fileName);
    await stageArtifact(values.root ?? process.cwd(), source, destination);
  }

  // Embedded dialog branch: collect the per-target evidence cell from the
  // staged bytes (re-hashed here; the hash in the downloaded evidence was
  // already verified against the source file above).
  const dialogEvidence = manifest.extensionArtifacts.find(
    (candidate) => candidate.kind === "dialog",
  );
  if (dialogEvidence !== undefined) {
    const npmTarget = `${packageTarget.npmOs}-${packageTarget.arch}`;
    const destination = resolveStageDestination(packageTarget, "dialog");
    const stagedSha256 = await sha256File(join(values.root ?? process.cwd(), destination));
    if (stagedSha256 !== dialogEvidence.sha256) {
      throw new Error(
        `staged dialog library bytes do not match the recorded evidence: target=${npmTarget} expected=${dialogEvidence.sha256} actual=${stagedSha256}`,
      );
    }
    if (embeddedDialogTargets.has(npmTarget)) {
      throw new Error(
        `stage plan stages the embedded dialog target ${npmTarget} more than once`,
      );
    }
    embeddedDialogTargets.set(npmTarget, {
      path: embeddedFacadeRelativePath(destination),
      sha256: stagedSha256,
      buildIdentity: dialogEvidence.manifest.buildIdentity,
    });
  }
}

// Embedded staging manifest (add-ext-dialog section 6.4): written only after
// the complete four-target matrix has been collected; any missing cell, hash
// mismatch, or identity skew above failed the run before reaching this point.
if (embeddedDialogTargets.size > 0) {
  const root = values.root ?? process.cwd();
  const identity = await readEmbeddedDialogFacadeIdentity(root);
  const stagingManifest = buildEmbeddedStagingManifest({
    facadeVersion: identity.facadeVersion,
    contractFingerprint: identity.contractFingerprint,
    targets: Object.fromEntries(embeddedDialogTargets),
  });
  const manifestDestination = join(embeddedDialogFacadeDir, "platforms", "manifest.json");
  await mkdir(dirname(join(root, manifestDestination)), { recursive: true });
  await writeFile(
    join(root, manifestDestination),
    `${JSON.stringify(stagingManifest, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `staged embedded manifest: ${manifestDestination} (${embeddedDialogTargets.size} targets, facade ${identity.facadeVersion}, fingerprint ${identity.contractFingerprint})`,
  );
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
  if (isEmbeddedExtensionArtifactKind(kind)) {
    throw new Error(
      `embedded extension kind ${kind} has no split per-platform package directory`,
    );
  }
  const directory =
    kind === "webview"
      ? target.webviewPackageDir
      : target.badgePackageDir;
  if (directory === undefined) {
    throw new Error(`target ${target.packageOs}-${target.arch} does not publish ${kind}`);
  }
  return directory;
}

/** Manifest paths are relative to the facade package root (consumer contract). */
function embeddedFacadeRelativePath(destination: string): string {
  const prefix = `${embeddedDialogFacadeDir}/`;
  if (!destination.startsWith(prefix)) {
    throw new Error(
      `embedded dialog staging destination is not inside ${embeddedDialogFacadeDir}: ${destination}`,
    );
  }
  return destination.slice(prefix.length);
}

async function readEmbeddedDialogFacadeIdentity(root: string): Promise<{
  facadeVersion: string;
  contractFingerprint: string;
}> {
  const packageManifest: unknown = JSON.parse(
    await readFile(join(root, embeddedDialogFacadeDir, "package.json"), "utf8"),
  );
  const contractManifest: unknown = JSON.parse(
    await readFile(join(root, embeddedDialogFacadeDir, "contract.json"), "utf8"),
  );
  if (
    !isRecord(packageManifest) ||
    typeof packageManifest.version !== "string" ||
    !isRecord(contractManifest) ||
    typeof contractManifest.contractFingerprint !== "string"
  ) {
    throw new Error(
      `invalid embedded dialog facade identity under ${embeddedDialogFacadeDir}`,
    );
  }
  return {
    facadeVersion: packageManifest.version,
    contractFingerprint: contractManifest.contractFingerprint,
  };
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
