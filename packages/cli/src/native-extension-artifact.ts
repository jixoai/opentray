// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Describe package-owned and exact-file native extension artifacts without importing binaries.
// 2. Resolve platform packages from the declaring facade's dependency closure.
// 3. Reject missing targets, invalid package metadata, and inaccessible native libraries precisely.
// 4. Resolve embedded per-target libraries through the staging manifest identity chain with
//    root containment and adversarial rejection (add-ext-dialog section 6.1/section 6.4).

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExpectedExtensionIdentity } from "@opentray/spec";

export type NativeExtensionArch = "arm64" | "x64";
export type NativeExtensionTarget = `${NodeJS.Platform}-${NativeExtensionArch}`;

export interface NativeExtensionPackageTarget {
  packageName: string;
  libraryPath: string;
}

export interface NativeExtensionIdentitySource {
  packageJsonUrl: string;
  contractManifestUrl: string;
}

export interface NativeExtensionPackageArtifact
  extends NativeExtensionIdentitySource {
  kind: "package";
  targets: Partial<Record<NativeExtensionTarget, NativeExtensionPackageTarget>>;
}

/** One embedded per-target library, relative to the facade package root (add-ext-dialog section 6.1). */
export interface NativeExtensionEmbeddedTarget {
  libraryPath: string;
}

/**
 * Frozen embedded staging matrix (add-ext-dialog section 6.4): a facade that
 * embeds platform binaries stages exactly these four targets. The runtime
 * resolver requires the staging manifest to be complete over this matrix
 * (release staging enforces the same set before anything is packed); one
 * missing cell is a manifest-invalid artifact, never a silently thinner
 * catalog.
 */
export const NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX = [
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
] as const;

/** One cell of the frozen embedded staging matrix. */
export type NativeExtensionEmbeddedMatrixTarget =
  (typeof NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX)[number];

/**
 * Facade package that ships its platform libraries inside its own tarball via
 * `platforms/<target>/` plus the root-contained staging manifest
 * `platforms/manifest.json` (add-ext-dialog section 6.4 identity chain). No
 * optionalDependencies platform packages are involved. The declared catalog
 * is complete over the frozen matrix: an incomplete embedded catalog is not
 * representable, and the runtime manifest check carries the same
 * completeness rule for untyped consumers.
 */
export interface NativeExtensionEmbeddedArtifact
  extends NativeExtensionIdentitySource {
  kind: "embedded";
  targets: Record<
    NativeExtensionEmbeddedMatrixTarget,
    NativeExtensionEmbeddedTarget
  >;
}

interface NativeExtensionFileArtifactBase {
  kind: "file";
  path: string;
}

export type NativeExtensionFileArtifact = NativeExtensionFileArtifactBase &
  (
    | {
        expectedIdentity: NativeExtensionExpectedIdentity;
        identitySource?: never;
      }
    | {
        expectedIdentity?: never;
        identitySource: NativeExtensionIdentitySource;
      }
  );

export type NativeExtensionArtifact =
  | NativeExtensionPackageArtifact
  | NativeExtensionFileArtifact
  | NativeExtensionEmbeddedArtifact;

export type NativeExtensionExpectedIdentity = ExpectedExtensionIdentity;

export interface ResolvedNativeExtensionArtifact {
  path: string;
  packageName?: string;
  packageVersion?: string;
  expectedIdentity: NativeExtensionExpectedIdentity;
  target: NativeExtensionTarget;
}

export class NativeExtensionArtifactResolutionError extends Error {
  readonly code = "OPENTRAY_NATIVE_EXTENSION_ARTIFACT_RESOLUTION_FAILED";
  readonly packageName?: string;
  readonly facadePackageJsonUrl?: string;

  constructor(
    message: string,
    readonly target: NativeExtensionTarget,
    options: ErrorOptions & {
      packageName?: string;
      facadePackageJsonUrl?: string;
    } = {}
  ) {
    super(message, options);
    this.name = "NativeExtensionArtifactResolutionError";
    if (options.packageName !== undefined) {
      this.packageName = options.packageName;
    }
    if (options.facadePackageJsonUrl !== undefined) {
      this.facadePackageJsonUrl = options.facadePackageJsonUrl;
    }
  }
}

/**
 * Structured embedded-artifact rejection reasons (add-ext-dialog section 6.1): the
 * four-class replacement of a single resolution-failed error. Consumers match
 * on `reason`/`code`; the human message is not a contract.
 */
export type NativeExtensionEmbeddedErrorReason =
  | "target-unsupported"
  | "path-outside-facade"
  | "manifest-invalid"
  | "library-unreadable";

