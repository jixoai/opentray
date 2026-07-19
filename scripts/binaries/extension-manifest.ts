// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Read the manifest exported by an actual native extension artifact through a same-target inspector.
// 2. Derive the expected identity from the facade package and canonical contract files.
// 3. Reject stale or cross-target artifacts with expected/actual evidence.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const EXTENSION_ABI_VERSION = 3;

export type ExtensionArtifactKind = "webview" | "badge";

export interface ExtensionArtifactTarget {
  readonly os: string;
  readonly arch: string;
}

export interface ExpectedExtensionArtifactIdentity {
  readonly extensionName: string;
  readonly artifactSetVersion: string;
  readonly contractFingerprint: string;
  readonly target: ExtensionArtifactTarget;
}

export interface EmbeddedExtensionManifest extends ExpectedExtensionArtifactIdentity {
  readonly abiVersion: number;
  readonly buildIdentity: string;
}

export interface ExtensionArtifactEvidence {
  readonly kind: ExtensionArtifactKind;
  readonly file: string;
  readonly sha256: string;
  readonly manifest: EmbeddedExtensionManifest;
}

export const createExtensionArtifactEvidence = async (
  root: string,
  kind: ExtensionArtifactKind,
  file: string,
  target: ExtensionArtifactTarget,
): Promise<ExtensionArtifactEvidence> => {
  const expected = await readExpectedExtensionArtifactIdentity(root, kind, target);
  const manifest = await inspectExtensionArtifact(root, file);
  verifyExtensionArtifactIdentity(expected, manifest);
  return {
    kind,
    file: basename(file),
    sha256: await sha256File(file),
    manifest,
  };
};

export const verifyRecordedExtensionArtifact = async (
  root: string,
  file: string,
  target: ExtensionArtifactTarget,
  evidence: ExtensionArtifactEvidence,
): Promise<void> => {
  if (basename(file) !== evidence.file) {
    throw new Error(
      `native extension artifact filename mismatch: expected=${evidence.file} actual=${basename(file)}`,
    );
  }
  const actualSha256 = await sha256File(file);
  if (actualSha256 !== evidence.sha256) {
    throw new Error(
      `native extension artifact SHA-256 mismatch: file=${evidence.file} expected=${evidence.sha256} actual=${actualSha256}`,
    );
  }
  const expected = await readExpectedExtensionArtifactIdentity(root, evidence.kind, target);
  verifyExtensionArtifactIdentity(expected, evidence.manifest);
};

export const verifyExtensionPlatformPackageTarget = async (
  root: string,
  packageDirectory: string,
  target: ExtensionArtifactTarget,
): Promise<void> => {
  const manifest = await readJson(join(root, packageDirectory, "package.json"));
  if (
    !isRecord(manifest) ||
    !isSingletonStringArray(manifest.os, target.os) ||
    !isSingletonStringArray(manifest.cpu, target.arch)
  ) {
    throw new Error(
      `native extension platform package target mismatch: package=${packageDirectory} expected=${JSON.stringify(target)}`,
    );
  }
};

export const inspectExtensionArtifact = async (
  root: string,
  path: string,
): Promise<EmbeddedExtensionManifest> => {
  const inspector = resolveExtensionInspectorPath(root);
  const json = await runInspector(inspector, path);
  return parseEmbeddedExtensionManifest(JSON.parse(json));
};

export const resolveExtensionInspectorPath = (
  root: string,
  platform: string = process.platform,
): string =>
  join(
    root,
    "target",
    "release",
    platform === "win32"
      ? "opentray-extension-inspector.exe"
      : "opentray-extension-inspector",
  );

export const readExpectedExtensionArtifactIdentity = async (
  root: string,
  kind: ExtensionArtifactKind,
  target: ExtensionArtifactTarget,
): Promise<ExpectedExtensionArtifactIdentity> => {
  const packageRoot = join(root, "packages", `ext-${kind}`);
  const [packageManifest, contractManifest] = await Promise.all([
    readJson(join(packageRoot, "package.json")),
    readJson(join(packageRoot, "contract.json")),
  ]);
  if (
    !isRecord(packageManifest) ||
    typeof packageManifest.version !== "string" ||
    !isRecord(contractManifest) ||
    typeof contractManifest.extensionName !== "string" ||
    typeof contractManifest.contractFingerprint !== "string"
  ) {
    throw new Error(`invalid extension facade identity for ${kind}`);
  }
  return {
    extensionName: contractManifest.extensionName,
    artifactSetVersion: packageManifest.version,
    contractFingerprint: contractManifest.contractFingerprint,
    target,
  };
};

export const verifyExtensionArtifactIdentity = (
  expected: ExpectedExtensionArtifactIdentity,
  actual: EmbeddedExtensionManifest,
): void => {
  if (
    actual.abiVersion === EXTENSION_ABI_VERSION &&
    actual.extensionName === expected.extensionName &&
    actual.artifactSetVersion === expected.artifactSetVersion &&
    actual.contractFingerprint === expected.contractFingerprint &&
    actual.target.os === expected.target.os &&
    actual.target.arch === expected.target.arch &&
    actual.buildIdentity.length > 0
  ) {
    return;
  }
  throw new Error(
    `native extension artifact identity mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
  );
};

export const sha256File = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export const isExtensionArtifactKind = (value: string): value is ExtensionArtifactKind =>
  value === "webview" || value === "badge";

const parseEmbeddedExtensionManifest = (value: unknown): EmbeddedExtensionManifest => {
  if (
    !isRecord(value) ||
    typeof value.extensionName !== "string" ||
    typeof value.abiVersion !== "number" ||
    typeof value.artifactSetVersion !== "string" ||
    typeof value.contractFingerprint !== "string" ||
    !isRecord(value.target) ||
    typeof value.target.os !== "string" ||
    typeof value.target.arch !== "string" ||
    typeof value.buildIdentity !== "string"
  ) {
    throw new Error("native extension returned an invalid embedded manifest");
  }
  return {
    extensionName: value.extensionName,
    abiVersion: value.abiVersion,
    artifactSetVersion: value.artifactSetVersion,
    contractFingerprint: value.contractFingerprint,
    target: { os: value.target.os, arch: value.target.arch },
    buildIdentity: value.buildIdentity,
  };
};

const runInspector = (inspector: string, artifact: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(inspector, [artifact], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          `native extension inspector failed with code ${code ?? "unknown"}${detail.length > 0 ? `: ${detail}` : ""}`,
        ),
      );
    });
  });

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSingletonStringArray = (value: unknown, expected: string): boolean =>
  Array.isArray(value) && value.length === 1 && value[0] === expected;
