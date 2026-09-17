// Orthogonal intents (2026-09-17; original user request: add-ext-dialog batch D,
// design reference section 6.4 — four-target completeness before manifest write):
// 1. Prove the pure embedded staging manifest generator: accepts exactly the
//    frozen four-target matrix, rejects three-target incompleteness, keys
//    outside the matrix, malformed SHA-256, and empty build identity
//    (synthetic evidence only — windows targets are not locally buildable).
// 2. Prove the full staging chain end-to-end with synthetic fixture artifacts:
//    stage-release-artifacts writes packages/ext-dialog/platforms/manifest.json
//    only when all four targets' recorded evidence matches the facade identity;
//    a stale artifactSetVersion or a missing target fails the run.
// 3. Chain into the real pack gates: validate-package-dirs (pnpm pack) and
//    check-pack-size / verify-embedded-pack-evidence (real npm pack + unpack
//    identity re-hash) against the staged fixture package.

import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  EMBEDDED_STAGING_TARGET_MATRIX,
  buildEmbeddedStagingManifest,
} from "./embedded-staging-manifest";
import { runCheck } from "../check-pack-size.ts";

const execFileAsync = promisify(execFile);

const FIXTURE_VERSION = "9.9.9";
const FIXTURE_FINGERPRINT = "opentray-ext-dialog-contract-1";
const ABI_VERSION = 3;

/** Build target id (graph naming) -> npm matrix target + library file name. */
const FIXTURE_TARGETS = [
  { buildTarget: "darwin-arm64", npmTarget: "darwin-arm64", library: "libopentray_ext_dialog.dylib", os: "darwin" },
  { buildTarget: "darwin-x64", npmTarget: "darwin-x64", library: "libopentray_ext_dialog.dylib", os: "darwin" },
  { buildTarget: "windows-arm64", npmTarget: "win32-arm64", library: "opentray_ext_dialog.dll", os: "win32" },
  { buildTarget: "windows-x64", npmTarget: "win32-x64", library: "opentray_ext_dialog.dll", os: "win32" },
] as const;

const sha256Of = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

const syntheticEvidence = (
  npmTarget: string,
  bytes: Buffer,
  buildIdentity: string
) => ({
  path: `platforms/${npmTarget}/${npmTarget.startsWith("win32-") ? "opentray_ext_dialog.dll" : "libopentray_ext_dialog.dylib"}`,
  sha256: sha256Of(bytes),
  buildIdentity,
});

describe("Feature: embedded staging manifest generator (pure)", () => {
  test("Scenario: Given all four matrix targets When the manifest is built Then the frozen identity chain is complete", () => {
    const bytes = Buffer.from("synthetic-library-bytes");
    const targets = Object.fromEntries(
      EMBEDDED_STAGING_TARGET_MATRIX.map((target) => [
        target,
        syntheticEvidence(target, bytes, `github:${target}`),
      ])
    );

    const manifest = buildEmbeddedStagingManifest({
      facadeVersion: FIXTURE_VERSION,
      contractFingerprint: FIXTURE_FINGERPRINT,
      targets,
    });

    expect(manifest.facadeVersion).toBe(FIXTURE_VERSION);
    expect(manifest.contractFingerprint).toBe(FIXTURE_FINGERPRINT);
    expect(Object.keys(manifest.targets).sort()).toEqual([
      ...EMBEDDED_STAGING_TARGET_MATRIX,
    ].sort());
    for (const target of EMBEDDED_STAGING_TARGET_MATRIX) {
      expect(manifest.targets[target]).toEqual(syntheticEvidence(target, bytes, `github:${target}`));
    }
  });

  test("Scenario: Given only three collected targets When the manifest is built Then it fails instead of writing a thinner catalog", () => {
    const bytes = Buffer.from("synthetic-library-bytes");
    const targets = Object.fromEntries(
      EMBEDDED_STAGING_TARGET_MATRIX.slice(0, 3).map((target) => [
        target,
        syntheticEvidence(target, bytes, `github:${target}`),
      ])
    );

    expect(() =>
      buildEmbeddedStagingManifest({
        facadeVersion: FIXTURE_VERSION,
        contractFingerprint: FIXTURE_FINGERPRINT,
        targets,
      })
    ).toThrow(/missing required matrix target win32-x64/);
  });

  test("Scenario: Given a key outside the frozen matrix When the manifest is built Then it is rejected", () => {
    const bytes = Buffer.from("synthetic-library-bytes");
    const targets = Object.fromEntries(
      EMBEDDED_STAGING_TARGET_MATRIX.map((target) => [
        target,
        syntheticEvidence(target, bytes, `github:${target}`),
      ])
    );
    targets["linux-x64"] = syntheticEvidence("linux-x64", bytes, "github:linux-x64");

    expect(() =>
      buildEmbeddedStagingManifest({
        facadeVersion: FIXTURE_VERSION,
        contractFingerprint: FIXTURE_FINGERPRINT,
        targets,
      })
    ).toThrow(/outside the frozen staging matrix/);
  });

  test("Scenario: Given a malformed SHA-256 or empty build identity When the manifest is built Then it is rejected", () => {
    const bytes = Buffer.from("synthetic-library-bytes");
    const complete = () =>
      Object.fromEntries(
        EMBEDDED_STAGING_TARGET_MATRIX.map((target) => [
          target,
          syntheticEvidence(target, bytes, `github:${target}`),
        ])
      );

    const badHash = complete();
    badHash["darwin-arm64"] = {
      ...badHash["darwin-arm64"],
      sha256: "not-a-hash",
    };
    expect(() =>
      buildEmbeddedStagingManifest({
        facadeVersion: FIXTURE_VERSION,
        contractFingerprint: FIXTURE_FINGERPRINT,
        targets: badHash,
      })
    ).toThrow(/malformed SHA-256/);

    const badIdentity = complete();
    badIdentity["win32-arm64"] = {
      ...badIdentity["win32-arm64"],
      buildIdentity: "",
    };
    expect(() =>
      buildEmbeddedStagingManifest({
        facadeVersion: FIXTURE_VERSION,
        contractFingerprint: FIXTURE_FINGERPRINT,
        targets: badIdentity,
      })
    ).toThrow(/empty build identity/);
  });
});