/** Stable machine code per embedded rejection reason (same family style as the resolution error). */
export const NATIVE_EXTENSION_EMBEDDED_ERROR_CODES: Record<
  NativeExtensionEmbeddedErrorReason,
  string
> = {
  "target-unsupported": "OPENTRAY_NATIVE_EXTENSION_TARGET_UNSUPPORTED",
  "path-outside-facade": "OPENTRAY_NATIVE_EXTENSION_PATH_OUTSIDE_FACADE",
  "manifest-invalid": "OPENTRAY_NATIVE_EXTENSION_MANIFEST_INVALID",
  "library-unreadable": "OPENTRAY_NATIVE_EXTENSION_LIBRARY_UNREADABLE",
};

export class NativeExtensionEmbeddedArtifactError extends Error {
  readonly reason: NativeExtensionEmbeddedErrorReason;
  readonly code: string;
  readonly target: NativeExtensionTarget;
  readonly facadePackageJsonUrl?: string;

  constructor(
    reason: NativeExtensionEmbeddedErrorReason,
    message: string,
    options: ErrorOptions & {
      target: NativeExtensionTarget;
      facadePackageJsonUrl?: string;
    }
  ) {
    super(message, options);
    this.name = "NativeExtensionEmbeddedArtifactError";
    this.reason = reason;
    this.code = NATIVE_EXTENSION_EMBEDDED_ERROR_CODES[reason];
    this.target = options.target;
    if (options.facadePackageJsonUrl !== undefined) {
      this.facadePackageJsonUrl = options.facadePackageJsonUrl;
    }
  }
}

