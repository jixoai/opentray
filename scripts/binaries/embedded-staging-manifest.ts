// Orthogonal intents (2026-09-17; original user request: add-ext-dialog batch D,
// design reference section 6.4 — embedded staging manifest identity chain):
// 1. Freeze the embedded staging target matrix exactly as the frozen consumer
//    contract (packages/cli/src/native-extension-artifact.ts
//    NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX) declares it: npm target keys
//    (win32, not windows) over darwin/windows arm64/x64.
// 2. Build the root-contained `platforms/manifest.json` as a PURE function over
//    collected per-target staging evidence — no filesystem, no native
//    binaries — so local tests can prove the completeness rules with
//    synthetic fixtures.
// 3. Fail hard on incompleteness: fewer than four targets, a key outside the
//    matrix, a malformed SHA-256, or an empty buildIdentity never produce a
//    manifest; a silently thinner catalog is not representable.

/**
 * Frozen embedded staging matrix (add-ext-dialog section 6.4). Must stay
 * key-identical to the consumer's NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX.
 */
export const EMBEDDED_STAGING_TARGET_MATRIX = [
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
] as const;

export type EmbeddedStagingMatrixTarget =
  (typeof EMBEDDED_STAGING_TARGET_MATRIX)[number];

/** One collected per-target evidence cell (from the native build artifact manifest). */
export interface EmbeddedStagingTargetEvidence {
  /** Library path relative to the facade package root (e.g. `platforms/darwin-arm64/libopentray_ext_dialog.dylib`). */
  readonly path: string;
  /** SHA-256 (64 lowercase hex) of the staged library bytes. */
  readonly sha256: string;
  /** Non-empty build identity recorded by the native build (OPENTRAY_BUILD_IDENTITY at build time). */
  readonly buildIdentity: string;
}

export interface EmbeddedStagingManifest {
  readonly facadeVersion: string;
  readonly contractFingerprint: string;
  readonly targets: Record<
    EmbeddedStagingMatrixTarget,
    EmbeddedStagingTargetEvidence
  >;
}

const sha256HexPattern = /^[a-f0-9]{64}$/u;

const isMatrixTarget = (value: string): value is EmbeddedStagingMatrixTarget =>
  (EMBEDDED_STAGING_TARGET_MATRIX as readonly string[]).includes(value);

/**
 * Validate collected evidence and produce the staging manifest document.
 * Throws on any completeness or shape violation; never returns a partial
 * catalog. Mirrors the consumer-side validator
 * (packages/cli/src/native-extension-artifact.ts isEmbeddedStagingManifest)
 * plus the staging-side completeness rule: exactly the four matrix cells.
 */
export const buildEmbeddedStagingManifest = (input: {
  facadeVersion: string;
  contractFingerprint: string;
  targets: Readonly<Record<string, EmbeddedStagingTargetEvidence>>;
}): EmbeddedStagingManifest => {
  if (input.facadeVersion.length === 0) {
    throw new Error("embedded staging manifest requires a non-empty facade version");
  }
  if (input.contractFingerprint.length === 0) {
    throw new Error("embedded staging manifest requires a non-empty contract fingerprint");
  }

  for (const key of Object.keys(input.targets)) {
    if (!isMatrixTarget(key)) {
      throw new Error(
        `embedded staging evidence declares target ${key} outside the frozen staging matrix (${EMBEDDED_STAGING_TARGET_MATRIX.join(", ")})`
      );
    }
  }

  const targets = {} as Record<
    EmbeddedStagingMatrixTarget,
    EmbeddedStagingTargetEvidence
  >;
  for (const matrixTarget of EMBEDDED_STAGING_TARGET_MATRIX) {
    const evidence = input.targets[matrixTarget];
    if (evidence === undefined) {
      throw new Error(
        `embedded staging evidence is incomplete: missing required matrix target ${matrixTarget} (design section 6.4; refusing to write a thinner catalog)`
      );
    }
    if (evidence.path.length === 0) {
      throw new Error(
        `embedded staging evidence for ${matrixTarget} requires a non-empty library path`
      );
    }
    if (!sha256HexPattern.test(evidence.sha256)) {
      throw new Error(
        `embedded staging evidence for ${matrixTarget} carries a malformed SHA-256: ${evidence.sha256}`
      );
    }
    if (evidence.buildIdentity.length === 0) {
      throw new Error(
        `embedded staging evidence for ${matrixTarget} carries an empty build identity`
      );
    }
    targets[matrixTarget] = {
      path: evidence.path,
      sha256: evidence.sha256,
      buildIdentity: evidence.buildIdentity,
    };
  }

  return {
    facadeVersion: input.facadeVersion,
    contractFingerprint: input.contractFingerprint,
    targets,
  };
};