/** Synthetic end-to-end fixture workspace: facade package + per-target artifact manifests. */
const createFixtureWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "opentray-embedded-staging-"));
  const facadeDir = join(root, "packages/ext-dialog");
  await mkdir(facadeDir, { recursive: true });
  await writeFile(
    join(facadeDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@opentray/ext-dialog",
        version: FIXTURE_VERSION,
        files: ["contract.json", "platforms", "README.md"],
      },
      null,
      2
    )}\n`
  );
  await writeFile(join(facadeDir, "README.md"), "fixture\n");
  await writeFile(
    join(facadeDir, "contract.json"),
    `${JSON.stringify(
      { extensionName: "dialog", contractFingerprint: FIXTURE_FINGERPRINT },
      null,
      2
    )}\n`
  );
  return root;
};

interface FixtureTargetArtifacts {
  readonly artifactDirectory: string;
  readonly bytes: Buffer;
}

const writeFixtureTargetArtifact = async (
  root: string,
  fixture: (typeof FIXTURE_TARGETS)[number],
  options: { staleVersion?: boolean } = {}
): Promise<FixtureTargetArtifacts> => {
  const artifactName = `native-${fixture.buildTarget}-dialog`;
  const artifactDirectory = join(root, "native-artifacts", artifactName);
  await mkdir(artifactDirectory, { recursive: true });
  // Distinct bytes per target: the darwin dylib basename is shared by both
  // arches, so per-target bytes prove the (target, kind) destination routing.
  const bytes = Buffer.from(`synthetic-dialog-library:${fixture.buildTarget}`, "utf8");
  await writeFile(join(artifactDirectory, fixture.library), bytes);
  const manifest = {
    target: fixture.buildTarget,
    components: ["dialog"],
    artifactKinds: ["dialog"],
    artifactName,
    files: [fixture.library],
    extensionArtifacts: [
      {
        kind: "dialog",
        file: fixture.library,
        sha256: sha256Of(bytes),
        manifest: {
          extensionName: "dialog",
          abiVersion: ABI_VERSION,
          artifactSetVersion: options.staleVersion === true ? "0.0.1" : FIXTURE_VERSION,
          contractFingerprint: FIXTURE_FINGERPRINT,
          target: { os: fixture.os, arch: fixture.buildTarget.split("-")[1] },
          buildIdentity: `synthetic:${fixture.buildTarget}`,
        },
      },
    ],
  };
  await writeFile(
    join(artifactDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return { artifactDirectory, bytes };
};

const stagePlanJson = (targets: readonly string[]): string =>
  JSON.stringify(
    targets.map((buildTarget) => ({
      target: buildTarget,
      artifactKinds: ["dialog"],
      artifactName: `native-${buildTarget}-dialog`,
    }))
  );

const runStageScript = async (
  root: string,
  stagePlan: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const script = join(import.meta.dir, "stage-release-artifacts.ts");
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        script,
        "--root",
        root,
        "--artifact-root",
        join(root, "native-artifacts"),
        "--stage-plan-json",
        stagePlan,
      ],
      { cwd: root, encoding: "utf8" }
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
};

describe("Feature: embedded dialog staging chain (synthetic artifacts)", () => {
  test("Scenario: Given four collected targets matching the facade identity When staging runs Then the embedded manifest is written with real byte hashes", async () => {
    const root = await createFixtureWorkspace();
    try {
      const bytesByTarget = new Map<string, Buffer>();
      for (const fixture of FIXTURE_TARGETS) {
        const { bytes } = await writeFixtureTargetArtifact(root, fixture);
        bytesByTarget.set(fixture.npmTarget, bytes);
      }

      const result = await runStageScript(root, stagePlanJson(FIXTURE_TARGETS.map((f) => f.buildTarget)));
      expect(result.exitCode).toBe(0);

      const stagedManifest = JSON.parse(
        await readFile(join(root, "packages/ext-dialog/platforms/manifest.json"), "utf8")
      );
      expect(stagedManifest.facadeVersion).toBe(FIXTURE_VERSION);
      expect(stagedManifest.contractFingerprint).toBe(FIXTURE_FINGERPRINT);
      expect(Object.keys(stagedManifest.targets).sort()).toEqual(
        [...EMBEDDED_STAGING_TARGET_MATRIX].sort()
      );
      for (const fixture of FIXTURE_TARGETS) {
        expect(stagedManifest.targets[fixture.npmTarget]).toEqual(
          syntheticEvidence(
            fixture.npmTarget,
            bytesByTarget.get(fixture.npmTarget) as Buffer,
            `synthetic:${fixture.buildTarget}`
          )
        );
        // The staged library bytes land under the frozen npm-target layout.
        const staged = await readFile(
          join(root, "packages/ext-dialog", stagedManifest.targets[fixture.npmTarget].path)
        );
        expect(staged.equals(bytesByTarget.get(fixture.npmTarget) as Buffer)).toBe(true);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  test("Scenario: Given only three staged targets When staging runs Then it fails hard and no manifest is written", async () => {
    const root = await createFixtureWorkspace();
    try {
      for (const fixture of FIXTURE_TARGETS.slice(0, 3)) {
        await writeFixtureTargetArtifact(root, fixture);
      }

      const result = await runStageScript(
        root,
        stagePlanJson(FIXTURE_TARGETS.slice(0, 3).map((f) => f.buildTarget))
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("missing required matrix target win32-x64");
      await expect(
        readFile(join(root, "packages/ext-dialog/platforms/manifest.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  test("Scenario: Given evidence built against a stale facade version When staging runs Then the identity chain rejects it", async () => {
    const root = await createFixtureWorkspace();
    try {
      for (const fixture of FIXTURE_TARGETS) {
        await writeFixtureTargetArtifact(root, fixture, { staleVersion: true });
      }

      const result = await runStageScript(root, stagePlanJson(FIXTURE_TARGETS.map((f) => f.buildTarget)));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("identity mismatch");
      await expect(
        readFile(join(root, "packages/ext-dialog/platforms/manifest.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  test("Scenario: Given a staged four-target fixture When the pack gates run Then validate-package-dirs, check-pack-size, and the unpack identity evidence all pass", async () => {
    const root = await createFixtureWorkspace();
    try {
      for (const fixture of FIXTURE_TARGETS) {
        await writeFixtureTargetArtifact(root, fixture);
      }
      const stageResult = await runStageScript(root, stagePlanJson(FIXTURE_TARGETS.map((f) => f.buildTarget)));
      expect(stageResult.exitCode).toBe(0);

      // validate-package-dirs: real pnpm pack, required entries present
      // (execFileAsync rejects on any non-zero exit).
      const validateScript = join(import.meta.dir, "validate-package-dirs.ts");
      await execFileAsync(
        process.execPath,
        [validateScript, "--package-dirs-json", JSON.stringify(["packages/ext-dialog"])],
        { cwd: root, encoding: "utf8" }
      );

      // check-pack-size: real npm pack measured from the actual tgz stat.
      const { receipts, exitCode } = await runCheck({
        packageDirs: [join(root, "packages/ext-dialog")],
      });
      expect(exitCode).toBe(0);
      expect(receipts).toHaveLength(1);
      expect(receipts[0].verdict).toBe("ok");
      expect(receipts[0].packageName).toBe("@opentray/ext-dialog");
      // The receipt lists every packed platforms/ file (manifest included).
      expect(
        receipts[0].platformFiles.map((line) => line.split(" (")[0])
      ).toEqual([
        "platforms/darwin-arm64/libopentray_ext_dialog.dylib",
        "platforms/darwin-x64/libopentray_ext_dialog.dylib",
        "platforms/manifest.json",
        "platforms/win32-arm64/opentray_ext_dialog.dll",
        "platforms/win32-x64/opentray_ext_dialog.dll",
      ]);

      // embedded pack evidence: real npm pack + in-memory unpack + re-hash
      // (execFileAsync rejects on any non-zero exit).
      const evidenceScript = join(import.meta.dir, "verify-embedded-pack-evidence.ts");
      const evidence = await execFileAsync(
        process.execPath,
        [evidenceScript, "--root", root, "--package", "packages/ext-dialog"],
        { cwd: root, encoding: "utf8" }
      );
      for (const fixture of FIXTURE_TARGETS) {
        expect(evidence.stdout).toContain(`embedded-pack-identity OK ${fixture.npmTarget}`);
        expect(evidence.stdout).toContain(`buildIdentity=synthetic:${fixture.buildTarget}`);
      }
      expect(evidence.stdout).toContain("mode=real");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 120_000);
});