/** Resolve one exact native library from the dependency closure that owns the facade. */
export const resolveNativeExtensionArtifact = async (
  artifact: NativeExtensionArtifact,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<ResolvedNativeExtensionArtifact> => {
  const target = nativeExtensionTarget(platform, arch);
  if (artifact.kind === "file") {
    return {
      path: await resolveAccessibleLibrary(artifact.path, target),
      expectedIdentity:
        artifact.expectedIdentity ??
        (await resolveExpectedIdentity(artifact.identitySource, target)),
      target,
    };
  }

  if (artifact.kind === "embedded") {
    return resolveEmbeddedExtensionArtifact(artifact, target);
  }

  const packageTarget = artifact.targets[target];
  if (packageTarget === undefined) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension does not support target ${target}`,
      target
    );
  }

  const expectedIdentity = await resolveExpectedIdentity(artifact, target);

  const resolveFromFacade = createRequire(artifact.packageJsonUrl);
  let platformPackageJsonPath: string;
  try {
    platformPackageJsonPath = resolveFromFacade.resolve(
      `${packageTarget.packageName}/package.json`
    );
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `unable to resolve native extension package "${packageTarget.packageName}" for ${target} from ${artifact.packageJsonUrl}`,
      target,
      {
        cause,
        packageName: packageTarget.packageName,
        facadePackageJsonUrl: artifact.packageJsonUrl,
      }
    );
  }

  const manifest = await readPlatformPackageManifest(
    platformPackageJsonPath,
    target,
    packageTarget.packageName
  );
  const libraryPath = join(dirname(platformPackageJsonPath), packageTarget.libraryPath);
  return {
    path: await resolveAccessibleLibrary(libraryPath, target, packageTarget.packageName),
    packageName: packageTarget.packageName,
    packageVersion: manifest.version,
    expectedIdentity,
    target,
  };
};

const resolveExpectedIdentity = async (
  source: NativeExtensionIdentitySource,
  target: NativeExtensionTarget
): Promise<NativeExtensionExpectedIdentity> => {
  const [facadeManifest, contractManifest] = await Promise.all([
    readFacadePackageManifest(source.packageJsonUrl, target),
    readExtensionContractManifest(source.contractManifestUrl, target),
  ]);
  const [os, arch] = splitTarget(target);
  return {
    extensionName: contractManifest.extensionName,
    artifactSetVersion: facadeManifest.version,
    contractFingerprint: contractManifest.contractFingerprint,
    target: { os, arch },
  };
};

// ---------------------------------------------------------------------------
// Embedded artifacts (add-ext-dialog section 6.1/section 6.4): the facade ships its own
// platform libraries plus a root-contained staging manifest carrying the
// identity chain (per-target path, SHA-256, buildIdentity, facade version,
// contract fingerprint). Resolution validates containment on every path,
// cross-checks the manifest against the facade/contract manifests, hashes the
// selected library's real bytes, and feeds sha256/buildIdentity into the
// LoadExt expected identity (the broker re-hashes before dlopen).
// ---------------------------------------------------------------------------

/** Fixed location of the embedded staging manifest inside the facade package. */
export const EMBEDDED_STAGING_MANIFEST_PATH = "platforms/manifest.json";

interface EmbeddedStagingManifestTargetEntry {
  path: string;
  sha256: string;
  buildIdentity: string;
}

interface EmbeddedStagingManifest {
  facadeVersion: string;
  contractFingerprint: string;
  targets: Record<string, EmbeddedStagingManifestTargetEntry>;
}

const sha256HexPattern = /^[a-f0-9]{64}$/u;

const isEmbeddedMatrixTarget = (
  target: NativeExtensionTarget
): target is NativeExtensionEmbeddedMatrixTarget =>
  (NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX as readonly string[]).includes(target);

const lexicalContained = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  if (rel.length === 0) {
    return false;
  }
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};

const resolveEmbeddedExtensionArtifact = async (
  artifact: NativeExtensionEmbeddedArtifact,
  target: NativeExtensionTarget
): Promise<ResolvedNativeExtensionArtifact> => {
  const facadePackageJsonUrl = artifact.packageJsonUrl;
  const embeddedError = (
    reason: NativeExtensionEmbeddedErrorReason,
    message: string,
    options: { cause?: unknown } = {}
  ): NativeExtensionEmbeddedArtifactError =>
    new NativeExtensionEmbeddedArtifactError(reason, message, {
      target,
      facadePackageJsonUrl,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });

  // Targets outside the frozen matrix are unsupported platforms for the
  // embedded artifact kind (linux resolves here, for example).
  if (!isEmbeddedMatrixTarget(target)) {
    throw embeddedError(
      "target-unsupported",
      `embedded native extension supports only the frozen staging matrix (${NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX.join(", ")}); ${target} is outside it`
    );
  }
  const embeddedTarget = artifact.targets[target];
  if (embeddedTarget === undefined) {
    // Unreachable for typed callers (the descriptor is complete over the
    // matrix); untyped consumers still get the structured rejection.
    throw embeddedError(
      "target-unsupported",
      `embedded native extension does not declare target ${target}`
    );
  }

  const facadeRoot = dirname(fileURLToPath(new URL(facadePackageJsonUrl)));

  // Lexical containment first: absolute and traversal (`../../outside`)
  // libraryPath values are rejected before touching the filesystem.
  if (isAbsolute(embeddedTarget.libraryPath)) {
    throw embeddedError(
      "path-outside-facade",
      `embedded library path must be relative to the facade package root: ${embeddedTarget.libraryPath}`
    );
  }
  const candidatePath = resolve(facadeRoot, embeddedTarget.libraryPath);
  if (!lexicalContained(facadeRoot, candidatePath)) {
    throw embeddedError(
      "path-outside-facade",
      `embedded library path escapes the facade package root: ${embeddedTarget.libraryPath}`
    );
  }

  // Identity-chain inputs: facade package.json and contract.json. Any read or
  // shape failure here means the staging identity chain cannot be established.
  const [facadeManifest, contractManifest] = await Promise.all([
    readEmbeddedJson(facadePackageJsonUrl, embeddedError).then((parsed) => {
      if (!isFacadePackageManifest(parsed)) {
        throw embeddedError(
          "manifest-invalid",
          `embedded facade package manifest is invalid at ${facadePackageJsonUrl}`
        );
      }
      return parsed;
    }),
    readEmbeddedJson(artifact.contractManifestUrl, embeddedError).then((parsed) => {
      if (!isExtensionContractManifest(parsed)) {
        throw embeddedError(
          "manifest-invalid",
          `embedded extension contract manifest is invalid at ${artifact.contractManifestUrl}`
        );
      }
      return parsed;
    }),
  ]);

  const manifestPath = join(facadeRoot, EMBEDDED_STAGING_MANIFEST_PATH);
  const manifest = await readEmbeddedJson(
    pathToFileURL(manifestPath).href,
    embeddedError
  ).then((parsed) => {
    if (!isEmbeddedStagingManifest(parsed)) {
      throw embeddedError(
        "manifest-invalid",
        `embedded staging manifest is invalid at ${manifestPath}`
      );
    }
    return parsed;
  });

  if (manifest.facadeVersion !== facadeManifest.version) {
    throw embeddedError(
      "manifest-invalid",
      `embedded staging manifest facade version ${manifest.facadeVersion} does not match facade package version ${facadeManifest.version}`
    );
  }
  if (manifest.contractFingerprint !== contractManifest.contractFingerprint) {
    throw embeddedError(
      "manifest-invalid",
      `embedded staging manifest contract fingerprint does not match the contract manifest at ${artifact.contractManifestUrl}`
    );
  }
  // Manifest completeness over the frozen matrix (section 6.4): every cell
  // must be present, and no key outside the matrix may appear. An incomplete
  // or widened manifest is a staging-chain break, not a thinner catalog.
  for (const matrixTarget of NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX) {
    if (manifest.targets[matrixTarget] === undefined) {
      throw embeddedError(
        "manifest-invalid",
        `embedded staging manifest is missing required matrix target ${matrixTarget}`
      );
    }
  }
  for (const manifestTarget of Object.keys(manifest.targets)) {
    if (!isEmbeddedMatrixTarget(manifestTarget as NativeExtensionTarget)) {
      throw embeddedError(
        "manifest-invalid",
        `embedded staging manifest declares target ${manifestTarget} outside the frozen staging matrix`
      );
    }
    if (
      artifact.targets[manifestTarget as NativeExtensionEmbeddedMatrixTarget] ===
      undefined
    ) {
      throw embeddedError(
        "manifest-invalid",
        `embedded staging manifest declares undeclared target ${manifestTarget}`
      );
    }
  }
  const manifestEntry = manifest.targets[target];
  if (manifestEntry === undefined) {
    throw embeddedError(
      "manifest-invalid",
      `embedded staging manifest has no entry for target ${target}`
    );
  }

  if (isAbsolute(manifestEntry.path)) {
    throw embeddedError(
      "path-outside-facade",
      `embedded staging manifest library path must be relative to the facade package root: ${manifestEntry.path}`
    );
  }
  const manifestLibraryPath = resolve(facadeRoot, manifestEntry.path);
  if (!lexicalContained(facadeRoot, manifestLibraryPath)) {
    throw embeddedError(
      "path-outside-facade",
      `embedded staging manifest library path escapes the facade package root: ${manifestEntry.path}`
    );
  }
  if (manifestLibraryPath !== candidatePath) {
    throw embeddedError(
      "manifest-invalid",
      `embedded staging manifest path ${manifestEntry.path} does not match the declared library path ${embeddedTarget.libraryPath} for target ${target}`
    );
  }

  // Realpath containment catches symlink escapes: a link inside the facade
  // that resolves outside is rejected even though it is lexically contained.
  const realRoot = await realpath(facadeRoot).catch(() => facadeRoot);
  let realCandidate: string;
  try {
    realCandidate = await realpath(candidatePath);
  } catch (cause) {
    throw embeddedError(
      "library-unreadable",
      `embedded native extension library is not accessible at ${candidatePath}`,
      { cause }
    );
  }
  if (!lexicalContained(realRoot, realCandidate)) {
    throw embeddedError(
      "path-outside-facade",
      `embedded library resolves outside the facade package root: ${embeddedTarget.libraryPath}`
    );
  }

  // Hash the real bytes: a replaced library must never pass a manifest claim
  // (the broker re-checks the same value before dlopen).
  let libraryBytes: Buffer;
  try {
    libraryBytes = await readFile(realCandidate);
  } catch (cause) {
    throw embeddedError(
      "library-unreadable",
      `embedded native extension library is not readable at ${realCandidate}`,
      { cause }
    );
  }
  const sha256 = createHash("sha256").update(libraryBytes).digest("hex");
  if (sha256 !== manifestEntry.sha256) {
    throw embeddedError(
      "manifest-invalid",
      `embedded library bytes do not match the staging manifest SHA-256 for target ${target}`
    );
  }

  const [os, arch] = splitTarget(target);
  const expectedIdentity: NativeExtensionExpectedIdentity = {
    extensionName: contractManifest.extensionName,
    artifactSetVersion: facadeManifest.version,
    contractFingerprint: contractManifest.contractFingerprint,
    target: { os, arch },
    sha256,
    buildIdentity: manifestEntry.buildIdentity,
  };
  return { path: realCandidate, expectedIdentity, target };
};

const readEmbeddedJson = async (
  url: string,
  embeddedError: (
    reason: NativeExtensionEmbeddedErrorReason,
    message: string,
    options?: { cause?: unknown }
  ) => NativeExtensionEmbeddedArtifactError
): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(new URL(url), "utf8"));
  } catch (cause) {
    throw embeddedError(
      "manifest-invalid",
      `unable to read embedded identity-chain manifest at ${url}`,
      { cause }
    );
  }
};

const isEmbeddedStagingManifest = (
  value: unknown
): value is EmbeddedStagingManifest => {
  if (!isRecordLike(value) || !isRecordLike(value.targets)) {
    return false;
  }
  if (
    typeof value.facadeVersion !== "string" ||
    typeof value.contractFingerprint !== "string"
  ) {
    return false;
  }
  for (const entry of Object.values(value.targets)) {
    if (
      !isRecordLike(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      !sha256HexPattern.test(entry.sha256) ||
      typeof entry.buildIdentity !== "string" ||
      entry.buildIdentity.length === 0
    ) {
      return false;
    }
  }
  return true;
};

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nativeExtensionTarget = (
  platform: NodeJS.Platform,
  arch: string
): NativeExtensionTarget => {
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`unsupported native extension architecture: ${arch}`);
  }
  return `${platform}-${arch}`;
};

interface PlatformPackageManifest {
  name: string;
  version: string;
  os?: string[];
  cpu?: string[];
}

interface FacadePackageManifest {
  name: string;
  version: string;
}

interface ExtensionContractManifest {
  extensionName: string;
  contractFingerprint: string;
}

const readFacadePackageManifest = async (
  packageJsonUrl: string,
  target: NativeExtensionTarget
): Promise<FacadePackageManifest> => {
  const parsed = await readJsonUrl(packageJsonUrl, target, "facade package manifest");
  if (!isFacadePackageManifest(parsed)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension facade manifest is invalid at ${packageJsonUrl}`,
      target,
      { facadePackageJsonUrl: packageJsonUrl }
    );
  }
  return parsed;
};

const readExtensionContractManifest = async (
  contractManifestUrl: string,
  target: NativeExtensionTarget
): Promise<ExtensionContractManifest> => {
  const parsed = await readJsonUrl(
    contractManifestUrl,
    target,
    "extension contract manifest"
  );
  if (!isExtensionContractManifest(parsed)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension contract manifest is invalid at ${contractManifestUrl}`,
      target
    );
  }
  return parsed;
};

const readJsonUrl = async (
  url: string,
  target: NativeExtensionTarget,
  label: string
): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(new URL(url), "utf8"));
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `unable to read ${label} at ${url}`,
      target,
      { cause }
    );
  }
};

const readPlatformPackageManifest = async (
  packageJsonPath: string,
  target: NativeExtensionTarget,
  packageName: string
): Promise<PlatformPackageManifest> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `unable to read native extension package manifest at ${packageJsonPath}`,
      target,
      { cause, packageName }
    );
  }
  if (!isPlatformPackageManifest(parsed) || parsed.name !== packageName) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension package manifest at ${packageJsonPath} does not identify ${packageName}`,
      target,
      { packageName }
    );
  }
  const [platform, arch] = splitTarget(target);
  if (parsed.os !== undefined && !parsed.os.includes(platform)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension package ${packageName} does not support os ${platform}`,
      target,
      { packageName }
    );
  }
  if (parsed.cpu !== undefined && !parsed.cpu.includes(arch)) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension package ${packageName} does not support cpu ${arch}`,
      target,
      { packageName }
    );
  }
  return parsed;
};

const isPlatformPackageManifest = (
  value: unknown
): value is PlatformPackageManifest =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "version" in value &&
  typeof value.version === "string" &&
  (!("os" in value) ||
    (Array.isArray(value.os) && value.os.every((item) => typeof item === "string"))) &&
  (!("cpu" in value) ||
    (Array.isArray(value.cpu) && value.cpu.every((item) => typeof item === "string")));

const isFacadePackageManifest = (value: unknown): value is FacadePackageManifest =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "version" in value &&
  typeof value.version === "string";

const isExtensionContractManifest = (
  value: unknown
): value is ExtensionContractManifest =>
  typeof value === "object" &&
  value !== null &&
  "extensionName" in value &&
  typeof value.extensionName === "string" &&
  "contractFingerprint" in value &&
  typeof value.contractFingerprint === "string";

const splitTarget = (
  target: NativeExtensionTarget
): [NodeJS.Platform, NativeExtensionArch] => {
  const separator = target.lastIndexOf("-");
  return [
    target.slice(0, separator) as NodeJS.Platform,
    target.slice(separator + 1) as NativeExtensionArch,
  ];
};

const resolveAccessibleLibrary = async (
  path: string,
  target: NativeExtensionTarget,
  packageName?: string
): Promise<string> => {
  try {
    return await realpath(path);
  } catch (cause) {
    throw new NativeExtensionArtifactResolutionError(
      `native extension library is not accessible at ${path}`,
      target,
      {
        cause,
        ...(packageName === undefined ? {} : { packageName }),
      }
    );
  }
};
